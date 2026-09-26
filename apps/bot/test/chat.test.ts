import { describe, expect, it } from 'vitest';
import { ALL_ELEMENTS, HOUSES, collectOutcomes, encodeDeepLink, getHouse, localizeOutcome, resolve } from '@esli-chto/core';
import {
  addressReply, askAddressReply, cbProblem, elementReply, emergencyReply, help, houseChosenReply, houseFromStart, housesListReply, parseCallback,
  problemReply, searchReply, startReply, stepForChat, welcome, type ChatReply,
} from '../src/chat';

const uk = getHouse('vch_korovina_11');
const tszh = getHouse('vch_pyatnitskiy_13');
const none = getHouse('none');
/** Текст сообщения без HTML-разметки – как его видит пользователь. */
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

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
    expect(mine).toContain('г. Вичуга, ул. Коровина, д. 11');
    expect(mine).toContain('УК «Жилищно-ремонтный участок №1»');
    expect(mine).toContain('<b>112</b>');
  });

  it('справка, срочное и выбор дома корректны', () => {
    [help(uk), emergencyReply(uk), emergencyReply(none), askAddressReply(uk), askAddressReply(none), housesListReply(uk.id)].forEach(assertValidReply);
    expect(help(uk).text).toContain('/forget');
    const e = emergencyReply(uk).text;
    expect(e).toContain('112');
    expect(e).toContain('104');
    expect(e).toContain('+7 (493) 542-34-73');
    expect(emergencyReply(none).text).toContain('выберите дом');
  });

  it('выбор дома по адресу: один дом – сразу, несколько – кнопки, ни одного – повторить', () => {
    expect(addressReply('Коровина 11').houseId).toBe('vch_korovina_11');
    expect(addressReply('пер. Пятницкий, д. 13').houseId).toBe('vch_pyatnitskiy_13');
    const many = addressReply('Коровина');
    expect(many.houseId).toBeUndefined();
    assertValidReply(many.reply!);
    expect(many.reply!.buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('h:')).length).toBeGreaterThan(1);
    const miss = addressReply('улица Несуществующая 999');
    expect(miss.houseId).toBeUndefined();
    expect(miss.reply!.text).toContain('Не нашёл');
    const chosen = houseChosenReply(uk);
    assertValidReply(chosen);
    expect(chosen.text).toContain('Аварийная служба: <b>+7 (493) 542-34-73</b>');
    expect(houseChosenReply(getHouse('vch_moskovskaya_13')).text).toContain('УК «Стоун»');
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
    expect(housesListReply(uk.id).text).toContain('✓ ул. Коровина, 11');
    expect(housesListReply(none.id).text).toContain('страница 1 из');
    expect(parseCallback(`hl:${pages}`)).toBeUndefined();
  });

  it('адрес вместо описания проблемы – бот предлагает выбрать этот дом', () => {
    const r = searchReply('Ленинградская 6', none);
    assertValidReply(r);
    expect(r.buttons.flat().some((b) => b.kind === 'cb' && b.payload === 'h:vch_leningradskaya_6')).toBe(true);
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

  it('форма управления учитывается: в ТСЖ нет «управляющей организации»', () => {
    const r = problemReply('lamp_entrance__burned', [], tszh);
    expect(r.text).toContain('ТСЖ «Старатели»');
    expect(r.text).toContain('+7 (920) 377-87-88');
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
              const opts = r.buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('p:')).length;
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
              const opts = r.buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('p:')).length;
              for (let i = 0; i < opts; i += 1) walk([...answers, i]);
            }
          };
          walk([]);
        }
      return out.join('\n\n');
    };
    const mine = texts(uk);
    for (const number of ['+7 (493) 542-22-79', '+7 (493) 542-44-72', '+7 (493) 543-58-33', '+7 (493) 295-09-50', '+7 (493) 241-05-61', '+7 (493) 542-50-27'])
      expect(mine, number).toContain(number);
    expect(mine).toContain('на панели домофона');
    expect(mine).not.toMatch(/: $/m);
    const noHouse = texts(none);
    expect(noHouse).toContain('+7 (493) 542-22-79');
    expect(noHouse).not.toContain('+7 (493) 542-34-73');
    expect(noHouse).not.toContain('контакта нет в справочнике');
  });
});

describe('callback и диплинки', () => {
  it('разбирает корректные данные', () => {
    expect(parseCallback('menu')).toEqual({ t: 'menu' });
    expect(parseCallback(cbProblem('roof__leak'))).toEqual({ t: 'problem', problemId: 'roof__leak', answers: [] });
    expect(parseCallback(cbProblem('pipes_valves__leak', [0, 2]))).toEqual({ t: 'problem', problemId: 'pipes_valves__leak', answers: [0, 2] });
    expect(parseCallback('h:vch_pyatnitskiy_13')).toEqual({ t: 'house', houseId: 'vch_pyatnitskiy_13' });
    expect(parseCallback('hl:0')).toEqual({ t: 'housesPage', page: 0 });
  });

  it('отвергает мусор и неизвестные id', () => {
    for (const bad of ['', 'p:nope:', 'p:roof__leak:x', 'p:roof__leak:99', 'p:roof__leak:0:1', 'e:???', 'e:roof:1', 'h:hacked', 'a'.repeat(300), 'DROP TABLE']) {
      expect(parseCallback(bad), bad).toBeUndefined();
    }
    expect(parseCallback(undefined)).toBeUndefined();
  });

  it('старт по диплинку открывает нужную ситуацию', () => {
    const payload = encodeDeepLink({ houseId: 'vch_korovina_11', problemId: 'roof__leak' });
    const r = startReply(payload, uk);
    assertValidReply(r);
    expect(r.text).toContain('Крыша');
    expect(startReply(undefined, uk).text).toContain('Если что');
    expect(startReply('garbage;;', uk).text).toContain('Если что');
  });

  it('диплинк только с домом показывает этот дом, а не прежний', () => {
    const r = startReply(encodeDeepLink({ houseId: 'vch_pyatnitskiy_13' }), uk);
    assertValidReply(r);
    expect(r.text).toContain('Ваш дом');
    expect(r.text).toContain('ТСЖ «Старатели»');
    expect(houseFromStart('h_vch_pyatnitskiy_13')).toBe('vch_pyatnitskiy_13');
    expect(houseFromStart('h_hacked-p_roof__leak')).toBeUndefined();
    expect(houseFromStart(undefined)).toBeUndefined();
  });
});

describe('ответ бота совпадает с мини-приложением', () => {
  it('кнопка «Подробнее» ведёт в ту же ситуацию того же дома', () => {
    const r = problemReply('roof__leak', [], tszh);
    const app = r.buttons.flat().find((b) => b.kind === 'app');
    expect(app && app.kind === 'app' && app.payload).toBe(encodeDeepLink({ houseId: 'vch_pyatnitskiy_13', problemId: 'roof__leak' }));
  });

  it('каждая аварийная ситуация в чате сразу называет номер 112 или 104', () => {
    for (const e of ALL_ELEMENTS) {
      for (const p of e.problems.filter((x) => x.urgency === 'emergency')) {
        const walk = (answers: number[]) => {
          const r = problemReply(p.id, answers, uk);
          expect(r.text, p.id).toMatch(/112|104/);
          if (r.text.includes('❓')) r.buttons.flat().filter((b) => b.kind === 'cb' && b.payload.startsWith('p:')).forEach((_, i) => walk([...answers, i]));
        };
        walk([]);
      }
    }
  });
});
