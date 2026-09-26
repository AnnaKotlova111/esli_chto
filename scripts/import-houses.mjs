// Импорт реестра домов и управляющих организаций города в справочник приложения.
//
// Источник: data/<город>/houses.csv (адрес дома → организация), data/<город>/organizations.csv
// (карточки организаций) и data/<город>/services.csv (городские службы: водоканал, теплосеть и т. д.).
// Результат: packages/core/src/data/city.json – его читают мини-приложение и бот.
// Скрипт проверяет данные и печатает предупреждения: дубли адресов, организации без домов,
// расхождение числа домов с карточкой. Так же подключается любой другой город (docs/SCALING.md).
//
// Запуск: npm run data:import            (по умолчанию data/vichuga)
//         node scripts/import-houses.mjs data/<город>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, process.argv[2] ?? 'data/vichuga');
const meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8'));

/** CSV по RFC 4180: запятая, кавычки, удвоенные кавычки внутри поля. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const EMPTY = new Set(['', '-', '–']);
const clean = (v) => (EMPTY.has(v ?? '') ? undefined : v);

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const slug = (s) =>
  s
    .toLowerCase()
    .split('')
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** «ул. Коровина» → { type: 'ул.', name: 'Коровина' }; «Пятницкий пер.» → { type: 'пер.', name: 'Пятницкий' } */
function splitStreet(street) {
  const m = /^(ул\.|пер\.|пр-т|просп\.|пл\.|проезд|б-р|ш\.)\s+(.+)$/.exec(street) ?? /^(.+?)\s+(ул\.|пер\.|пр-т|просп\.|пл\.|проезд|б-р|ш\.)$/.exec(street);
  if (!m) return { type: '', name: street };
  return m[1].endsWith('.') || m[1].length < 8 ? { type: m[1], name: m[2] } : { type: m[2], name: m[1] };
}

/**
 * Один вид для всех номеров: «+7 (493) 543-58-33», бесплатные линии – «8 (800) 350-42-12».
 * В источниках встречается и «+7 (49354) 3-58-33» – это тот же номер, записанный с кодом города.
 */
const formatPhone = (s) => {
  const d = s.replace(/\D/g, '');
  if (d.length !== 11 || !/^[78]/.test(d)) throw new Error(`Телефон «${s}»: нужно 11 цифр, начиная с +7 или 8`);
  const r = d.slice(1);
  const lead = d[0] === '8' && r.startsWith('800') ? '8' : '+7';
  return `${lead} (${r.slice(0, 3)}) ${r.slice(3, 6)}-${r.slice(6, 8)}-${r.slice(8)}`;
};

const phonesOf = (v) =>
  (clean(v) ?? '')
    .split(/[;,]\s*(?=\+?\d)/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(formatPhone);

const warnings = [];
const orgRows = parseCsv(readFileSync(resolve(dir, 'organizations.csv'), 'utf8'));
const houseRows = parseCsv(readFileSync(resolve(dir, 'houses.csv'), 'utf8'));

// ───────────── Организации ─────────────

const KINDS = new Set(['УК', 'ТСЖ', 'ЖСК', 'ТСН']);
const organizations = orgRows.map((r) => {
  if (!KINDS.has(r.type)) throw new Error(`Неизвестный тип организации «${r.type}» у «${r.name}»`);
  const quoted = /«(.+)»/.exec(r.name)?.[1] ?? r.name;
  const phones = phonesOf(r.phones);
  const dispatch = phonesOf(r.dispatch_phone);
  if (!phones.length && !dispatch.length) warnings.push(`У организации «${r.name}» нет ни одного телефона`);
  return {
    id: `${slug(r.type)}_${slug(quoted)}`,
    name: r.name,
    short: `${r.type} «${quoted}»`,
    kind: r.type,
    address: clean(r.address),
    phones,
    dispatch,
    housesDeclared: clean(r.houses_declared) ? Number(r.houses_declared) : undefined,
    inn: clean(r.inn),
    ogrn: clean(r.ogrn),
    email: clean(r.email),
    site: clean(r.site),
  };
});
const orgByName = new Map(organizations.map((o) => [o.name, o]));
if (orgByName.size !== organizations.length) throw new Error('Повторяются названия организаций');

// ───────────── Дома ─────────────

const byAddress = new Map();
for (const r of houseRows) {
  const org = orgByName.get(r.organization);
  if (!org) throw new Error(`Дом «${r.address}»: нет карточки организации «${r.organization}»`);
  const parts = r.address.split(',').map((s) => s.trim());
  if (parts.length !== 3) throw new Error(`Адрес не в формате «улица, номер, город»: ${r.address}`);
  const [street, number, place] = parts;
  const settlement = meta.settlements[place];
  if (!settlement) throw new Error(`Населённый пункт «${place}» не описан в meta.json: ${r.address}`);
  const key = `${street}, ${number}, ${place}`;
  if (!byAddress.has(key)) byAddress.set(key, { street, number, place, settlement, orgs: [] });
  byAddress.get(key).orgs.push(org);
}

/** Адрес без служебных слов: «Ивановская обл., г. Вичуга, ул. Московская, д. 13» → «московская 13». */
const ADDR_NOISE = new Set(['ивановская', 'обл', 'область', 'г', 'город', 'д', 'дом', 'ул', 'улица', 'пер', 'переулок', 'пос', 'поселок', ...Object.keys(meta.settlements).map((s) => s.toLowerCase())]);
const normalizeAddr = (s) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^а-яa-z0-9]+/)
    .filter((w) => w && !ADDR_NOISE.has(w))
    .join(' ');

