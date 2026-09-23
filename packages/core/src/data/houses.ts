import type { Contact, Feature, HouseProfile, ManagerKind, PartyId } from '../types';
import city from './city.json';

/**
 * Справочник домов города. Данные – из открытых источников (см. data/<город>/ и docs/DATA.md),
 * собираются скриптом scripts/import-houses.mjs в city.json. Здесь они превращаются в профили домов:
 * в ответы подставляются контакты управляющей организации дома, её диспетчерской и городских служб.
 */

interface Organization {
  id: string;
  name: string;
  short: string;
  kind: ManagerKind;
  address?: string;
  phones: string[];
  dispatch: string[];
  housesDeclared?: number;
  inn?: string;
  ogrn?: string;
  email?: string;
  site?: string;
}

interface CityHouse {
  id: string;
  street: string;
  streetName: string;
  streetType: string;
  number: string;
  settlement: string;
  address: string;
  orgId: string;
  alsoOrgIds?: string[];
}

interface CityData {
  city: string;
  services: Partial<Record<PartyId, Contact>>;
  region: string;
  settlements: Record<string, string>;
  source: string;
  updatedAt: string;
  organizations: Organization[];
  houses: CityHouse[];
  warnings: string[];
}

const DATA = city as unknown as CityData;

/** О городе и источнике данных – для интерфейса и документации. */
export const CITY = {
  name: DATA.city,
  region: DATA.region,
  settlements: DATA.settlements,
  source: DATA.source,
  updatedAt: DATA.updatedAt,
  /** Замечания к данным, найденные при импорте (дубли адресов, расхождения) */
  warnings: DATA.warnings,
};

export const ORGANIZATIONS: Organization[] = DATA.organizations;

/** Городские службы – одинаковы для всех домов города (водоканал, теплосеть, администрация и т. д.). */
export const CITY_SERVICES: Partial<Record<PartyId, Contact>> = DATA.services ?? {};
const orgById = new Map(ORGANIZATIONS.map((o) => [o.id, o]));

export const ALL_FEATURES: Feature[] = ['elevator', 'garbage_chute', 'gas', 'central_heating', 'intercom', 'basement'];

/** «Ивановская обл., г. Вичуга, ул. Мира, д. 29Б» → «г. Вичуга, ул. Мира, д. 29Б» */
const shortAddress = (a?: string) => a?.replace(/^[^,]*обл\.,\s*/, '');

function contactsOf(org: Organization, also: Organization[]): Partial<Record<PartyId, Contact>> {
  const note = also.length
    ? `В открытых данных дом также указан за ${also.map((o) => `${o.short}${o.phones[0] ? ` (${o.phones[0]})` : ''}`).join(', ')}. Уточните по квитанции, кто управляет домом.`
    : undefined;
  const manager: Contact = {
    name: org.short,
    phones: org.phones.map((number) => ({ label: org.kind === 'УК' ? 'Приёмная' : 'Правление', number })),
    address: shortAddress(org.address),
    email: org.email,
    site: org.site,
    inn: org.inn,
    note,
  };
  // Отдельной диспетчерской у ТСЖ и ЖСК в данных нет – тогда аварии принимает правление (см. resolveParties).
  const dispatch: Contact | undefined = org.dispatch.length
    ? { name: `Диспетчерская ${org.short}`, phones: org.dispatch.map((number) => ({ label: 'Диспетчерская', number })) }
    : undefined;
  // Лифты обслуживают подрядчики управляющих организаций – заявку принимает диспетчерская (или правление) дома.
  const liftNote = CITY_SERVICES.lift_service;
  const lift: Contact | undefined =
    liftNote && !liftNote.phones.length
      ? { name: (dispatch ?? manager).name, phones: (dispatch ?? manager).phones, note: liftNote.note }
      : undefined;
  return { ...CITY_SERVICES, ...(lift ? { lift_service: lift } : {}), manager, ...(dispatch ? { dispatch } : {}) };
}

