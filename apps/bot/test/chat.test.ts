import { describe, expect, it } from 'vitest';
import { ADDRESS_EXAMPLES, ALL_ELEMENTS, CITY_SERVICES, HOUSES, collectOutcomes, encodeDeepLink, getHouse, localizeOutcome, resolve } from '@esli-chto/core';
import {
  addressReply, askAddressReply, cbProblem, elementReply, emergencyReply, help, houseChosenReply, houseFromStart, housesListReply, menuReply,
  nonTextReply, parseCallback, problemReply, searchReply, startReply, stepForChat, textReply, thanksReply, welcome, type ChatReply,
} from '../src/chat';
import { BOARD_HOUSE, PILOT, UK_HOUSE, addressQuery, dispatchPhone, managerOf, managerPhone } from '../../../packages/core/test/fixtures';

// дома из справочника подключённого города (в Вичуге – ул. Коровина, 11 и ТСЖ «Старатели»)
const uk = UK_HOUSE;
const tszh = BOARD_HOUSE;
const none = getHouse('none');
/** Текст сообщения без HTML-разметки – как его видит пользователь. */
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Кнопки вариантов ответа на текущий вопрос (без «Назад» и «Другая ситуация»). */
const optionCount = (r: ChatReply, problemId: string, answers: number[]) => {
  const here = cbProblem(problemId, answers);
  return r.buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith(here) && b.payload !== here).length;
};

/** Ограничения MAX Bot API на клавиатуру: до 30 рядов, до 7 кнопок в ряду (для open_app – до 3), payload не пустой. */
function assertValidReply(r: ChatReply) {
  expect(r.text.length).toBeGreaterThan(0);
  expect(r.text.length).toBeLessThanOrEqual(4000);
  // разметка HTML: только <b>, <i>, <u>, каждый тег закрыт, вложенность верная
  const stack: string[] = [];
  for (const [, close, tag] of r.text.matchAll(/<(\/?)([a-z]+)>/g)) {
    expect(['b', 'i', 'u']).toContain(tag);
    if (close) expect(stack.pop(), r.text).toBe(tag);
    else stack.push(tag!);
  }
  expect(stack, r.text).toEqual([]);
  expect(r.text.replace(/<\/?[biu]>/g, ''), 'в тексте не должно быть неэкранированных < и >').not.toMatch(/[<>]/);
  expect(r.buttons.length).toBeLessThanOrEqual(30);
  for (const row of r.buttons) {
    expect(row.length).toBeGreaterThan(0);
    expect(row.length).toBeLessThanOrEqual(3);
    for (const b of row) {
      expect(b.text.length).toBeGreaterThan(0);
      if (b.kind === 'cb') {
        expect(b.payload.length).toBeGreaterThan(0);
        expect(b.payload.length).toBeLessThanOrEqual(200);
        expect(parseCallback(b.payload), `callback не разбирается: ${b.payload}`).toBeDefined();
      } else if (b.payload) {
        expect(b.payload).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
      }
    }
  }
}

