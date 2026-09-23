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
