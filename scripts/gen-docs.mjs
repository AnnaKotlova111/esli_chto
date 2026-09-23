// Документы, которые собираются из данных приложения, а не пишутся вручную:
//   docs/SCHEMES.md – опись схем: объекты на каждой схеме и их ситуации;
//   docs/NORMS.md   – справочник норм с журналом сверки и список выводов «по практике / по договору»;
//   docs/PRIVACY.md, docs/TERMS.md – те же тексты, что на экранах мини-приложения.
// Запуск: npm run docs   (CI проверяет, что файлы совпадают с данными)
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, 'tmp'), { recursive: true });

const bundle = async (entry, name) => {
  const outfile = resolve(root, 'tmp', `${name}.mjs`);
  await build({ entryPoints: [resolve(root, entry)], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
  return import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
};

const core = await bundle('packages/core/src/index.ts', 'core-docs');
const { SCENES } = await bundle('apps/webapp/src/scenes/scenes.ts', 'scenes-docs');
const { ALL_ELEMENTS, NORMS, NORM_CHECKS, PRIVACY, TERMS, collectOutcomes, getHouse, localize } = core;
const byId = new Map(ALL_ELEMENTS.map((e) => [e.id, e]));
const write = (file, lines) => writeFileSync(resolve(root, 'docs', file), `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`);

// ───────────── Опись схем ─────────────

const REQUIRES = {
  elevator: 'только в доме с лифтом',
  garbage_chute: 'только в доме с мусоропроводом',
  gas: 'только в газифицированном доме',
  central_heating: 'только при центральном отоплении',
  intercom: 'только если есть домофон',
  basement: 'только если есть подвал',
};
const mark = (p) => (p.urgency === 'emergency' ? ' – **опасно, 112/104**' : p.urgency === 'urgent' ? ' – _срочно_' : '');

const schemes = [
  '# Опись схем',
  '',
  'Файл собирается автоматически из данных приложения (`packages/core/src/data/`, `apps/webapp/src/scenes/`) командой `npm run docs`. Не редактируйте его вручную.',
  '',
  'Каждая схема – иллюстрация с подписями объектов. Нажатие на подпись открывает карточку объекта; зоны нажатия вычислены по пикселям картинки (`tools/detect-hotspots.mjs`).',
];
let onScenes = 0;
for (const tab of ['house', 'flat']) {
  schemes.push('', tab === 'house' ? '## Вкладка «Наш дом»' : '## Вкладка «Моя квартира»');
  for (const s of SCENES.filter((x) => x.tab === tab)) {
    schemes.push('', `### Схема «${s.title}»`, '', s.hint, '');
    const targets = [...s.spots.map((p) => p.target), ...(s.corner ? [s.corner.target] : [])];
    for (const target of targets) {
      if (target.startsWith('portal:')) {
        const t = SCENES.find((x) => x.id === target.slice(7));
        schemes.push(`- **Переход «${t.short}»** – открывает схему «${t.title}».`);
        continue;
      }
      const e = byId.get(target);
      if (!e) throw new Error(`нет объекта ${target}`);
      onScenes += 1;
      const req = (e.requires ?? []).map((r) => REQUIRES[r]).find(Boolean);
      const corner = s.corner?.target === target ? ' Кнопка в углу схемы.' : '';
      schemes.push(`- **${e.title}** – ${e.about}${req ? ` _(${req})_` : ''}${corner}`);
      for (const p of e.problems) schemes.push(`  - ${p.title}${mark(p)}`);
    }
  }
}
const situations = ALL_ELEMENTS.reduce((n, e) => n + e.problems.length, 0);
schemes.push(
  '',
  '---',
  '',
  `Итого: уникальных объектов – ${ALL_ELEMENTS.length}, точек на схемах – ${onScenes} (лифт нарисован и во дворе, и в подъезде), типовых ситуаций – ${situations}.`,
  `Из них опасных для жизни (ведут на 112 или 104) – ${ALL_ELEMENTS.flatMap((e) => e.problems).filter((p) => p.urgency === 'emergency').length}, срочных аварий (АДС) – ${ALL_ELEMENTS.flatMap((e) => e.problems).filter((p) => p.urgency === 'urgent').length}.`,
);
write('SCHEMES.md', schemes);

// ───────────── Нормы и сверка ─────────────

const used = new Map();
for (const e of ALL_ELEMENTS) for (const p of e.problems) for (const o of collectOutcomes(p)) for (const n of o.norms) used.set(n, (used.get(n) ?? 0) + 1);
const norms = Object.values(NORMS);
const verified = norms.filter((n) => n.verified);
const cell = (s) => String(s).replace(/\|/g, '\\|');

const normsDoc = [
  '# Справочник норм и сверка',
  '',
  'Файл собирается автоматически из `packages/core/src/data/norms.ts` командой `npm run docs`.',
  '',
  '## Правила',
  '',
  '- `verified: true` – указанная часть или пункт прочитаны целиком в действующей редакции на дату сверки; пересказ в приложении – своими словами, не цитата.',
  '- `verified: false` – ссылка на документ целиком, без утверждений о конкретных пунктах (например, региональные законы о тишине, которые различаются по регионам). Ответ, который держится только на такой ссылке, приложение не выдаёт как уверенный: он помечается «спорный случай» и сопровождается шаблоном обращения.',
  '- Каждый ответ с основанием «практика» или «договор» обязательно помечен как спорный (проверяется автотестом `packages/core/test/data.test.ts`).',
  '- Номера пунктов не подбираются «на глаз»: если пункт не найден или не прочитан, ставится `verified: false` и основание «практика».',
  '',
  `Всего норм: ${norms.length}, сверено по пунктам: ${verified.length}.`,
  '',
  '## Журнал сверки',
  '',
  '| Норма | Документ | Сверено | Дата сверки | Источник и редакция | Что подтверждено (пересказ) | Ответов |',
  '|---|---|---|---|---|---|---|',
  ...norms.map((n) => {
    const c = NORM_CHECKS[n.id];
    return `| ${cell(n.short)} | ${cell(n.doc)} | ${n.verified ? 'да' : 'нет'} | ${c?.date ?? '–'} | ${c ? cell(`${c.source}, ${c.edition}`) : 'на уровне документа'} | ${cell(n.gist)} | ${used.get(n.id) ?? 0} |`;
  }),
  '',
  '## Изменения при сверке 23.09.2026',
  '',
  '- Правила обращения с ТКО, утверждённые ПП № 1156, утратили силу с 01.09.2025. Ссылки заменены на Правила по ПП № 293 от 07.03.2025. По новому определению отходы от текущего ремонта квартиры относятся к крупногабаритным ТКО; ответ «вывоз мебели и мусора» исправлен.',
  '- ЖК РФ ст. 36 ч. 1 п. 3 прямо исключает из общего имущества сети связи, через которые жильцам оказывают услуги. На это опираются ответы про интернет и ТВ.',
  '- Для экстренных ответов добавлено основание ПП № 958 (система-112): какие службы принимают вызов по 112, включая аварийную службу газовой сети.',
  '- Для шлагбаумов и проездов добавлен п. 71 Правил противопожарного режима.',
  '',
  '## Ответы, которые основаны на практике или договоре',
  '',
  'Эти ответы показываются с пометкой «спорный случай», объяснением и кнопкой «Составить обращение».',
  '',
  '| Объект | Ситуация | Ответ | Основание |',
  '|---|---|---|---|',
];
for (const e of ALL_ELEMENTS) {
  for (const p of e.problems) {
    for (const o of collectOutcomes(p)) {
      if (o.basis === 'norm') continue;
      normsDoc.push(`| ${cell(e.title)} | ${cell(p.title)} | ${cell(localize(o.headline, getHouse('vch_korovina_11')))} | ${o.basis === 'practice' ? 'практика' : 'договор'} |`);
    }
  }
}
write('NORMS.md', normsDoc);

// ───────────── Политика и условия ─────────────

const legal = (doc) => ['# ' + doc.title, '', doc.intro, ...doc.sections.flatMap((s) => ['', `## ${s.heading}`, '', ...s.items.map((i) => `- ${i}`)]), '', doc.edition];
write('PRIVACY.md', legal(PRIVACY));
write('TERMS.md', legal(TERMS));

console.log(`docs: объектов ${ALL_ELEMENTS.length}, ситуаций ${situations}, норм ${norms.length} (сверено ${verified.length})`);
