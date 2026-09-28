/** Кто может нести ответственность / куда обращаться. */
export type PartyId =
  | 'manager' // УК / ТСЖ / ЖСК (название и тип берутся из профиля дома)
  | 'dispatch' // аварийно-диспетчерская служба (АДС)
  | 'owner' // собственник помещения (сам житель)
  | 'neighbor' // собственник соседнего помещения
  | 'water_utility' // водоканал (РСО)
  | 'heat_utility' // теплоснабжающая организация (РСО)
  | 'energy_utility' // энергосбыт / сетевая организация
  | 'gas_service' // организация по ТО газового оборудования
  | 'gas_emergency' // аварийная газовая служба (104)
  | 'tko_operator' // региональный оператор по обращению с ТКО
  | 'lift_service' // лифтовая организация
  | 'intercom_service' // обслуживающая домофон организация
  | 'municipality' // администрация района / муниципальная служба
  | 'housing_inspection' // государственная жилищная инспекция (ГЖИ)
  | 'police' // полиция / ГИБДД
  | 'telecom' // оператор связи (интернет, ТВ, телефон)
  | 'emergency112'; // единая служба спасения

/** Особенности дома: от них зависит, какие элементы показывать. */
export type Feature =
  | 'elevator'
  | 'garbage_chute'
  | 'gas'
  | 'central_heating'
  | 'intercom'
  | 'basement';

export type Scope = 'house' | 'flat';

/** Ссылка на норму в справочнике (norms.ts). */
export type NormId = string;

export interface NormRef {
  id: NormId;
  /** Короткая подпись для чипа: «ПП № 491, п. 5» */
  short: string;
  /** Полное название документа */
  doc: string;
  /** О чём норма – своими словами (пересказ, не цитата) */
  gist: string;
  url?: string;
  /** Проверено по полному тексту документа (см. docs/DATA.md) */
  verified: boolean;
}

/**
 * На чём основан вывод:
 *  norm     – прямая норма закона / постановления;
 *  practice – разъяснения, судебная практика, сложившийся порядок;
 *  contract – зависит от договора управления или договора с организацией.
 */
export type Basis = 'norm' | 'practice' | 'contract';

/** Однозначно ли решается вопрос ответственности. */
export type Certainty = 'clear' | 'disputed';

/**
 * emergency – угроза жизни или здоровью (пожар, газ, запертый человек, кипяток, искрит проводка):
 *             каждый исход обязан вести на 112 или 104;
 * urgent    – авария, которую нужно устранять немедленно (прорыв, нет света, залив), – АДС.
 */
export type Urgency = 'urgent' | 'emergency';

/** Категории проблем: одна категория на объект, для фильтра и раздела «Срочно». */
export type Category = 'water' | 'electricity' | 'gas' | 'heating' | 'elevator' | 'entrance' | 'trash' | 'other';

export type RequestKind = 'repair' | 'clarify' | 'act' | 'recalc';

export interface Outcome {
  /** Первый – основной ответственный, остальные – «также» */
  responsible: PartyId[];
  certainty: Certainty;
  basis: Basis;
  /** Короткий вердикт: «Отвечает управляющая организация» */
  headline: string;
  /** Почему именно так: граница ответственности простыми словами */
  why: string;
  /** Что делать по шагам */
  steps: string[];
  norms: NormId[];
  /** Доп. предупреждение / оговорка */
  note?: string;
  /** Какой шаблон обращения предложить */
  request?: RequestKind;
}

export interface Question {
  ask: string;
  hint?: string;
  options: { label: string; next: Outcome | Question }[];
}

export interface Problem {
  id: string;
  title: string;
  urgency?: Urgency;
  /** Синонимы и разговорные формулировки для поиска */
  aliases?: string[];
  /** Правило: либо сразу вердикт, либо цепочка уточняющих вопросов */
  rule: Outcome | Question;
}

export interface HouseElement {
  id: string;
  scope: Scope;
  /** Зона схемы (сцена): entrance, outside, technical, hall, kitchen ... */
  zone: string;
  title: string;
  /** Одна строка: что это */
  about: string;
  aliases?: string[];
  requires?: Feature[];
  problems: Problem[];
}

export interface Phone {
  label: string;
  number: string;
}

export interface Contact {
  name: string;
  phones: Phone[];
  hours?: string;
  email?: string;
  address?: string;
  site?: string;
  /** ИНН организации – подставляется в шапку обращения */
  inn?: string;
  /** Пояснение (например: «номер указан в кабине лифта») */
  note?: string;
}

/** Форма управления домом */
export type ManagerKind = 'УК' | 'ТСЖ' | 'ЖСК' | 'ТСН';

export interface HouseProfile {
  id: string;
  /** Короткое название для списка выбора: «ул. Коровина, 11» */
  title: string;
  /** Полный адрес: «г. Вичуга, ул. Коровина, д. 11» */
  address: string;
  /** Населённый пункт */
  city: string;
  managerKind: ManagerKind;
  /** Этажность и число подъездов – если известны из источника */
  floors?: number;
  entrances?: number;
  features: Feature[];
  /**
   * Известен ли набор особенностей. Если нет – показываются все объекты,
   * а житель может сам отметить, чего в его доме нет.
   */
  featuresKnown: boolean;
  contacts: Partial<Record<PartyId, Contact>>;
  /** Демонстрационные (вымышленные) данные – такие профили явно помечаются в интерфейсе. Задаётся в meta.json города. */
  isDemo: boolean;
  /** Дата актуальности данных профиля */
  updatedAt: string;
  /** Откуда данные */
  source: string;
}

export interface PartyInfo {
  id: PartyId;
  /** Название по умолчанию */
  title: string;
  /** Пояснение роли одной строкой */
  role: string;
  /** Ключ иконки из набора приложения (линейные иконки, см. apps/webapp/src/ui/icons.tsx) */
  icon: string;
  /** Есть ли у стороны контакты (у owner / neighbor нет) */
  hasContacts: boolean;
}

export interface ResolvedParty {
  id: PartyId;
  title: string;
  role: string;
  icon: string;
  contact?: Contact;
  /** Контакт не заполнен в профиле дома */
  missingContact: boolean;
}

export type Resolution =
  | { status: 'question'; question: Question; depth: number }
  | { status: 'outcome'; outcome: Outcome; depth: number };

export interface SearchHit {
  elementId: string;
  problemId?: string;
  title: string;
  /** Подпись: «Подъезд › Лифт» */
  path: string;
  scope: Scope;
  score: number;
}
