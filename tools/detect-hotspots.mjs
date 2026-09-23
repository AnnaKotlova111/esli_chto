// Определение кликабельных зон по пикселям иллюстраций схем.
//
// На каждой иллюстрации подпись объекта – белая плашка со скруглёнными углами,
// слева на ней синий круглый значок, от плашки к объекту идёт линия-выноска.
// Скрипт находит плашки как связные области почти белых пикселей подходящего
// размера, внутри каждой – синий значок, и сопоставляет плашки с объектами
// по примерной точке из apps/webapp/src/scenes/labels.json.
//
// Результат: apps/webapp/src/scenes/hotspots.json (границы плашки и центр значка
// в пикселях исходной картинки) и контрольные изображения tmp/hotspots-<схема>.png.
//
// Запуск:  npm ci --prefix tools && npm run scenes:detect

import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scenesDir = resolve(root, 'apps/webapp/src/scenes');
const imagesDir = resolve(root, 'apps/webapp/public/scenes');
const labels = JSON.parse(readFileSync(resolve(scenesDir, 'labels.json'), 'utf8'));

/** «Белый» пиксель плашки: светлый и почти без цветового оттенка. */
const isPlateWhite = (r, g, b) => r >= 238 && g >= 238 && b >= 238 && Math.max(r, g, b) - Math.min(r, g, b) <= 14;
/** Эрозия маски квадратом (2r+1)×(2r+1): рвёт тонкие перемычки между плашкой и светлыми предметами. */
function erode(mask, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      run = mask[y * w + x] ? run + 1 : 0;
      if (x >= 2 * r && run >= 2 * r + 1) tmp[y * w + x - r] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      run = tmp[y * w + x] ? run + 1 : 0;
      if (y >= 2 * r && run >= 2 * r + 1) out[(y - r) * w + x] = 1;
    }
  }
  return out;
}

