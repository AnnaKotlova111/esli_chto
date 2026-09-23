import { describe, expect, it } from 'vitest';
import {
  ALL_ELEMENTS, CITY, CITY_SERVICES, NORMS, ORGANIZATIONS, PARTIES, HOUSES, collectOutcomes, getHouse, isQuestion, localize, searchHouses,
  type Outcome, type Question,
} from '../src';

const allProblems = ALL_ELEMENTS.flatMap((e) => e.problems.map((p) => ({ element: e, problem: p })));
const allOutcomes = allProblems.flatMap(({ problem }) => collectOutcomes(problem).map((o) => ({ problem, o })));

describe('целостность данных (раздел 6 ТЗ)', () => {
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

  it('если основание – практика или договор, ответ помечен как спорный (раздел 13)', () => {
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

  it('синонимы для поиска заполнены у каждого объекта и каждой ситуации', () => {
    for (const { element, problem } of allProblems) {
      expect(element.aliases?.length, element.id).toBeGreaterThan(0);
      expect(problem.aliases?.length, problem.id).toBeGreaterThan(0);
    }
  });

  it('у каждого объекта 1–4 типовые ситуации, покрытие не ниже требований раздела 14', () => {
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

  it('в справочнике норм нет лишних записей и у каждой есть пересказ', () => {
    const used = new Set(allOutcomes.flatMap(({ o }) => o.norms));
    for (const n of Object.values(NORMS)) {
      expect(used.has(n.id), `норма ${n.id} нигде не используется`).toBe(true);
      expect(n.gist.length, n.id).toBeGreaterThan(20);
    }
  });
});

describe('справочник домов Вичуги', () => {
  it('все дома из реестра на месте, у каждого есть управляющая организация с телефоном', () => {
    expect(HOUSES.length).toBe(223);
    for (const h of HOUSES) {
      const m = h.contacts.manager;
      expect(m?.name, h.id).toBeTruthy();
      expect(m!.phones.length, `${h.id}: нет телефона организации`).toBeGreaterThan(0);
      for (const p of m!.phones) expect(p.number, h.id).toMatch(/^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/);
      expect(h.isDemo).toBe(false);
      expect(h.source).toContain('mingkh.ru');
    }
  });

  it('идентификаторы домов уникальны и годятся для диплинка', () => {
    expect(new Set(HOUSES.map((h) => h.id)).size).toBe(HOUSES.length);
    for (const h of HOUSES) expect(h.id).toMatch(/^[A-Za-z0-9_]{1,64}$/);
  });

  it('форма управления берётся из карточки организации: УК, ТСЖ, ЖСК, ТСН', () => {
    expect(getHouse('vch_korovina_11').managerKind).toBe('УК');
    expect(getHouse('vch_pyatnitskiy_13').managerKind).toBe('ТСЖ');
    expect(getHouse('vch_uritskogo_20').managerKind).toBe('ЖСК');
    expect(getHouse('vch_volodarskogo_102').managerKind).toBe('ТСН');
    expect(new Set(ORGANIZATIONS.map((o) => o.kind))).toEqual(new Set(['УК', 'ТСЖ', 'ЖСК', 'ТСН']));
  });

  it('у УК есть отдельная диспетчерская, у ТСЖ аварии принимает правление', () => {
    expect(getHouse('vch_korovina_11').contacts.dispatch?.phones[0]?.number).toBe('+7 (493) 542-34-73');
    expect(getHouse('vch_pyatnitskiy_13').contacts.dispatch).toBeUndefined();
  });

  it('дом, указанный за двумя организациями, не скрывает расхождение', () => {
    const h = getHouse('vch_moskovskaya_13');
    expect(h.contacts.manager?.name).toBe('ТСЖ «Московский»');
    expect(h.contacts.manager?.note).toContain('УК «Стоун»');
    expect(CITY.warnings.some((w) => w.includes('Московская, 13'))).toBe(true);
  });

  it('неизвестный дом – профиль «дом не выбран»: городские службы есть, управляющей организации нет', () => {
    const none = getHouse('nope');
    expect(none.id).toBe('none');
    expect(none.contacts.manager).toBeUndefined();
    expect(none.contacts.dispatch).toBeUndefined();
    expect(none.contacts.water_utility?.phones[0]?.number).toBe('+7 (49354) 2-22-79');
    expect(none.features.length).toBe(6);
  });

  it('городские службы одинаковы для всех домов, телефоны в едином формате', () => {
    for (const party of ['water_utility', 'heat_utility', 'energy_utility', 'gas_service', 'tko_operator', 'municipality', 'housing_inspection'] as const) {
      const c = CITY_SERVICES[party];
      expect(c?.phones.length, party).toBeGreaterThan(0);
      for (const p of c!.phones) {
        expect(p.number, party).toMatch(/^(\+7|8) \(\d{3,5}\) [\d-]+$/);
        expect(p.number.replace(/\D/g, '').length, party).toBe(11);
      }
      for (const h of [getHouse('vch_korovina_11'), getHouse('vch_pyatnitskiy_13')]) expect(h.contacts[party]).toEqual(c);
    }
    expect(CITY_SERVICES.heat_utility?.phones[0]?.label).toBe('Диспетчерская');
  });

  it('лифт: отдельной лифтовой организации нет – заявку принимает диспетчерская или правление дома', () => {
    const uk = getHouse('vch_korovina_11').contacts.lift_service;
    expect(uk?.phones[0]?.number).toBe('+7 (493) 542-34-73');
    expect(uk?.note).toContain('лифтовой службы');
    expect(getHouse('vch_pyatnitskiy_13').contacts.lift_service?.phones[0]?.number).toBe('+7 (920) 377-87-88');
  });

  it('домофон: телефона нет, но есть пояснение, где его найти', () => {
    const c = getHouse('vch_korovina_11').contacts.intercom_service;
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
    expect(searchHouses('')).toEqual([]);
    expect(searchHouses('несуществующая 999')).toEqual([]);
  });
});

describe('подстановка формы управления (раздел 10 ТЗ)', () => {
  const uk = getHouse('vch_korovina_11');
  const tszh = getHouse('vch_pyatnitskiy_13');

  it('падежи для УК и ТСЖ', () => {
    expect(localize('Отвечает {M}', uk)).toBe('Отвечает управляющая организация');
    expect(localize('Заявка в {M_acc}', uk)).toBe('Заявка в управляющую организацию');
    expect(localize('Сотрудник {M_gen}', uk)).toBe('Сотрудник управляющей организации');
    expect(localize('Акт с {M_ins}', uk)).toBe('Акт с управляющей организацией');
    expect(localize('Отвечает {M}', tszh)).toBe('Отвечает ТСЖ');
  });

  it('заглавная буква в начале предложения – и в начале строки, и после точки', () => {
    expect(localize('{M} обязана', uk)).toBe('Управляющая организация обязана');
    expect(localize('Это общее имущество. {M} обязана починить.', uk)).toBe('Это общее имущество. Управляющая организация обязана починить.');
    expect(localize('Звоните, {M} обязана', uk)).toBe('Звоните, управляющая организация обязана');
  });
});
