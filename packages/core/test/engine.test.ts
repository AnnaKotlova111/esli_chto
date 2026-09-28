import { describe, expect, it } from 'vitest';
import {
  ALL_ELEMENTS, blanksOf, buildRequest, cleanUserInfo, collectOutcomes, phoneHint, decodeDeepLink, emergencyPartyOf, encodeDeepLink, getElements, getHouse,
  getProblem, isElementAvailable, localizeOutcome, resolve, resolveParties, search, urgentProblems, withFeatures, type Outcome,
} from '../src';

// дом УК «Жилищно-ремонтный участок №1»; особенности в реестре не указаны – показываются все объекты
const uk = getHouse('vch_korovina_11');
// дом ТСЖ «Старатели», житель отметил: лифта и мусоропровода нет
const tszh = withFeatures(getHouse('vch_pyatnitskiy_13'), ['gas', 'central_heating', 'intercom', 'basement']);

const outcomeOf = (problemId: string, answers: number[] = []): Outcome => {
  const r = resolve(problemId, answers);
  if (r.status !== 'outcome') throw new Error(`${problemId}: ожидался ответ, а не вопрос`);
  return r.outcome;
};

describe('движок правил', () => {
  it('resolve принимает id ситуации и проходит ветку вопросов', () => {
    expect(resolve('pipes_valves__leak').status).toBe('question');
    expect(outcomeOf('pipes_valves__leak', [0]).responsible).toContain('manager');
    expect(outcomeOf('pipes_valves__leak', [1]).responsible[0]).toBe('owner');
    expect(outcomeOf('pipes_valves__leak', [2]).certainty).toBe('disputed');
  });

  it('недействительный ответ оставляет на текущем вопросе, неизвестный id – ошибка', () => {
    expect(resolve('pipes_valves__leak', [99]).status).toBe('question');
    expect(() => resolve('nope__nope')).toThrow();
  });

  it('один и тот же объект и ответ всегда дают один и тот же результат', () => {
    expect(outcomeOf('radiator__leak', [1])).toEqual(outcomeOf('radiator__leak', [1]));
  });

  it('примеры из идеи проекта', () => {
    expect(outcomeOf('lamp_entrance__burned').responsible[0]).toBe('manager');
    expect(outcomeOf('tap__leak').responsible[0]).toBe('owner');
    expect(outcomeOf('riser_flat__leak').responsible).toContain('manager');
    const trash = outcomeOf('trash_area__overflow');
    expect(trash.responsible[0]).toBe('tko_operator');
    expect(trash.responsible).toContain('manager');
    expect(outcomeOf('radiator__leak', [0]).responsible[0]).toBe('owner');
    expect(outcomeOf('radiator__leak', [1]).responsible).toContain('manager');
  });
});

describe('фильтрация по особенностям дома', () => {
  it('в доме без лифта и мусоропровода эти объекты недоступны', () => {
    const ids = getElements(tszh).map((e) => e.id);
    expect(ids).not.toContain('elevator');
    expect(ids).not.toContain('garbage_chute');
    expect(getElements(uk).map((e) => e.id)).toEqual(expect.arrayContaining(['elevator', 'garbage_chute']));
    const elevator = ALL_ELEMENTS.find((e) => e.id === 'elevator')!;
    expect(isElementAvailable(uk, elevator)).toBe(true);
    expect(isElementAvailable(tszh, elevator)).toBe(false);
  });

  it('объекты без требований доступны в любом доме', () => {
    for (const e of ALL_ELEMENTS.filter((x) => !x.requires?.length)) {
      expect(isElementAvailable(uk, e) && isElementAvailable(tszh, e), e.id).toBe(true);
    }
  });
});

