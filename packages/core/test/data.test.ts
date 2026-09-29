import { describe, expect, it } from 'vitest';
import {
  ADDRESS_EXAMPLES, ALL_ELEMENTS, CITY, CITY_SERVICES, NORMS, NORM_CHECKS, ORGANIZATIONS, PARTIES, HOUSES, collectOutcomes, formatDateRu, getHouse, hasUnsureOption,
  isHouseChosen, isQuestion, localize, normsCheckSummary, searchHouses,
  type Outcome, type Question,
} from '../src';
import { BOARD_HOUSE, PILOT, UK_HOUSE, addressQuery, dispatchPhone, managerPhone } from './fixtures';

const allProblems = ALL_ELEMENTS.flatMap((e) => e.problems.map((p) => ({ element: e, problem: p })));
const allOutcomes = allProblems.flatMap(({ problem }) => collectOutcomes(problem).map((o) => ({ problem, o })));
/** Один вид номера во всём справочнике: +7 (493) 543-58-33, бесплатные линии – 8 (800) 350-42-12; экстренные – 112, 104, 102. */
const PHONE = /^(\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}|8 \(800\) \d{3}-\d{2}-\d{2})$/;

describe('целостность данных', () => {
  it('id объектов и ситуаций уникальны во всём проекте', () => {
    const el = ALL_ELEMENTS.map((e) => e.id);
    expect(new Set(el).size).toBe(el.length);
    const pr = allProblems.map(({ problem }) => problem.id);
    expect(new Set(pr).size).toBe(pr.length);
  });

  it('id подходят для параметра запуска: [A-Za-z0-9_], ситуация = <объект>__<slug>', () => {
    for (const { element, problem } of allProblems) {
      expect(element.id).toMatch(/^[A-Za-z0-9_]+$/);
      expect(problem.id).toMatch(/^[A-Za-z0-9_]+$/);
      expect(problem.id.startsWith(`${element.id}__`), problem.id).toBe(true);
    }
    for (const h of HOUSES) expect(h.id).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('у каждого ответа есть ответственный, хотя бы один шаг и хотя бы одна норма из справочника', () => {
    for (const { problem, o } of allOutcomes) {
      expect(o.responsible.length, problem.id).toBeGreaterThan(0);
      for (const r of o.responsible) expect(PARTIES[r], `${problem.id}: ${r}`).toBeDefined();
      expect(o.steps.length, `${problem.id} без шагов`).toBeGreaterThan(0);
      expect(o.norms.length, `${problem.id} без нормы`).toBeGreaterThan(0);
      for (const n of o.norms) expect(NORMS[n], `${problem.id}: неизвестная норма ${n}`).toBeDefined();
    }
  });

  it('каждый спорный ответ предлагает шаблон обращения', () => {
    for (const { problem, o } of allOutcomes) {
      if (o.certainty === 'disputed') expect(o.request, `${problem.id}: спорный без шаблона`).toBeDefined();
    }
  });

  it('если основание – практика или договор, ответ помечен как спорный', () => {
    for (const { problem, o } of allOutcomes) {
      if (o.basis !== 'norm') expect(o.certainty, `${problem.id}: «${o.headline}»`).toBe('disputed');
    }
  });

  it('уверенный ответ опирается хотя бы на одну сверенную норму', () => {
    for (const { problem, o } of allOutcomes) {
      if (o.certainty === 'clear') {
        expect(o.norms.some((n) => NORMS[n]?.verified), `${problem.id}: «${o.headline}»`).toBe(true);
      }
    }
  });

  it('у каждого вопроса минимум два варианта, глубина дерева ограничена', () => {
    const walk = (n: Outcome | Question, depth: number, id: string) => {
      expect(depth, id).toBeLessThan(4);
      if (isQuestion(n)) {
        expect(n.options.length, id).toBeGreaterThanOrEqual(2);
        n.options.forEach((opt) => walk(opt.next, depth + 1, id));
      }
    };
    for (const { problem } of allProblems) walk(problem.rule, 0, problem.id);
  });

  it('в каждом вопросе есть вариант «Не знаю», кроме вопросов о том, что житель видит сам', () => {
    // Где окно, когда шумят, нужен ли проезд скорой прямо сейчас – ответ известен, «не знаю» тут лишнее.
    const obvious = new Set(['facade_windows__broken', 'neighbors__noise', 'parking__blocked']);
    const walk = (n: Outcome | Question, id: string) => {
      if (!isQuestion(n)) return;
      expect(hasUnsureOption(n), `${id}: «${n.ask}»`).toBe(!obvious.has(id));
      n.options.forEach((o) => walk(o.next, id));
    };
    for (const { problem } of allProblems) walk(problem.rule, problem.id);
  });

  it('синонимы для поиска заполнены у каждого объекта и каждой ситуации', () => {
    for (const { element, problem } of allProblems) {
      expect(element.aliases?.length, element.id).toBeGreaterThan(0);
      expect(problem.aliases?.length, problem.id).toBeGreaterThan(0);
    }
  });

  it('у каждого объекта 1–4 типовые ситуации, общее покрытие не меньше заявленного', () => {
    for (const e of ALL_ELEMENTS) {
      expect(e.problems.length, e.id).toBeGreaterThanOrEqual(1);
      expect(e.problems.length, e.id).toBeLessThanOrEqual(5);
    }
    expect(ALL_ELEMENTS.length).toBeGreaterThanOrEqual(55);
    expect(allProblems.length).toBeGreaterThanOrEqual(125);
  });

  it('в текстах не остаётся неразвёрнутых подстановок ни для одной формы управления', () => {
    for (const house of HOUSES) {
      for (const { problem, o } of allOutcomes) {
        const all = [o.headline, o.why, o.note ?? '', ...o.steps].map((s) => localize(s, house)).join(' ');
        expect(all, problem.id).not.toMatch(/\{M/);
      }
    }
  });

  it('сводка сверки норм совпадает с журналом: число сверенных и дата последней сверки', () => {
    const s = normsCheckSummary();
    expect(s.total).toBe(Object.keys(NORMS).length);
    expect(s.verified).toBe(Object.values(NORMS).filter((n) => n.verified).length);
    expect(Object.keys(NORM_CHECKS).length).toBe(s.verified);
    const key = (date: string) => date.split('.').reverse().join('');
    for (const c of Object.values(NORM_CHECKS)) expect(key(c.date) <= key(s.lastChecked)).toBe(true);
  });

  it('в справочнике норм нет лишних записей и у каждой есть пересказ', () => {
    const used = new Set(allOutcomes.flatMap(({ o }) => o.norms));
    for (const n of Object.values(NORMS)) {
      expect(used.has(n.id), `норма ${n.id} нигде не используется`).toBe(true);
      expect(n.gist.length, n.id).toBeGreaterThan(20);
    }
  });
});

describe(`справочник подключённого города (${CITY.name})`, () => {
  it('у каждого дома есть организация с телефоном в едином формате', () => {
    expect(HOUSES.length).toBeGreaterThan(0);
    for (const h of HOUSES) {
      const m = h.contacts.manager;
      expect(m?.name, h.id).toBeTruthy();
      expect(m!.phones.length, `${h.id}: нет телефона организации`).toBeGreaterThan(0);
      for (const p of m!.phones) expect(p.number, h.id).toMatch(PHONE);
      expect(h.isDemo).toBe(CITY.demo);
      expect(h.source).toBe(CITY.source);
    }
  });

  it('идентификаторы домов уникальны и годятся для диплинка', () => {
    expect(new Set(HOUSES.map((h) => h.id)).size).toBe(HOUSES.length);
    for (const h of HOUSES) expect(h.id).toMatch(/^[A-Za-z0-9_]{1,64}$/);
  });

  it('форма управления – одна из УК, ТСЖ, ЖСК, ТСН', () => {
    for (const o of ORGANIZATIONS) expect(['УК', 'ТСЖ', 'ЖСК', 'ТСН']).toContain(o.kind);
    expect(UK_HOUSE.managerKind).toBe('УК');
    expect(BOARD_HOUSE.managerKind).not.toBe('УК');
  });

  it('у УК есть отдельная диспетчерская, у ТСЖ, ЖСК и ТСН без неё аварии принимает правление', () => {
    expect(UK_HOUSE.contacts.dispatch?.phones[0]?.number).toMatch(PHONE);
    expect(BOARD_HOUSE.contacts.dispatch).toBeUndefined();
  });

  it('дата актуальности показывается в привычном виде, выбор дома определяется одной проверкой', () => {
    expect(CITY.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatDateRu('2026-09-23')).toBe('23.09.2026');
    expect(isHouseChosen(UK_HOUSE)).toBe(true);
    expect(isHouseChosen(getHouse(undefined))).toBe(false);
    expect(isHouseChosen(getHouse('нет такого'))).toBe(false);
  });

  it('неизвестный дом – профиль «дом не выбран»: городские службы есть, управляющей организации нет', () => {
    const none = getHouse('nope');
    expect(none.id).toBe('none');
    expect(none.contacts.manager).toBeUndefined();
    expect(none.contacts.dispatch).toBeUndefined();
    expect(none.contacts.water_utility).toEqual(CITY_SERVICES.water_utility);
    expect(none.features.length).toBe(6);
  });

  it('городские службы одинаковы для всех домов, телефоны в едином формате', () => {
    for (const party of ['water_utility', 'heat_utility', 'energy_utility', 'gas_service', 'tko_operator', 'municipality', 'housing_inspection'] as const) {
      const c = CITY_SERVICES[party];
      expect(c?.phones.length, `services.csv: нет телефона у ${party}`).toBeGreaterThan(0);
      for (const p of c!.phones) expect(p.number, party).toMatch(PHONE);
      for (const h of [UK_HOUSE, BOARD_HOUSE]) expect(h.contacts[party]).toEqual(c);
    }
  });

  it('все номера всех домов – в одном формате (кроме коротких экстренных)', () => {
    for (const h of HOUSES) {
      for (const [party, c] of Object.entries(getHouse(h.id).contacts)) {
        for (const p of c?.phones ?? []) {
          if (/^\d{3}$/.test(p.number)) continue;
          expect(p.number, `${h.id} ${party}`).toMatch(PHONE);
        }
      }
    }
  });

  it('лифт без своего телефона в services.csv – заявку принимает диспетчерская или правление дома', () => {
    if (CITY_SERVICES.lift_service?.phones.length) return;
    expect(UK_HOUSE.contacts.lift_service?.phones).toEqual(UK_HOUSE.contacts.dispatch?.phones);
    expect(BOARD_HOUSE.contacts.lift_service?.phones).toEqual(BOARD_HOUSE.contacts.manager?.phones);
  });

  it('поиск дома по адресу в свободной форме', () => {
    expect(searchHouses(addressQuery(UK_HOUSE))[0]?.id).toBe(UK_HOUSE.id);
    expect(searchHouses(addressQuery(BOARD_HOUSE))[0]?.id).toBe(BOARD_HOUSE.id);
    expect(searchHouses('')).toEqual([]);
    expect(searchHouses('несуществующая 999')).toEqual([]);
  });

  it('примеры адресов в подсказках – из данных города, и по каждому находится дом', () => {
    expect(ADDRESS_EXAMPLES.length).toBeGreaterThan(0);
    for (const a of ADDRESS_EXAMPLES) expect(searchHouses(a).length, `meta.json → addressExamples: «${a}» не находит дом`).toBeGreaterThan(0);
  });
});

describe.runIf(PILOT)('пилот: справочник Вичуги', () => {
  it('все 223 дома из реестра на месте, источник – открытые данные', () => {
    expect(HOUSES.length).toBe(223);
    expect(CITY.demo).toBe(false);
    for (const h of HOUSES) expect(h.source).toContain('mingkh.ru');
  });

  it('форма управления берётся из карточки организации: УК, ТСЖ, ЖСК, ТСН', () => {
    expect(getHouse('vch_korovina_11').managerKind).toBe('УК');
    expect(getHouse('vch_pyatnitskiy_13').managerKind).toBe('ТСЖ');
    expect(getHouse('vch_uritskogo_20').managerKind).toBe('ЖСК');
    expect(getHouse('vch_volodarskogo_102').managerKind).toBe('ТСН');
    expect(new Set(ORGANIZATIONS.map((o) => o.kind))).toEqual(new Set(['УК', 'ТСЖ', 'ЖСК', 'ТСН']));
  });

  it('телефоны из источника: диспетчерская УК, правление ТСЖ, водоснабжение', () => {
    expect(dispatchPhone(UK_HOUSE)).toBe('+7 (493) 542-34-73');
    expect(managerPhone(BOARD_HOUSE)).toBe('+7 (920) 377-87-88');
    expect(getHouse('nope').contacts.water_utility?.phones[0]?.number).toBe('+7 (493) 542-22-79');
    expect(CITY_SERVICES.heat_utility?.phones[0]?.label).toBe('Диспетчерская');
  });

  it('дом, указанный за двумя организациями, не скрывает расхождение', () => {
    const h = getHouse('vch_moskovskaya_13');
    expect(h.contacts.manager?.name).toBe('ТСЖ «Московский»');
    expect(h.contacts.manager?.note).toContain('УК «Стоун»');
    expect(CITY.warnings.some((w) => w.includes('Московская, 13'))).toBe(true);
  });

  it('лифт: отдельной лифтовой организации нет – заявку принимает диспетчерская или правление дома', () => {
    const uk = UK_HOUSE.contacts.lift_service;
    expect(uk?.phones[0]?.number).toBe('+7 (493) 542-34-73');
    expect(uk?.note).toContain('лифтовой службы');
    expect(BOARD_HOUSE.contacts.lift_service?.phones[0]?.number).toBe('+7 (920) 377-87-88');
  });

  it('домофон: телефона нет, но есть пояснение, где его найти', () => {
    const c = UK_HOUSE.contacts.intercom_service;
    expect(c?.phones).toEqual([]);
    expect(c?.note).toContain('на панели домофона');
  });

  it('поиск дома по адресу в свободной форме', () => {
    expect(searchHouses('Коровина 11')[0]?.id).toBe('vch_korovina_11');
    expect(searchHouses('ул. 50 лет Октября, д. 15а')[0]?.id).toBe('vch_50_let_oktyabrya_15a');
    expect(searchHouses('пятницкий 13')[0]?.id).toBe('vch_pyatnitskiy_13');
    expect(searchHouses('Каменка Николаева 5')[0]?.id).toBe('vch_kamenka_nikolaeva_5');
    expect(searchHouses('коровина').length).toBeGreaterThan(5);
    expect(searchHouses('коровина').every((h) => h.title.includes('Коровина'))).toBe(true);
  });
});

describe('подстановка формы управления', () => {
  const uk = UK_HOUSE;
  const board = BOARD_HOUSE;

  it('падежи для УК; у ТСЖ, ЖСК и ТСН – их название', () => {
    expect(localize('Отвечает {M}', uk)).toBe('Отвечает управляющая организация');
    expect(localize('Заявка в {M_acc}', uk)).toBe('Заявка в управляющую организацию');
    expect(localize('Сотрудник {M_gen}', uk)).toBe('Сотрудник управляющей организации');
    expect(localize('Акт с {M_ins}', uk)).toBe('Акт с управляющей организацией');
    expect(localize('Отвечает {M}', board)).toBe(`Отвечает ${board.managerKind}`);
  });

  it('заглавная буква в начале предложения – и в начале строки, и после точки', () => {
    expect(localize('{M} обязана', uk)).toBe('Управляющая организация обязана');
    expect(localize('Это общее имущество. {M} обязана починить.', uk)).toBe('Это общее имущество. Управляющая организация обязана починить.');
    expect(localize('Звоните, {M} обязана', uk)).toBe('Звоните, управляющая организация обязана');
  });
});