export const HOUSES: HouseProfile[] = DATA.houses.map((h) => {
  const org = orgById.get(h.orgId);
  if (!org) throw new Error(`Нет организации ${h.orgId} для дома ${h.id}`);
  const also = (h.alsoOrgIds ?? []).map((id) => orgById.get(id)).filter((o): o is Organization => Boolean(o));
  return {
    id: h.id,
    title: `${h.street}, ${h.number}${h.settlement === DATA.city ? '' : ` (${h.settlement})`}`,
    address: h.address,
    city: h.settlement,
    managerKind: org.kind,
    features: ALL_FEATURES,
    featuresKnown: false,
    contacts: contactsOf(org, also),
    isDemo: false,
    updatedAt: DATA.updatedAt,
    source: DATA.source,
  };
});

/**
 * Профиль до выбора дома: объекты показываются все, городские службы – сразу, контакты управляющей
 * организации и её диспетчерской (она же принимает заявки по лифту) – после выбора адреса.
 */
export const NO_HOUSE: HouseProfile = {
  id: 'none',
  title: 'Дом не выбран',
  address: `г. ${DATA.city}`,
  city: DATA.city,
  managerKind: 'УК',
  features: ALL_FEATURES,
  featuresKnown: false,
  contacts: Object.fromEntries(Object.entries(CITY_SERVICES).filter(([id]) => id !== 'lift_service')),
  isDemo: false,
  updatedAt: DATA.updatedAt,
  source: DATA.source,
};

export const DEFAULT_HOUSE_ID = NO_HOUSE.id;

const houseById = new Map(HOUSES.map((h) => [h.id, h]));

export const isKnownHouse = (id: string | undefined | null): boolean => Boolean(id && houseById.has(id));

export function getHouse(id: string | undefined | null): HouseProfile {
  return (id && houseById.get(id)) || NO_HOUSE;
}

/** Профиль с особенностями, которые отметил житель (лифт, газ и т. д.). */
export function withFeatures(house: HouseProfile, features: Feature[] | undefined): HouseProfile {
  if (!features) return house;
  return { ...house, features: ALL_FEATURES.filter((f) => features.includes(f)), featuresKnown: true };
}

/** Организация, управляющая домом, – для карточки дома и списка домов в боте. */
export const organizationOf = (houseId: string): Organization | undefined => {
  const h = DATA.houses.find((x) => x.id === houseId);
  return h ? orgById.get(h.orgId) : undefined;
};

// ─────────────────────────── Поиск дома по адресу ───────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const WORD_NOISE = new Set(['ул', 'улица', 'пер', 'переулок', 'д', 'дом', 'г', 'город', 'кв', 'квартира', 'пос', 'поселок', norm(DATA.city)]);

const index = DATA.houses.map((h) => ({
  id: h.id,
  words: norm(`${h.streetName} ${h.settlement === DATA.city ? '' : h.settlement}`).split(/[^а-яa-z0-9]+/).filter(Boolean),
  number: norm(h.number).replace(/\s+/g, ''),
}));

/**
 * Поиск дома по свободно введённому адресу: «коровина 11», «ул. 50 лет Октября, 15а», «пятницкий 13».
 * Слова сравниваются по началу (падежи и сокращения), номер дома – точно или по началу.
 */
export function searchHouses(query: string, limit = 20): HouseProfile[] {
  const tokens = norm(query).split(/[^а-яa-z0-9/]+/).filter((t) => t && !WORD_NOISE.has(t));
  if (tokens.length === 0) return [];
  // номер дома – последний токен, начинающийся с цифры, если перед ним есть слово улицы
  const numIdx = tokens.length > 1 && /^\d/.test(tokens[tokens.length - 1]!) ? tokens.length - 1 : -1;
  const number = numIdx >= 0 ? tokens[numIdx]! : undefined;
  const words = tokens.filter((_, i) => i !== numIdx);
  const stem = (w: string) => (w.length > 5 ? w.slice(0, -2) : w);
  const scored: { id: string; score: number }[] = [];
  for (const h of index) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const s = stem(w);
      const hit = h.words.some((hw) => hw.startsWith(s) || (/^\d+$/.test(w) && hw === w));
      if (!hit) {
        ok = false;
        break;
      }
      score += 2;
    }
    if (!ok) continue;
    if (number) {
      if (h.number === number) score += 5;
      else if (h.number.startsWith(number)) score += 2;
      else continue;
    }
    scored.push({ id: h.id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => houseById.get(s.id)!);
}
