import { HOUSE_ELEMENTS as HOUSE_BASE } from './data/elements-house';
import { HOUSE_ELEMENTS_MORE } from './data/elements-house-more';
import { FLAT_ELEMENTS as FLAT_BASE } from './data/elements-flat';
import { FLAT_ELEMENTS_MORE } from './data/elements-flat-more';
import { PARTIES, NATIONAL_CONTACTS } from './data/parties';
import { getHouse } from './data/houses';
import type {
  Contact,
  HouseElement,
  HouseProfile,
  Outcome,
  PartyId,
  Problem,
  Question,
  Resolution,
  ResolvedParty,
  Scope,
  SearchHit,
} from './types';

// ─────────────────────────── Справочник ───────────────────────────

export const HOUSE_ELEMENTS: HouseElement[] = [...HOUSE_BASE, ...HOUSE_ELEMENTS_MORE];
export const FLAT_ELEMENTS: HouseElement[] = [...FLAT_BASE, ...FLAT_ELEMENTS_MORE];
export const ALL_ELEMENTS: HouseElement[] = [...HOUSE_ELEMENTS, ...FLAT_ELEMENTS];

const elementIndex = new Map(ALL_ELEMENTS.map((e) => [e.id, e]));
const problemIndex = new Map<string, { element: HouseElement; problem: Problem }>();
for (const element of ALL_ELEMENTS) {
  for (const problem of element.problems) problemIndex.set(problem.id, { element, problem });
}

export function getElement(id: string): HouseElement | undefined {
  return elementIndex.get(id);
}

export function getProblem(id: string): { element: HouseElement; problem: Problem } | undefined {
  return problemIndex.get(id);
}

/** Элементы, которые есть в этом доме (лифт, газ и т. п. могут отсутствовать). */
export function getElements(house: HouseProfile, scope?: Scope): HouseElement[] {
  return ALL_ELEMENTS.filter(
    (e) => (!scope || e.scope === scope) && (e.requires ?? []).every((f) => house.features.includes(f)),
  );
}

export function isElementAvailable(house: HouseProfile, element: HouseElement): boolean {
  return (element.requires ?? []).every((f) => house.features.includes(f));
}

// ─────────────────────── Подстановка формы управления ───────────────────────

const FORMS = {
  УК: {
    M: 'управляющая организация',
    M_gen: 'управляющей организации',
    M_dat: 'управляющей организации',
    M_acc: 'управляющую организацию',
    M_ins: 'управляющей организацией',
  },
  ТСЖ: { M: 'ТСЖ', M_gen: 'ТСЖ', M_dat: 'ТСЖ', M_acc: 'ТСЖ', M_ins: 'ТСЖ' },
  ЖСК: { M: 'ЖСК', M_gen: 'ЖСК', M_dat: 'ЖСК', M_acc: 'ЖСК', M_ins: 'ЖСК' },
  ТСН: { M: 'ТСН', M_gen: 'ТСН', M_dat: 'ТСН', M_acc: 'ТСН', M_ins: 'ТСН' },
} as const;

/**
 * Подставляет {M}, {M_gen}… под форму управления дома.
 * Если подстановка открывает предложение (начало строки, после «.», «!», «?» или перевода строки),
 * первая буква делается заглавной.
 */
export function localize(text: string, house: HouseProfile): string {
  const forms = FORMS[house.managerKind];
  return text.replace(/\{(M(?:_gen|_dat|_acc|_ins)?)\}/g, (_, key: keyof typeof forms, offset: number) => {
    const value: string = forms[key];
    const opensSentence = /(^|[.!?]\s+|\n\s*)$/.test(text.slice(0, offset));
    return opensSentence ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  });
}

export function localizeOutcome(o: Outcome, house: HouseProfile): Outcome {
  return {
    ...o,
    headline: localize(o.headline, house),
    why: localize(o.why, house),
    steps: o.steps.map((s) => localize(s, house)),
    note: o.note ? localize(o.note, house) : undefined,
  };
}

export function localizeQuestion(q: Question, house: HouseProfile): Question {
  return {
    ask: localize(q.ask, house),
    hint: q.hint ? localize(q.hint, house) : undefined,
    options: q.options.map((o) => ({ label: localize(o.label, house), next: o.next })),
  };
}

// ─────────────────────────── Решение по правилам ───────────────────────────

export const isQuestion = (x: Outcome | Question): x is Question => 'options' in x;

/** Вариант для тех, кто не может ответить на вопрос: «Не знаю…», «Не уверен(а)». */
export const isUnsureOption = (label: string): boolean => /^(не знаю|не уверен)/i.test(label.trim());
export const hasUnsureOption = (q: Question): boolean => q.options.some((o) => isUnsureOption(o.label));