const houses = [];
for (const [key, h] of byAddress) {
  const { type, name } = splitStreet(h.street);
  const id = [meta.idPrefix, h.settlement.id, slug(name), slug(h.number)].filter(Boolean).join('_');
  let orgs = h.orgs;
  if (orgs.length > 1) {
    // Несколько организаций на один адрес: основной считаем ту, чей собственный адрес – этот дом (ТСЖ, ЖСК, ТСН);
    // остальные показываем как «также указана в источнике».
    const own = orgs.find((o) => o.address && normalizeAddr(o.address) === normalizeAddr(`${h.street} ${h.number}`));
    orgs = own ? [own, ...orgs.filter((o) => o !== own)] : orgs;
    warnings.push(`Дом «${key}» указан за несколькими организациями: ${orgs.map((o) => o.short).join(', ')}. Основной выбрана «${orgs[0].short}»`);
  }
  houses.push({
    id,
    street: h.street,
    streetName: name,
    streetType: type,
    number: h.number,
    settlement: h.place,
    address: `${h.settlement.title}, ${h.street}, д. ${h.number}`,
    orgId: orgs[0].id,
    ...(orgs.length > 1 ? { alsoOrgIds: orgs.slice(1).map((o) => o.id) } : {}),
  });
}

const ids = houses.map((h) => h.id);
const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupIds.length) throw new Error(`Совпали идентификаторы домов: ${dupIds.join(', ')}`);
for (const id of ids) if (!/^[A-Za-z0-9_]{1,64}$/.test(id)) throw new Error(`Идентификатор дома не подходит для диплинка: ${id}`);

for (const o of organizations) {
  const n = houses.filter((h) => h.orgId === o.id || h.alsoOrgIds?.includes(o.id)).length;
  if (n === 0) warnings.push(`У организации «${o.short}» нет ни одного дома в списке (адрес в карточке: ${o.address ?? '–'})`);
  else if (o.housesDeclared !== undefined && o.housesDeclared !== n) warnings.push(`«${o.short}»: в карточке ${o.housesDeclared} дом(ов), в списке – ${n}`);
}

// ───────────── Городские службы ─────────────

const SERVICE_PARTIES = new Set([
  'water_utility', 'heat_utility', 'energy_utility', 'gas_service', 'tko_operator', 'municipality', 'housing_inspection', 'lift_service', 'intercom_service',
]);
const services = {};
const servicesFile = resolve(dir, 'services.csv');
if (existsSync(servicesFile)) {
  for (const r of parseCsv(readFileSync(servicesFile, 'utf8'))) {
    if (!SERVICE_PARTIES.has(r.party)) throw new Error(`services.csv: неизвестная служба «${r.party}»`);
    if (services[r.party]) throw new Error(`services.csv: служба «${r.party}» указана дважды`);
    // «подпись:номер; подпись:номер» – подпись может содержать запятые, номер двоеточий не содержит
    const phones = (clean(r.phones) ?? '')
      .split(/;\s*/)
      .filter(Boolean)
      .map((p) => {
        const i = p.lastIndexOf(':');
        const number = formatPhone(p.slice(i + 1).trim());
        return { label: p.slice(0, i).trim() || 'Телефон', number };
      });
    // у лифта без телефона подставляется диспетчерская дома (packages/core/src/data/houses.ts) – это не расхождение
    if (!phones.length && r.party !== 'lift_service') warnings.push(`Служба «${r.party}»: нет телефона – в ответах будет только пояснение`);
    services[r.party] = Object.fromEntries(
      Object.entries({ name: r.name, phones, hours: clean(r.hours), address: clean(r.address), email: clean(r.email), site: clean(r.site), note: clean(r.note) }).filter(([, v]) => v !== undefined),
    );
  }
}

const placeRank = (h) => Object.keys(meta.settlements).indexOf(h.settlement);
houses.sort((a, b) => placeRank(a) - placeRank(b) || a.streetName.localeCompare(b.streetName, 'ru') || a.number.localeCompare(b.number, 'ru', { numeric: true }));

const out = {
  city: meta.city,
  region: meta.region,
  settlements: Object.fromEntries(Object.entries(meta.settlements).map(([k, v]) => [k, v.title])),
  source: meta.source,
  updatedAt: meta.updatedAt,
  services,
  organizations: organizations.filter((o) => houses.some((h) => h.orgId === o.id || h.alsoOrgIds?.includes(o.id))),
  houses,
  warnings,
};
writeFileSync(resolve(root, 'packages/core/src/data/city.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${meta.city}: домов ${houses.length}, организаций ${out.organizations.length}, городских служб ${Object.keys(services).length}`);
for (const w of warnings) console.log(`  ! ${w}`);
