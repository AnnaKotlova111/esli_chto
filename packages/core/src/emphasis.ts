/**
 * Что выделять в тексте шагов и подсказок, чтобы главное читалось с первого взгляда:
 * телефоны и экстренные номера, запреты («Не заходите в помещение…», «Нельзя…»).
 * Бот превращает выделение в жирный шрифт сообщения, мини-приложение – в <strong>.
 */
export interface TextPart {
  text: string;
  strong?: boolean;
}

// телефон «+7 (код) номер», «8 (800) …» или экстренный номер; «п. 102» и «№ 104» – это ссылки на нормы, их не трогаем
const NUMBERS = /(?:\+7|8) \(\d{3,5}\) [\d-]+|(?<![\d-]|п\. |№ )\b(?:112|10[1-4])(?![\d\-/а-яёА-ЯЁa-zA-Z])/g;
// запрет в начале предложения или после запятой («…, не наступайте в воду») – до первого знака препинания
const NEGATIVE = /(^|[.!?:]\s+|,\s+)((?:Не|не|Нельзя|нельзя|Никогда)\s[^,.;:!?(–]+)/g;

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
/** Невидимый «склеивающий» символ: запрещает перенос строки рядом с собой. */
const WJ = '\u2060';

/**
 * Неразрывные места для экрана: телефон, диапазон «8:00–17:00», «ул. Ульяновская», «п. 8», «№ 491»,
 * «+18 °C» не разрываются переносом, а тире не начинает строку.
 * Только для показа: в тексты обращений и сообщений бота не подставляется.
 */
export function typo(text: string): string {
  return text
    .replace(/(?:\+7|8) ?\(\d{3,5}\) ?\d[\d-]*\d/g, (m) => m.replace(/ /g, NBSP).replace(/-/g, `-${WJ}`))
    .replace(/([\dA-Za-zА-Яа-яЁё])–(?=[\dA-Za-zА-Яа-яЁё])/g, `$1–${WJ}`)
    .replace(/ – /g, `${NBSP}– `)
    .replace(/(^|[\s(«"])(ул|д|пос|г|пер|кв|корп|стр|ст|ч|п|пп|им)\. /g, `$1$2.${NBSP}`)
    .replace(/№ /g, `№${NBSP}`)
    .replace(/(\d) (%|°C|°)/g, `$1${NBSP}$2`);
}