describe('экстренные ситуации ведут на реальный номер 112 или 104', () => {
  it('каждый ответ каждой аварийной ситуации содержит 112 или 104', () => {
    for (const e of ALL_ELEMENTS) {
      for (const p of e.problems.filter((x) => x.urgency === 'emergency')) {
        for (const o of collectOutcomes(p)) {
          expect(emergencyPartyOf(o), `${p.id}: «${o.headline}»`).toBeDefined();
        }
      }
    }
  });

  it('контрольные сценарии: пожар, газ, запертый человек, кипяток, искрит проводка, застрял в лифте', () => {
    expect(emergencyPartyOf(outcomeOf('fire_safety__fire'))).toBe('emergency112');
    expect(emergencyPartyOf(outcomeOf('gas_stove__smell'))).toBe('gas_emergency');
    expect(emergencyPartyOf(outcomeOf('interior_doors__locked'))).toBe('emergency112');
    expect(emergencyPartyOf(outcomeOf('riser_flat__scald'))).toBe('emergency112');
    expect(emergencyPartyOf(outcomeOf('outlets__spark'))).toBe('emergency112');
    expect(emergencyPartyOf(outcomeOf('elevator__stuck'))).toBe('emergency112');
    expect(emergencyPartyOf(outcomeOf('neighbors__smell', [0]))).toBe('emergency112');
    expect(emergencyPartyOf(outcomeOf('neighbors__smell', [1]))).toBe('gas_emergency');
  });

  it('раздел «Срочно»: сначала угрозы жизни, недоступные в доме объекты не попадают', () => {
    const items = urgentProblems(uk);
    const firstUrgent = items.findIndex((i) => i.problem.urgency === 'urgent');
    expect(items.slice(0, firstUrgent).every((i) => i.problem.urgency === 'emergency')).toBe(true);
    expect(items.slice(firstUrgent).every((i) => i.problem.urgency === 'urgent')).toBe(true);
    for (const i of items.filter((x) => x.problem.urgency === 'emergency')) {
      expect(['emergency112', 'gas_emergency'], i.problem.id).toContain(i.call);
    }
    expect(urgentProblems(tszh).some((i) => i.element.id === 'elevator')).toBe(false);
  });
});

describe('стороны ответственности и контакты', () => {
  it('112, 104 и 102 – общероссийские номера, одинаковые для всех домов', () => {
    for (const h of [uk, tszh]) {
      const [e112, gas, police] = resolveParties(h, ['emergency112', 'gas_emergency', 'police']);
      expect(e112!.contact!.phones[0]!.number).toBe('112');
      expect(gas!.contact!.phones[0]!.number).toBe('104');
      expect(police!.contact!.phones[0]!.number).toBe('102');
    }
  });

  it('контакты организаций берутся из справочника дома', () => {
    const [manager, dispatch] = resolveParties(uk, ['manager', 'dispatch']);
    expect(manager!.contact!.name).toBe('УК «Жилищно-ремонтный участок №1»');
    expect(manager!.missingContact).toBe(false);
    expect(dispatch!.contact!.phones[0]!.number).toBe('+7 (493) 542-34-73');
  });

  it('у ТСЖ без диспетчерской аварии принимает правление', () => {
    const [dispatch] = resolveParties(tszh, ['dispatch']);
    expect(dispatch!.contact!.name).toBe('ТСЖ «Старатели»');
  });

  it('контакты городских служб подставляются; до выбора дома нет только контактов управляющей организации', () => {
    const [water, heat] = resolveParties(uk, ['water_utility', 'heat_utility']);
    expect(water!.missingContact).toBe(false);
    expect(heat!.contact!.name).toContain('МУП «ОК и ТС»');
    const [manager, gzhi] = resolveParties(getHouse('none'), ['manager', 'housing_inspection']);
    expect(manager!.missingContact).toBe(true);
    expect(gzhi!.contact!.phones[0]!.number).toBe('+7 (493) 241-05-61');
  });

  it('у собственника, соседа и оператора связи контактов нет по смыслу – это не пустая карточка', () => {
    for (const id of ['owner', 'neighbor', 'telecom'] as const) {
      const [p] = resolveParties(uk, [id]);
      expect(p!.missingContact, id).toBe(false);
    }
    expect(resolveParties(uk, ['telecom'])[0]!.role).toContain('договоре');
  });
});