describe('экраны бота', () => {
  it('приветствие: кнопка мини-приложения, экстренные номера, выбор дома', () => {
    const r = welcome(none);
    assertValidReply(r);
    expect(r.buttons.flat().some((b) => b.kind === 'app')).toBe(true);
    expect(r.text).toContain('/house');
    expect(r.text).toContain('112');
    const mine = welcome(uk).text;
    expect(mine).toContain(uk.address);
    expect(mine).toContain(managerOf(uk).name);
    expect(mine).toContain('<b>112</b>');
  });

  it('справка, срочное и выбор дома корректны', () => {
    [help(uk), emergencyReply(uk), emergencyReply(none), askAddressReply(uk), askAddressReply(none), housesListReply(uk.id)].forEach(assertValidReply);
    expect(help(uk).text).toContain('/forget');
    const e = emergencyReply(uk).text;
    expect(e).toContain('112');
    expect(e).toContain('104');
    expect(e).toContain(dispatchPhone(uk));
    expect(emergencyReply(none).text).toContain('выберите дом');
  });

  it('выбор дома по адресу: один дом – сразу, несколько – кнопки, ни одного – повторить', () => {
    expect(addressReply(addressQuery(uk)).houseId).toBe(uk.id);
    expect(addressReply(addressQuery(tszh)).houseId).toBe(tszh.id);
    // улица, на которой несколько домов: бот предлагает выбрать кнопкой
    const street = HOUSES.map((h) => addressQuery(h).replace(/\s+\S+$/, '')).find((st, i, all) => all.indexOf(st) !== i);
    if (street) {
      const many = addressReply(street);
      expect(many.houseId).toBeUndefined();
      assertValidReply(many.reply!);
      expect(many.reply!.buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('h:')).length).toBeGreaterThan(1);
    }
    const miss = addressReply('улица Несуществующая 999');
    expect(miss.houseId).toBeUndefined();
    expect(miss.reply!.text).toContain('Не нашёл');
    const chosen = houseChosenReply(uk);
    assertValidReply(chosen);
    expect(chosen.text).toContain(`Аварийная служба: <b>${dispatchPhone(uk)}</b>`);
  });

  it('список всех домов разбит на страницы и помещается в сообщение', () => {
    const pages = Math.ceil(HOUSES.length / 40);
    let listed = 0;
    for (let p = 0; p < pages; p += 1) {
      const r = housesListReply(uk.id, p);
      assertValidReply(r);
      listed += r.text.split('\n').filter((l) => /^[•✓] /.test(l)).length;
    }
    expect(listed).toBe(HOUSES.length);
    expect(housesListReply(uk.id).text).toContain(`✓ ${uk.title}`);
    expect(housesListReply(none.id).text).toContain('страница 1 из');
    expect(parseCallback(`hl:${pages}`)).toBeUndefined();
  });

  it('адрес вместо описания проблемы – бот предлагает выбрать этот дом', () => {
    const r = searchReply(addressQuery(uk), none);
    assertValidReply(r);
    const houses = r.buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('h:'));
    expect(houses.map((b) => b.kind === 'cb' && b.payload)).toEqual([`h:${uk.id}`]);
  });

  // дом, номер которого – начало номера соседнего дома на той же улице: как «Ленинградская 6» и 60, 62
  const prefixed = HOUSES.find((h) => HOUSES.some((o) => o !== h && addressQuery(o).startsWith(`${addressQuery(h)}`) && /\d$/.test(addressQuery(h))));
  it.runIf(prefixed)('номер дома совпал целиком – предлагается только этот дом, без 60 и 62', () => {
    expect(addressReply(addressQuery(prefixed!)).houseId).toBe(prefixed!.id);
    const houses = searchReply(addressQuery(prefixed!), none).buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('h:'));
    expect(houses.map((b) => b.kind === 'cb' && b.payload)).toEqual([`h:${prefixed!.id}`]);
  });

  it('фото, стикер или файл вместо текста – подсказка и выход в приложение, а не молчание', () => {
    for (const house of [uk, none]) {
      const r = nonTextReply(house);
      assertValidReply(r);
      expect(r.text).toContain('только текст');
      expect(r.buttons.flat().some((b) => b.kind === 'app')).toBe(true);
    }
    assertValidReply(menuReply());
  });

  it('«Назад» ведёт на шаг назад: к прошлому вопросу, а с первого шага – к ситуациям объекта', () => {
    const back = (r: ChatReply) => r.buttons.flat().find((b) => b.text === '‹ Назад');
    const payloadOf = (r: ChatReply) => {
      const btn = back(r);
      return btn && btn.kind === 'cb' ? btn.payload : undefined;
    };
    expect(payloadOf(problemReply('vru__flicker', [], uk))).toBe('e:vru');
    expect(payloadOf(problemReply('vru__flicker', [1], uk))).toBe(cbProblem('vru__flicker'));
    expect(payloadOf(problemReply('roof__leak', [], uk))).toBe('e:roof');
    // недействительный ответ не уводит «Назад» дальше, чем пользователь прошёл
    expect(payloadOf(problemReply('vru__flicker', [9], uk))).toBe('e:vru');
    expect(elementReply('vru', uk).buttons.flat().some((b) => b.kind === 'cb' && b.payload === 'menu')).toBe(true);
  });

  it('приветствие, «начать», «что ты умеешь» и «спасибо» – рассказ о боте, а не «не нашёл»', () => {
    for (const q of ['Привет', 'здравствуйте!', 'Добрый день', 'доброе утро)', 'Начать', 'старт', 'Здравствуйте, подскажите пожалуйста']) {
      const r = textReply(q, uk);
      assertValidReply(r);
      expect(r.text, q).toContain('помощник для жителей');
    }
    for (const q of ['что ты умеешь?', 'Помощь', 'как пользоваться']) expect(textReply(q, uk).text, q).toContain('Как пользоваться');
    expect(textReply('Спасибо!', uk).text).toBe(thanksReply(uk).text);
    // приветствие перед описанием не мешает найти ситуацию
    const found = textReply('Здравствуйте, во всём доме мигает свет', uk);
    expect(found.buttons.flat().some((b) => b.kind === 'cb' && b.payload === cbProblem('vru__flicker'))).toBe(true);
    // слова, похожие на приветствие только началом, приветствием не считаются
    expect(textReply('кухня течёт', uk).text).not.toContain('помощник для жителей');
  });

  it('поиск по свободному тексту предлагает ситуации, а не тупик', () => {
    const r = searchReply('течёт кран', uk);
    assertValidReply(r);
    expect(r.buttons.some((row) => row.some((b) => b.kind === 'cb' && b.payload.startsWith('p:tap__leak')))).toBe(true);
    const none = searchReply('абракадабра', uk);
    assertValidReply(none);
    expect(none.text).toContain('Не нашёл');
    expect(none.buttons.flat().some((b) => b.kind === 'app')).toBe(true);
  });

  it('диалог с уточняющим вопросом приводит к результату', () => {
    const q = problemReply('pipes_valves__leak', [], uk);
    assertValidReply(q);
    expect(q.text).toContain('❓');
    const answer = problemReply('pipes_valves__leak', [1], uk);
    assertValidReply(answer);
    expect(answer.text).toContain('Ваша зона ответственности');
    const gas = problemReply('gas_stove__smell', [], uk);
    expect(gas.text).toContain('104');
    expect(gas.text).toContain('🆘');
    expect(gas.text.indexOf('104')).toBeLessThan(gas.text.indexOf('Куда обращаться'));
  });

  it('форма управления учитывается: в ТСЖ, ЖСК и ТСН нет «управляющей организации»', () => {
    const r = problemReply('lamp_entrance__burned', [], tszh);
    expect(r.text).toContain(managerOf(tszh).name);
    expect(r.text).toContain(managerPhone(tszh));
    expect(r.text).not.toContain('управляющая организация');
    expect(r.text).not.toContain('{M');
  });

  it('все ситуации всех домов рендерятся в допустимые сообщения', () => {
    for (const house of [none, uk, tszh]) {
      for (const e of ALL_ELEMENTS) {
        assertValidReply(elementReply(e.id, house));
        for (const p of e.problems) {
          // все пути вопросов
          const outcomes = collectOutcomes(p).length;
          expect(outcomes).toBeGreaterThan(0);
          const walk = (answers: number[]) => {
            const r = problemReply(p.id, answers, house);
            assertValidReply(r);
            if (r.text.includes('❓')) {
              const opts = optionCount(r, p.id, answers);
              for (let i = 0; i < opts; i += 1) walk([...answers, i]);
            }
          };
          walk([]);
        }
      }
    }
  });

  it('шаги «что делать» в чате всегда полностью, текст не обрезается', () => {
    for (const house of [none, uk, tszh])
      for (const e of ALL_ELEMENTS)
        for (const p of e.problems) {
          const walk = (answers: number[]) => {
            const r = resolve(p, answers);
            const reply = problemReply(p.id, answers, house);
            if (r.status === 'question') {
              r.question.options.forEach((_, i) => walk([...answers, i]));
              return;
            }
            expect(reply.text.endsWith('…'), p.id).toBe(false);
            const text = plain(reply.text);
            for (const step of localizeOutcome(r.outcome, house).steps) expect(text, p.id).toContain(stepForChat(step));
          };
          walk([]);
        }
  });

  it('в ответах – телефоны городских служб; лифт – через диспетчерскую дома, домофон – с подсказкой', () => {
    const texts = (house: typeof uk) => {
      const out: string[] = [];
      for (const e of ALL_ELEMENTS)
        for (const p of e.problems) {
          const walk = (answers: number[]) => {
            const r = problemReply(p.id, answers, house);
            out.push(r.text);
            if (r.text.includes('❓')) {
              const opts = optionCount(r, p.id, answers);
              for (let i = 0; i < opts; i += 1) walk([...answers, i]);
            }
          };
          walk([]);
        }
      return out.join('\n\n');
    };
    const mine = texts(uk);
    const serviceNumbers = (['water_utility', 'heat_utility', 'energy_utility', 'tko_operator', 'housing_inspection', 'municipality'] as const).map((p) => CITY_SERVICES[p]!.phones[0]!.number);
    for (const number of serviceNumbers) expect(mine, number).toContain(number);
    if (PILOT) expect(mine).toContain('на панели домофона');
    expect(mine).not.toMatch(/: $/m);
    const noHouse = texts(none);
    expect(noHouse).toContain(serviceNumbers[0]);
    expect(noHouse).not.toContain(dispatchPhone(uk));
    expect(noHouse).not.toContain('контакта нет в справочнике');
  });
});