/**
 * Проходит цепочку уточняющих вопросов по индексам выбранных ответов.
 * Принимает проблему или её id. Пустой массив – начало; недействительный индекс
 * останавливает разбор на текущем вопросе.
 */
export function resolve(problemOrId: Problem | string, answers: number[] = []): Resolution {
  const problem = typeof problemOrId === 'string' ? problemIndex.get(problemOrId)?.problem : problemOrId;
  if (!problem) throw new Error(`Unknown problem id: ${String(problemOrId)}`);
  let node: Outcome | Question = problem.rule;
  let depth = 0;
  for (const a of answers) {
    if (!isQuestion(node)) break;
    const next = node.options[a]?.next;
    if (!next) break;
    node = next;
    depth += 1;
  }
  return isQuestion(node)
    ? { status: 'question', question: node, depth }
    : { status: 'outcome', outcome: node, depth };
}

/** Все исходы задачи – нужно для проверок целостности данных и тестов. */
export function collectOutcomes(problem: Problem): Outcome[] {
  const acc: Outcome[] = [];
  const walk = (n: Outcome | Question) => {
    if (isQuestion(n)) n.options.forEach((o) => walk(o.next));
    else acc.push(n);
  };
  walk(problem.rule);
  return acc;
}

// ─────────────────────────── Контакты ───────────────────────────

const NO_CONTACT_FALLBACK: Partial<Record<PartyId, PartyId>> = { dispatch: 'manager' };

export function resolveParties(house: HouseProfile, ids: PartyId[]): ResolvedParty[] {
  return ids.map((id) => {
    const info = PARTIES[id];
    let contact: Contact | undefined =
      id === 'emergency112'
        ? { ...NATIONAL_CONTACTS.emergency112, phones: [...NATIONAL_CONTACTS.emergency112.phones] }
        : id === 'gas_emergency'
          ? { ...NATIONAL_CONTACTS.gas_emergency, phones: [...NATIONAL_CONTACTS.gas_emergency.phones] }
          : id === 'police'
            ? { ...NATIONAL_CONTACTS.police, phones: [...NATIONAL_CONTACTS.police.phones] }
            : house.contacts[id];
    if (!contact && NO_CONTACT_FALLBACK[id]) contact = house.contacts[NO_CONTACT_FALLBACK[id]!];
    const title =
      id === 'manager' && contact ? contact.name : id === 'manager' ? FORMS[house.managerKind].M : info.title;
    return {
      id,
      title: id === 'manager' ? capitalize(title) : title,
      role: info.role,
      icon: info.icon,
      contact,
      missingContact: info.hasContacts && !contact,
    };
  });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ─────────────────────────── Срочные ситуации ───────────────────────────

const EMERGENCY_PARTIES: PartyId[] = ['gas_emergency', 'emergency112'];

/** Экстренная служба исхода (104 или 112), если она есть среди ответственных. */
export function emergencyPartyOf(outcome: Outcome): PartyId | undefined {
  return outcome.responsible.find((p) => EMERGENCY_PARTIES.includes(p));
}

export interface UrgentItem {
  element: HouseElement;
  problem: Problem;
  /** Куда звонить сразу: экстренная служба при угрозе жизни, иначе АДС */
  call: PartyId;
}

/**
 * Все аварийные и срочные ситуации, доступные в доме: сначала угрозы жизни (112 / 104), затем аварии (АДС).
 * Номер для звонка берётся из исходов ситуации, без прохождения уточняющих вопросов.
 */
export function urgentProblems(house: HouseProfile): UrgentItem[] {
  const items: UrgentItem[] = [];
  for (const element of getElements(house)) {
    for (const problem of element.problems) {
      if (!problem.urgency) continue;
      const outcomes = collectOutcomes(problem);
      const emergency = outcomes.map(emergencyPartyOf).find((p): p is PartyId => Boolean(p));
      const first = outcomes[0]?.responsible ?? [];
      const call: PartyId =
        problem.urgency === 'emergency' && emergency ? emergency : first.includes('dispatch') ? 'dispatch' : (first[0] ?? 'dispatch');
      items.push({ element, problem, call });
    }
  }
  const rank = (i: UrgentItem) => (i.problem.urgency === 'emergency' ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b));
}

// ─────────────────────────── Поиск ───────────────────────────