describe('поиск свободным текстом', () => {
  const top = (q: string, house = uk) => search(q, house)[0];

  // контрольный список: разговорная формулировка → ожидаемый верхний результат
  const control: [string, { elementId: string; problemId?: string }][] = [
    ['не горит лампочка', { elementId: 'lamp_entrance' }],
    ['течёт кран', { elementId: 'tap' }],
    ['застрял в лифте', { elementId: 'elevator', problemId: 'elevator__stuck' }],
    ['пахнет газом', { elementId: 'gas_stove', problemId: 'gas_stove__smell' }],
    ['нет горячей воды', { elementId: 'risers', problemId: 'risers__no_hot' }],
    ['мусор переполнен', { elementId: 'trash_area' }],
    ['шлагбаум не пропускает скорую', { elementId: 'yard_gate', problemId: 'yard_gate__emergency' }],
    ['во всём доме мигает свет, куда обращаться?', { elementId: 'vru', problemId: 'vru__flicker' }],
    ['скачет напряжение', { elementId: 'vru', problemId: 'vru__flicker' }],
    ['перегородили выезд', { elementId: 'parking', problemId: 'parking__blocked' }],
    ['водосточная труба', { elementId: 'roof', problemId: 'roof__drain' }],
    ['холодная батарея', { elementId: 'radiator' }],
    ['засор в раковине', { elementId: 'sewer' }],
    ['сосульки на крыше', { elementId: 'roof', problemId: 'roof__snow' }],
    ['заливает кипятком', { elementId: 'riser_flat', problemId: 'riser_flat__scald' }],
    ['пожар в подъезде', { elementId: 'fire_safety', problemId: 'fire_safety__fire' }],
    ['машина на газоне', { elementId: 'parking', problemId: 'parking__lawn' }],
    ['открытый люк', { elementId: 'utilities', problemId: 'utilities__hatch' }],
    ['пульт от шлагбаума', { elementId: 'yard_gate', problemId: 'yard_gate__access' }],
  ];
  for (const [q, want] of control) {
    it(`«${q}»`, () => {
      const hit = top(q);
      expect(hit?.elementId, q).toBe(want.elementId);
      if (want.problemId) expect(hit?.problemId, q).toBe(want.problemId);
    });
  }

  // более широкие формулировки: нужный объект должен быть в выдаче
  const broad: [string, string][] = [
    ['шумят соседи ночью', 'neighbors'],
    ['залили соседи', 'neighbors'],
    ['нет интернета', 'telecom_flat'],
    ['не пришла квитанция', 'bill'],
    ['течёт стиральная машина', 'appliances'],
    ['кондиционер капает', 'aircon'],
    ['газовая колонка хлопает', 'gas_heater'],
    ['заперся ребёнок', 'interior_doors'],
    ['висят провода в подъезде', 'telecom_cables'],
  ];
  for (const [q, id] of broad) {
    it(`«${q}» → ${id} в выдаче`, () => {
      expect(search(q, uk).some((h) => h.elementId === id)).toBe(true);
    });
  }

  it('короткие слова не совпадают с похожими по началу: «засор» не находит «застрял в лифте»', () => {
    const hits = search('засор', uk);
    expect(hits.length).toBeGreaterThan(2);
    expect(hits.some((h) => h.elementId === 'elevator')).toBe(false);
  });

  it('учитывает особенности дома: лифта нет – его нет и в выдаче', () => {
    expect(search('лифт', tszh).some((h) => h.elementId === 'elevator')).toBe(false);
    expect(search('застрял в лифте', uk).some((h) => h.elementId === 'elevator')).toBe(true);
  });

  it('пустой, служебный или бессмысленный запрос возвращает пустой список', () => {
    expect(search('', uk)).toEqual([]);
    expect(search('   ', uk)).toEqual([]);
    expect(search('у меня не что', uk)).toEqual([]);
    expect(search('кто куда звонить', uk)).toEqual([]);
    expect(search('zzzzqqqq', uk)).toEqual([]);
    expect(search('!!!???', uk)).toEqual([]);
  });

  it('одинаковый запрос и дом – одинаковый результат', () => {
    expect(search('течёт кран', uk)).toEqual(search('течёт кран', uk));
  });

  it('каждый объект и каждая ситуация встречаются в выдаче не больше одного раза', () => {
    for (const q of ['течёт', 'нет воды', 'лампочка', 'засор', 'газ']) {
      const keys = search(q, uk, 50).map((h) => h.problemId ?? `e:${h.elementId}`);
      expect(new Set(keys).size, q).toBe(keys.length);
    }
  });
});

