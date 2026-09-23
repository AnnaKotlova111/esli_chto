// Каталог иконок приложения для дизайнеров: каждая иконка – отдельный SVG,
// плюс страница-превью design/icons/index.html и таблица docs/ICONS.md.
// Источник один – apps/webapp/src/ui/icons.tsx. Запуск: npm run docs:icons
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'design', 'icons');
mkdirSync(resolve(root, 'tmp'), { recursive: true });

const entry = resolve(root, 'tmp', 'icons-entry.tsx');
writeFileSync(
  entry,
  `export * from '../apps/webapp/src/ui/icons';\nexport { createElement } from 'react';\nexport { renderToStaticMarkup } from 'react-dom/server';\n`,
);
const outfile = resolve(root, 'tmp', 'icons-bundle.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  outfile,
  logLevel: 'error',
  // react-dom/server подключает встроенные модули Node через require
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
const m = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

const GROUPS = [
  { id: 'ui', title: 'Интерфейс', table: m.UI_ICONS },
  { id: 'categories', title: 'Категории проблем', table: m.CATEGORY_ICONS },
  { id: 'parties', title: 'Стороны ответственности', table: m.PARTY_ICONS },
  { id: 'objects', title: 'Объекты на схемах', table: m.ELEMENT_ICONS },
];

rmSync(out, { recursive: true, force: true });
const md = [
  '# Иконки приложения',
  '',
  'Единая линейная система на наборе Lucide (лицензия ISC): контур 2 px, размер 24 × 24, цвет – `currentColor`.',
  'Иконка всегда дополняет текст и не бывает единственным способом передать смысл.',
  '',
  'Источник – `apps/webapp/src/ui/icons.tsx`. SVG-файлы и превью `design/icons/index.html` собираются командой `npm run docs:icons`.',
];
const cards = [];
let total = 0;
for (const g of GROUPS) {
  mkdirSync(resolve(out, g.id), { recursive: true });
  md.push('', `## ${g.title}`, '', '| Имя | Файл | Набор |', '|---|---|---|');
  const items = [];
  for (const [name, C] of Object.entries(g.table)) {
    const svg = m
      .renderToStaticMarkup(m.createElement(C, { size: 24, strokeWidth: 2 }))
      .replace(/ aria-hidden="true"/, '');
    const file = `${g.id}/${name}.svg`;
    writeFileSync(resolve(out, file), `${svg}\n`);
    md.push(`| \`${name}\` | \`design/icons/${file}\` | ${C.displayName ?? ''} |`);
    items.push(`<figure><div class="ic">${svg}</div><figcaption>${name}</figcaption></figure>`);
    total += 1;
  }
  cards.push(`<h2>${g.title}</h2><div class="grid">${items.join('')}</div>`);
}

writeFileSync(
  resolve(out, 'index.html'),
  `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Иконки – «Если что»</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{--primary:#2563EB;--soft:#DCEEFF;--text:#172033;--muted:#667085;--bg:#F6F8FA;--surface:#FFFFFF;--border:#E4E7EC}
body{margin:0;padding:24px;background:var(--bg);color:var(--text);font:16px/24px Inter,system-ui,sans-serif}
h1{font:700 28px/34px Inter,system-ui,sans-serif;color:#173B6C}h2{font:700 22px/28px Inter,system-ui,sans-serif;color:#173B6C;margin-top:32px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}
figure{margin:0;padding:16px 8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;text-align:center}
.ic{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:var(--soft);color:var(--primary)}
figcaption{margin-top:8px;font-size:12px;line-height:16px;color:var(--muted);word-break:break-all}
</style></head><body>
<h1>Иконки приложения «Если что»</h1>
<p>Линейные иконки 24 × 24, контур 2 px. Всего: ${total}.</p>
${cards.join('\n')}
</body></html>
`,
);
md.push('', `Всего иконок: ${total}.`);
writeFileSync(resolve(root, 'docs', 'ICONS.md'), `${md.join('\n')}\n`);
console.log(`icons: ${total} → design/icons/`);