describe('callback и диплинки', () => {
  it('разбирает корректные данные', () => {
    expect(parseCallback('menu')).toEqual({ t: 'menu' });
    expect(parseCallback(cbProblem('roof__leak'))).toEqual({ t: 'problem', problemId: 'roof__leak', answers: [] });
    expect(parseCallback(cbProblem('pipes_valves__leak', [0, 2]))).toEqual({ t: 'problem', problemId: 'pipes_valves__leak', answers: [0, 2] });
    expect(parseCallback(`h:${tszh.id}`)).toEqual({ t: 'house', houseId: tszh.id });
    expect(parseCallback('hl:0')).toEqual({ t: 'housesPage', page: 0 });
  });

  it('отвергает мусор и неизвестные id', () => {
    for (const bad of ['', 'p:nope:', 'p:roof__leak:x', 'p:roof__leak:99', 'p:roof__leak:0:1', 'e:???', 'e:roof:1', 'h:hacked', 'a'.repeat(300), 'DROP TABLE']) {
      expect(parseCallback(bad), bad).toBeUndefined();
    }
    expect(parseCallback(undefined)).toBeUndefined();
  });

  it('старт по диплинку открывает нужную ситуацию', () => {
    const payload = encodeDeepLink({ houseId: uk.id, problemId: 'roof__leak' });
    const r = startReply(payload, uk);
    assertValidReply(r);
    expect(r.text).toContain('Крыша');
    expect(startReply(undefined, uk).text).toContain('Если что');
    expect(startReply('garbage;;', uk).text).toContain('Если что');
  });

  it('диплинк только с домом показывает этот дом, а не прежний', () => {
    const r = startReply(encodeDeepLink({ houseId: tszh.id }), uk);
    assertValidReply(r);
    expect(r.text).toContain('Ваш дом');
    expect(r.text).toContain(managerOf(tszh).name);
    expect(houseFromStart(`h_${tszh.id}`)).toBe(tszh.id);
    expect(houseFromStart('h_hacked-p_roof__leak')).toBeUndefined();
    expect(houseFromStart(undefined)).toBeUndefined();
  });
});