describe('диплинки', () => {
  it('кодирование → разбор возвращает исходные данные', () => {
    const raw = encodeDeepLink({ houseId: 'vch_korovina_11', problemId: 'roof__leak' });
    expect(raw).toBe('h_vch_korovina_11-p_roof__leak');
    expect(raw).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
    expect(decodeDeepLink(raw)).toEqual({ houseId: 'vch_korovina_11', problemId: 'roof__leak', elementId: 'roof' });
    expect(encodeDeepLink({ elementId: 'elevator' })).toBe('e_elevator');
    expect(decodeDeepLink('e_elevator')).toEqual({ elementId: 'elevator' });
  });

  it('каждая ситуация кодируется и разбирается без потерь', () => {
    for (const e of ALL_ELEMENTS) {
      for (const p of e.problems) {
        expect(decodeDeepLink(encodeDeepLink({ houseId: 'vch_pyatnitskiy_13', problemId: p.id }))).toEqual({ houseId: 'vch_pyatnitskiy_13', problemId: p.id, elementId: e.id });
      }
    }
  });

  it('мусорная строка не приводит к ошибке', () => {
    for (const s of ['p_nope', 'drop table;', '', 'h_-p_', '---', 'e_', 'a'.repeat(600), 'p_roof__leak;rm']) {
      expect(() => decodeDeepLink(s)).not.toThrow();
    }
    expect(decodeDeepLink('p_nope')).toEqual({});
    expect(decodeDeepLink('drop table;')).toEqual({});
    expect(decodeDeepLink(undefined)).toEqual({});
    expect(decodeDeepLink(null)).toEqual({});
    expect(decodeDeepLink('a'.repeat(600))).toEqual({});
  });
});

describe('шаблоны обращений', () => {
  it('подставляет адрес, организацию, дату и данные жителя; недостающее – заготовкой', () => {
    const { element, problem } = getProblem('roof__leak')!;
    const outcome = localizeOutcome(collectOutcomes(problem)[0]!, uk);
    const r = buildRequest('act', outcome, uk, { element, problem, user: { name: 'Иванов И. И.', flat: '42' }, date: new Date(2026, 8, 23) });
    expect(r.body).toContain('Иванов И. И.');
    expect(r.body).toContain('кв. 42');
    expect(r.body).toContain('[телефон]');
    expect(r.body).toContain('23.09.2026');
    expect(r.body).toContain('УК «Жилищно-ремонтный участок №1» (ИНН 3701043128)');
    expect(r.body).toContain('г. Вичуга, ул. Коровина, д. 11');
    expect(r.body).not.toMatch(/\{M/);
  });

  it('до выбора дома вместо адреса и организации остаются заготовки', () => {
    const { element, problem } = getProblem('roof__leak')!;
    const r = buildRequest('repair', collectOutcomes(problem)[0]!, getHouse('none'), { element, problem });
    expect(blanksOf(r.body)).toContain('[ФИО]');
    expect(blanksOf('Кому: УК. Всё заполнено.')).toEqual([]);
    expect(r.body).toContain('г. Вичуга, [улица, дом]');
    expect(r.body).toContain('[название управляющей организации]');
  });

  it('все четыре вида обращения собираются для ТСЖ без ошибок', () => {
    const { element, problem } = getProblem('radiator__cold')!;
    const outcome = collectOutcomes(problem)[0]!;
    for (const kind of ['repair', 'clarify', 'act', 'recalc'] as const) {
      const r = buildRequest(kind, outcome, tszh, { element, problem });
      expect(r.body, kind).toContain('ТСЖ «Старатели»');
      expect(r.body, kind).not.toMatch(/\{M|undefined/);
    }
  });
});

describe('данные жителя для обращения', () => {
  it('телефон: подсказка только для похожих на ошибку номеров', () => {
    for (const ok of [undefined, '', '+7 900 000-00-00', '8 (49354) 2-34-73', '+79001234567']) expect(phoneHint(ok), String(ok)).toBeUndefined();
    expect(phoneHint('12345')).toMatch(/неполный/);
    expect(phoneHint('+7 900 abc')).toMatch(/только цифры/);
    expect(phoneHint('1'.repeat(16))).toMatch(/Слишком много/);
  });

  it('из хранилища берутся только известные поля-строки в пределах длины', () => {
    expect(cleanUserInfo(null)).toEqual({});
    expect(cleanUserInfo('мусор')).toEqual({});
    expect(cleanUserInfo({ name: 'А'.repeat(500), flat: 42, phone: '+7 900 000-00-00', extra: 'x' })).toEqual({ name: 'А'.repeat(120), phone: '+7 900 000-00-00' });
  });
});
