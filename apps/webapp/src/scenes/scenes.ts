import type { Scope } from '@esli-chto/core';
import hotspots from './hotspots.json';

/** [x, y, ширина, высота] в пикселях исходной иллюстрации */
export type Box = [number, number, number, number];

export interface Spot {
  /** id объекта из @esli-chto/core либо `portal:<id схемы>` – переход на другую схему */
  target: string;
  /** Белая плашка подписи на картинке (найдена по пикселям: tools/detect-hotspots.mjs) */
  plate: Box;
  /** Центр и радиус значка на плашке – там появляется активный маркер */
  icon: [number, number, number];
  /** Невидимая зона нажатия: плашка с запасом для пальца, без наложения на соседние зоны */
  hit: Box;
}

export interface SceneDef {
  id: string;
  tab: Scope;
  title: string;
  short: string;
  hint: string;
  image: { src: string; w: number; h: number };
  spots: Spot[];
  /** Кнопка над схемой для категории, которой нет на картинке (например, «Соседи») */
  corner?: { target: string; label: string };
}

type Raw = { image: string; size: [number, number]; spots: Record<string, { box: Box; icon: [number, number, number] | null }> };
const RAW = hotspots as unknown as Record<string, Raw>;

/** Запас зоны нажатия вокруг плашки, в пикселях картинки (~6-8 px на экране телефона). */
const PAD = 18;

const overlaps = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * Расширяет зоны нажатия и разводит пересечения: соседние зоны делятся посередине промежутка
 * между плашками по той оси, где промежуток больше.
 */
export function hitAreas(plates: Box[], size: [number, number], pad = PAD): Box[] {
  const hits: Box[] = plates.map(([x, y, w, h]) => {
    const nx = Math.max(0, x - pad);
    const ny = Math.max(0, y - pad);
    return [nx, ny, Math.min(size[0], x + w + pad) - nx, Math.min(size[1], y + h + pad) - ny];
  });
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i]!;
      const b = hits[j]!;
      if (!overlaps(a, b)) continue;
      const pa = plates[i]!;
      const pb = plates[j]!;
      const gapX = pa[0] + pa[2] <= pb[0] ? pb[0] - (pa[0] + pa[2]) : pb[0] + pb[2] <= pa[0] ? pa[0] - (pb[0] + pb[2]) : -1;
      const gapY = pa[1] + pa[3] <= pb[1] ? pb[1] - (pa[1] + pa[3]) : pb[1] + pb[3] <= pa[1] ? pa[1] - (pb[1] + pb[3]) : -1;
      if (gapY >= gapX) {
        const [top, bottom, pt, pbm] = pa[1] < pb[1] ? [a, b, pa, pb] : [b, a, pb, pa];
        const mid = Math.round((pt[1] + pt[3] + pbm[1]) / 2);
        top[3] = Math.max(pt[1] + pt[3], mid) - top[1];
        bottom[3] = bottom[1] + bottom[3] - Math.min(pbm[1], mid);
        bottom[1] = Math.min(pbm[1], mid);
      } else {
        const [left, right, pl, pr] = pa[0] < pb[0] ? [a, b, pa, pb] : [b, a, pb, pa];
        const mid = Math.round((pl[0] + pl[2] + pr[0]) / 2);
        left[2] = Math.max(pl[0] + pl[2], mid) - left[0];
        right[2] = right[0] + right[2] - Math.min(pr[0], mid);
        right[0] = Math.min(pr[0], mid);
      }
    }
  }
  return hits;
}

function build(id: string, rest: Omit<SceneDef, 'id' | 'image' | 'spots'>): SceneDef {
  const raw = RAW[id];
  if (!raw) throw new Error(`Нет разметки схемы ${id}`);
  const entries = Object.entries(raw.spots);
  const hits = hitAreas(entries.map(([, s]) => s.box), raw.size);
  return {
    id,
    ...rest,
    image: { src: `./scenes/${raw.image}`, w: raw.size[0], h: raw.size[1] },
    spots: entries.map(([target, s], i) => {
      const [x, y, , h] = s.box;
      return { target, plate: s.box, icon: s.icon ?? [x + h / 2, y + h / 2, h / 2 - 4], hit: hits[i]! };
    }),
  };
}

export const SCENES: SceneDef[] = [
  build('outside', {
    tab: 'house',
    title: 'Двор и фасад',
    short: 'Снаружи',
    hint: 'Нажмите на подпись на картинке. «Подъезд» открывает схему подъезда.',
  }),
  build('entrance', {
    tab: 'house',
    title: 'Подъезд',
    short: 'Подъезд',
    hint: 'Нажмите на подпись на картинке: освещение, лифт, домофон, щитки, пожарная безопасность…',
  }),
  build('technical', {
    tab: 'house',
    title: 'Подвал и сети',
    short: 'Подвал и сети',
    hint: 'Нажмите на подпись на картинке: стояки, тепловой узел, счётчики, электрощитовая, подвал.',
  }),
  build('plan', {
    tab: 'flat',
    title: 'План квартиры',
    short: 'План квартиры',
    hint: 'Нажмите на подпись на картинке. Шум, запахи и залив от соседей – кнопка «Соседи» над схемой.',
    corner: { target: 'neighbors', label: 'Соседи' },
  }),
];

export const scenesFor = (tab: Scope) => SCENES.filter((s) => s.tab === tab);
export const getScene = (id: string) => SCENES.find((s) => s.id === id);

/** Схема, на которой нарисован объект (первая подходящая во вкладке). */
export function sceneOfElement(elementId: string, tab?: Scope): SceneDef | undefined {
  return SCENES.find((s) => (!tab || s.tab === tab) && (s.spots.some((p) => p.target === elementId) || s.corner?.target === elementId));
}
