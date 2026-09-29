/**
 * Оформление текста ответов, общее для бота и мини-приложения:
 * что выделить жирным и где нельзя переносить строку.
 */

export interface TextPart {
  text: string;
  strong?: boolean;
}

// Телефоны и экстренные номера, кроме ссылок на нормы вроде «п. 102» или «№ 104».
const NUMBERS = /(?:\+7|8) \(\d{3,5}\) [\d-]+|(?<![\d-]|п\. |№ )\b(?:112|10[1-4])(?![\d\-/а-яёА-ЯЁa-zA-Z])/g;
// Запрет в начале предложения или после запятой, до ближайшего знака препинания.
const NEGATIVE = /(^|[.!?:]\s+|,\s+)((?:Не|не|Нельзя|нельзя|Никогда)\s[^,.;:!?(–]+)/g;

/** Делит текст на части и помечает жирным телефоны, экстренные номера и запреты. */
export function emphasize(text: string): TextPart[] {
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(NUMBERS)) ranges.push([m.index, m.index + m[0].length]);
  for (const m of text.matchAll(NEGATIVE)) {
    const start = m.index + m[1]!.length;
    ranges.push([start, start + m[2]!.trimEnd().length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const parts: TextPart[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) parts.push({ text: text.slice(pos, s) });
    parts.push({ text: text.slice(s, e), strong: true });
    pos = e;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos) });
  return parts;
}

const NBSP = '\u00A0';
// Невидимый символ, рядом с которым браузер не переносит строку.
const WJ = '\u2060';

/**
 * Запрещает переносы там, где они мешают читать: внутри телефона и диапазона, после «ул.», «п.», «№»,
 * перед «°C». Используется только на экране приложения, в текст обращений и сообщений бота не попадает.
 */
export function typo(text: string): string {
  return text
    .replace(/(?:\+7|8) ?\(\d{3,5}\) ?\d[\d-]*\d/g, (m) => m.replace(/ /g, NBSP).replace(/-/g, `-${WJ}`))
    .replace(/([\dA-Za-zА-Яа-яЁё])–(?=[\dA-Za-zА-Яа-яЁё])/g, `$1–${WJ}`)
    .replace(/(\d)-(?=\d)/g, `$1-${WJ}`)
    .replace(/ – /g, `${NBSP}– `)
    .replace(/(^|[\s(«"])(ул|д|пос|г|пер|кв|корп|стр|ст|ч|п|пп|им)\. /g, `$1$2.${NBSP}`)
    .replace(/№ /g, `№${NBSP}`)
    .replace(/(\d) (%|°C|°)/g, `$1${NBSP}$2`);
}