/** Связные области маски (4-связность), с рамкой и площадью. */
function components(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const out = [];
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    const id = out.length;
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && label[q] === -1) {
          label[q] = id;
          stack[sp++] = q;
        }
      }
    }
    out.push({ id, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return { label, comps: out };
}

async function detect(sceneId, def) {
  const file = resolve(imagesDir, def.image);
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];

  const white = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = px(i);
    white[i] = isPlateWhite(r, g, b) ? 1 : 0;
  }
  const isWhiteAt = (x, y) => white[y * w + x] === 1;

  // Плашки: вытянутые по горизонтали области белого, плотно заполняющие свою рамку.
  // Сначала без эрозии, затем с нарастающей – пока плашка не отделится от белых предметов рядом.
  const isPlate = (c) => c.h >= 30 && c.h <= 110 && c.w >= 60 && c.w <= 420 && c.w / c.h >= 1.6 && c.area / (c.w * c.h) >= 0.35;
  const platesAt = (r) => {
    const { comps } = components(r ? erode(white, w, h, r) : white, w, h);
    return comps.map((c) => ({ ...c, x: c.x - r, y: c.y - r, w: c.w + 2 * r, h: c.h + 2 * r, area: c.area + 2 * r * (c.w + c.h) })).filter(isPlate);
  };
  /**
   * Если значок занимает всю высоту плашки, белая часть слева от него отрезана и найденная область
   * начинается с текста. Тогда слева вплотную стоит круг значка: достраиваем плашку на его ширину и белый край.
   */
  const withIcon = (p) => {
    const y0 = p.y + Math.round(p.h * 0.25);
    const y1 = p.y + Math.round(p.h * 0.75);
    const busy = (x) => {
      for (let y = y0; y < y1; y++) if (!isWhiteAt(x, y)) return true;
      return false;
    };
    // часть значка, попавшая в найденную область (белая пиктограмма внутри значка могла слиться с плашкой)
    let inner = 0;
    while (inner < p.h && busy(p.x + inner)) inner++;
    let x = p.x - 1;
    let d = 0;
    while (x > 0 && busy(x) && d <= p.h * 1.4) {
      x--;
      d++;
    }
    if (d < 3 || inner < p.h * 0.2 || inner + d < p.h * 0.6 || inner + d > p.h * 1.4) return p;
    let rim = 0;
    while (x > 0 && !busy(x) && rim < 10) {
      x--;
      rim++;
    }
    // слева от значка обязательно белый край плашки, иначе это не значок, а фон картинки
    if (rim < 2) return p;
    const nx = x + 1;
    return { ...p, x: nx, w: p.w + (p.x - nx) };
  };
  const layers = [0, 3, 6].map((r) => ({ r, plates: platesAt(r).map(withIcon) }));
  const plates = layers[0].plates;

  /** Значок – первая слева группа столбцов плашки, где есть не белые пиксели (дальше идёт промежуток и текст). */
  const iconOf = (p) => {
    const y0 = p.y + Math.round(p.h * 0.12);
    const y1 = p.y + Math.round(p.h * 0.88);
    const busy = (x) => {
      for (let y = y0; y < y1; y++) if (!isWhiteAt(x, y)) return true;
      return false;
    };
    // группы подряд идущих «занятых» столбцов в левой половине; значок – первая достаточно широкая
    // (узкие группы у самого края – это скруглённые углы плашки)
    let left = -1;
    let right = -1;
    for (let x = p.x; x < p.x + p.w / 2 && left < 0; x++) {
      if (!busy(x)) continue;
      let e = x;
      while (e + 1 < p.x + p.w / 2 && busy(e + 1) && e + 1 - x < p.h * 0.95) e++;
      if (e - x + 1 >= p.h * 0.45) {
        left = x;
        right = e;
      }
      x = e;
    }
    if (left < 0) return null;
    let top = y1, bottom = y0;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = left; xx <= right; xx++) {
        if (!isWhiteAt(xx, yy)) {
          if (yy < top) top = yy;
          if (yy > bottom) bottom = yy;
        }
      }
    }
    const d = Math.max(right - left + 1, bottom - top + 1);
    if (d < p.h * 0.45 || d > p.h * 1.05) return null;
    return [Math.round((left + right) / 2), Math.round((top + bottom) / 2), Math.round(d / 2)];
  };

  const spots = {};
  const used = new Set();
  const problems = [];
  for (const [target, [ax, ay]] of Object.entries(def.labels)) {
    // плашка, содержащая точку; если на исходной маске её нет (слилась с белым предметом) – берём слой с эрозией
    let best;
    for (const layer of layers) {
      const inside = layer.plates.filter((p) => ax >= p.x && ax < p.x + p.w && ay >= p.y && ay < p.y + p.h);
      if (inside.length) {
        best = { p: { ...inside[0], id: `${layer.r}:${inside[0].id}` }, d: 0 };
        break;
      }
    }
    if (!best) {
      problems.push(`${sceneId}: не найдена плашка для «${target}» около (${ax}, ${ay})`);
      continue;
    }
    if (used.has(best.p.id)) problems.push(`${sceneId}: плашка у «${target}» уже занята другим объектом`);
    used.add(best.p.id);
    const p = best.p;
    const icon = iconOf(p);
    if (!icon) problems.push(`${sceneId}: на плашке «${target}» не найден значок`);
    spots[target] = { box: [p.x, p.y, p.w, p.h], icon };
  }

  // Контрольная картинка: найденные зоны поверх иллюстрации.
  const rects = Object.entries(spots)
    .map(([t, s]) => {
      const [x, y, bw, bh] = s.box;
      const circle = s.icon ? `<circle cx="${s.icon[0]}" cy="${s.icon[1]}" r="${s.icon[2] + 4}" fill="none" stroke="#D92D20" stroke-width="3"/>` : '';
      return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="none" stroke="#1F8A5B" stroke-width="3"/>${circle}<text x="${x}" y="${y - 4}" font-size="16" fill="#D92D20" font-family="sans-serif">${t}</text>`;
    })
    .join('');
  mkdirSync(resolve(root, 'tmp'), { recursive: true });
  await sharp(file)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`), top: 0, left: 0 }])
    .png()
    .toFile(resolve(root, 'tmp', `hotspots-${sceneId}.png`));

  return { size: [w, h], spots, problems, platesFound: plates.length };
}

const result = {};
const allProblems = [];
for (const [sceneId, def] of Object.entries(labels)) {
  if (sceneId.startsWith('$')) continue;
  const r = await detect(sceneId, def);
  result[sceneId] = { image: def.image, size: r.size, spots: r.spots };
  allProblems.push(...r.problems);
  console.log(`${sceneId}: плашек на картинке ${r.platesFound}, сопоставлено ${Object.keys(r.spots).length} из ${Object.keys(def.labels).length}`);
}
writeFileSync(resolve(scenesDir, 'hotspots.json'), `${JSON.stringify(result, null, 2)}\n`);
if (allProblems.length) {
  console.error(allProblems.join('\n'));
  process.exit(1);
}
console.log('hotspots.json обновлён');