const STOP = new Set([
  'у', 'в', 'на', 'не', 'что', 'как', 'мне', 'мой', 'моя', 'моё', 'мои', 'это', 'и', 'из', 'с', 'со', 'по', 'для', 'кто',
  'кому', 'куда', 'звонить', 'обратиться', 'обращаться', 'если', 'то', 'а', 'но', 'или', 'же', 'ли', 'от', 'до', 'при',
  'за', 'над', 'под', 'нас', 'нам', 'наш', 'вас', 'есть', 'был', 'была', 'нужно', 'надо', 'помогите',
  'я', 'меня', 'мы', 'вы', 'он', 'она', 'они', 'его', 'её', 'ее', 'их', 'уже', 'очень', 'просто', 'опять', 'снова', 'тут', 'там',
  'здесь', 'вот', 'так', 'почему', 'зачем', 'делать', 'подскажите', 'пожалуйста', 'еще', 'ещё',
]);

export const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Грубая основа слова для сравнения по началу: короткие слова почти не режем, чтобы «засор» не совпадал с «застрял». */
const stem = (w: string): string => (w.length >= 8 ? w.slice(0, -3) : w.length >= 6 ? w.slice(0, -2) : w.length === 5 ? w.slice(0, -1) : w);

function tokensOf(q: string): string[] {
  return normalize(q)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function scoreText(haystack: string, query: string, tokens: string[]): number {
  if (!haystack) return 0;
  let score = 0;
  if (query && haystack.includes(query)) score += 8;
  let matched = 0;
  for (const t of tokens) {
    const s = stem(t);
    const re = new RegExp(`(^| )${escapeRe(s)}`);
    if (re.test(haystack)) {
      matched += 1;
      score += 3;
    }
  }
  if (tokens.length > 0 && matched === tokens.length) score += 4;
  return score;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ZONE_TITLES: Record<string, string> = {
  outside: 'Двор и фасад',
  entrance: 'Подъезд',
  technical: 'Подвал и сети',
  hall: 'Прихожая',
  kitchen: 'Кухня',
  bath: 'Санузел',
  room: 'Комната',
  balcony: 'Балкон',
};

export const zoneTitle = (zone: string): string => ZONE_TITLES[zone] ?? zone;

export function search(queryRaw: string, house: HouseProfile, limit = 12): SearchHit[] {
  const query = normalize(queryRaw);
  const tokens = tokensOf(queryRaw);
  if (!query || tokens.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const element of getElements(house)) {
    const eText = normalize([element.title, element.about, ...(element.aliases ?? [])].join(' '));
    const eScore = scoreText(eText, query, tokens);
    const path = `${zoneTitle(element.zone)} › ${element.title}`;
    if (eScore > 0) {
      hits.push({ elementId: element.id, title: element.title, path: zoneTitle(element.zone), scope: element.scope, score: eScore });
    }
    for (const problem of element.problems) {
      const pText = normalize([problem.title, ...(problem.aliases ?? [])].join(' '));
      const pScore = scoreText(pText, query, tokens) + (eScore > 0 ? 2 : 0);
      if (pScore > 3) {
        hits.push({ elementId: element.id, problemId: problem.id, title: problem.title, path, scope: element.scope, score: pScore + 1 });
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ─────────────────────────── Диплинки ───────────────────────────
// Формат start_param в MAX: до 512 символов, только [A-Za-z0-9_-].
//   e_<elementId>   – открыть карточку элемента
//   p_<problemId>   – открыть проблему
//   h_<houseId>     – выбрать дом (можно объединять: h_vch_korovina_11-p_roof__leak)

export type DeepLink = { houseId?: string; elementId?: string; problemId?: string };

export function encodeDeepLink(d: DeepLink): string {
  const parts: string[] = [];
  if (d.houseId) parts.push(`h_${d.houseId}`);
  if (d.problemId) parts.push(`p_${d.problemId}`);
  else if (d.elementId) parts.push(`e_${d.elementId}`);
  return parts.join('-');
}

export function decodeDeepLink(raw: string | undefined | null): DeepLink {
  const out: DeepLink = {};
  if (!raw || !/^[A-Za-z0-9_-]{1,512}$/.test(raw)) return out;
  for (const part of raw.split('-')) {
    const m = /^([hep])_(.+)$/.exec(part);
    if (!m) continue;
    const [, kind, id] = m as unknown as [string, string, string];
    if (kind === 'h') out.houseId = id;
    if (kind === 'e' && elementIndex.has(id)) out.elementId = id;
    if (kind === 'p') {
      const found = problemIndex.get(id);
      if (found) {
        out.problemId = id;
        out.elementId = found.element.id;
      }
    }
  }
  return out;
}

export { getHouse };