describe('ответ бота совпадает с мини-приложением', () => {
  it('кнопка «Подробнее» ведёт в ту же ситуацию того же дома', () => {
    const r = problemReply('roof__leak', [], tszh);
    const app = r.buttons.flat().find((b) => b.kind === 'app');
    expect(app && app.kind === 'app' && app.payload).toBe(encodeDeepLink({ houseId: tszh.id, problemId: 'roof__leak' }));
  });

  it('каждая аварийная ситуация в чате сразу называет номер 112 или 104', () => {
    for (const e of ALL_ELEMENTS) {
      for (const p of e.problems.filter((x) => x.urgency === 'emergency')) {
        const walk = (answers: number[]) => {
          const r = problemReply(p.id, answers, uk);
          expect(r.text, p.id).toMatch(/112|104/);
          if (r.text.includes('❓')) for (let i = 0; i < optionCount(r, p.id, answers); i += 1) walk([...answers, i]);
        };
        walk([]);
      }
    }
  });
});

describe.runIf(PILOT)('пилот: ответы бота по справочнику Вичуги', () => {
  it('адрес с «пер.» и «д.», дом за двумя организациями, «Ленинградская 6» без домов 60 и 62', () => {
    expect(addressReply('пер. Пятницкий, д. 13').houseId).toBe('vch_pyatnitskiy_13');
    expect(houseChosenReply(getHouse('vch_moskovskaya_13')).text).toContain('УК «Стоун»');
    const houses = searchReply('Ленинградская 6', none).buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('h:'));
    expect(houses.map((b) => b.kind === 'cb' && b.payload)).toEqual(['h:vch_leningradskaya_6']);
  });

  it('телефоны из источника: диспетчерская УК, правление ТСЖ', () => {
    expect(emergencyReply(uk).text).toContain('+7 (493) 542-34-73');
    expect(problemReply('lamp_entrance__burned', [], tszh).text).toContain('+7 (920) 377-87-88');
  });

  it('примеры адресов в подсказках – из данных Вичуги', () => {
    expect(askAddressReply(none).text).toContain('Коровина 11');
    expect(addressReply('улица Несуществующая 999').reply!.text).toContain('«Ленинградская 6»');
  });
});

describe('подсказки с адресами – из справочника подключённого города', () => {
  it('в приглашении и в ответе «не нашёл» – примеры этого города', () => {
    expect(askAddressReply(none).text).toContain(`например <b>${ADDRESS_EXAMPLES[0]}</b>`);
    expect(addressReply('улица Несуществующая 999').reply!.text).toContain(`«${ADDRESS_EXAMPLES[0]}»`);
  });
});
