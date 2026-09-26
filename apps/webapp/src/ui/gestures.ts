import { useEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { haptic } from '../bridge';

/** Анимации включены: браузер их поддерживает и человек не просил «уменьшить движение» в настройках телефона. */
export const motionEnabled = (): boolean =>
  typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface SwipeOptions {
  /** Где ловим жест */
  root: RefObject<HTMLElement | null>;
  /** Что едет за пальцем при свайпе вправо */
  rightTarget: () => HTMLElement | null;
  onRight: () => void;
  /** Зона, за которую шторку можно потянуть вниз (шапка), и что при этом делать */
  downHandle?: RefObject<HTMLElement | null>;
  downTarget?: () => HTMLElement | null;
  onDown?: () => void;
  /** Для элементов, которые появляются не сразу: жест подключается, когда элемент показан */
  active?: boolean;
}

const LOCK = 10; // px – после этого понятно, горизонтальный жест или вертикальный
const OUT_MS = 180;
const BACK_MS = 220;

/** Внутри элемента, который сам прокручивается вбок (ряд кнопок, увеличенная схема), – жест не перехватываем. */
function insideHorizontalScroll(el: Element | null, root: Element): boolean {
  for (let n = el; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

const setMove = (el: HTMLElement, translate: string, opacity = '', ms = 0) => {
  el.style.transition = ms ? `translate ${ms}ms ease-out, opacity ${ms}ms ease-out` : 'none';
  el.style.translate = translate;
  el.style.opacity = opacity;
};

const clearMove = (el: HTMLElement | null) => {
  if (!el) return;
  el.style.transition = '';
  el.style.translate = '';
  el.style.opacity = '';
};

/**
 * Жесты как в iOS: провести пальцем вправо – шаг назад, потянуть шторку за шапку вниз – закрыть.
 * Экран едет за пальцем; если отпустить раньше порога – возвращается на место.
 */
export function useSwipeGestures(opts: SwipeOptions) {
  // свежие колбэки без переподписки на события
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const root = opts.root.current;
    if (!root) return;

    let start: { x: number; y: number; t: number; fromHandle: boolean } | null = null;
    let mode: 'none' | 'right' | 'down' | 'ignore' = 'none';
    let target: HTMLElement | null = null;
    let dx = 0;
    let dy = 0;

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      const el = e.target as Element | null;
      if (e.touches.length !== 1 || !touch || !el || el.closest('input, textarea, select, [contenteditable="true"]') || insideHorizontalScroll(el, root)) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY, t: performance.now(), fromHandle: Boolean(ref.current.downHandle?.current?.contains(el)) };
      mode = 'none';
      dx = 0;
      dy = 0;
    };

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!start || !touch) return;
      dx = touch.clientX - start.x;
      dy = touch.clientY - start.y;
      if (mode === 'none') {
        if (Math.abs(dx) > LOCK && Math.abs(dx) > Math.abs(dy) * 1.3) {
          mode = dx > 0 ? 'right' : 'ignore';
          target = mode === 'right' ? ref.current.rightTarget() : null;
        } else if (start.fromHandle && ref.current.onDown && dy > LOCK && dy > Math.abs(dx)) {
          mode = 'down';
          target = ref.current.downTarget?.() ?? null;
        } else if (Math.abs(dy) > LOCK) {
          mode = 'ignore';
        }
      }
      if (!target) return;
      if (mode === 'right') {
        e.preventDefault(); // не даём странице прокручиваться, пока тянем вбок
        const x = Math.max(0, dx);
        setMove(target, `${x}px 0`, String(1 - Math.min(0.4, x / root.clientWidth / 2)));
      } else if (mode === 'down') {
        e.preventDefault();
        setMove(target, `0 ${Math.max(0, dy)}px`);
      }
    };

    const onEnd = () => {
      if (!start || !target || (mode !== 'right' && mode !== 'down')) {
        start = null;
        return;
      }
      const el = target;
      const dist = mode === 'right' ? dx : dy;
      const size = mode === 'right' ? root.clientWidth : root.clientHeight;
      const speed = dist / Math.max(1, performance.now() - start.t); // px/мс
      const done = dist > size * 0.3 || (dist > 40 && speed > 0.5);
      const action = mode === 'right' ? ref.current.onRight : ref.current.onDown;
      start = null;
      target = null;
      if (!done || !action) {
        setMove(el, '0 0', '', BACK_MS);
        window.setTimeout(() => clearMove(el), BACK_MS);
        return;
      }
      haptic.impact('light');
      setMove(el, mode === 'right' ? `${size}px 0` : `0 ${size}px`, mode === 'right' ? '0' : '', OUT_MS);
      window.setTimeout(() => {
        // flushSync: экран обновляется сразу, и ниже уже видно, что стало с элементом.
        // Без этого шторку возвращали на место раньше, чем React помечал её закрывающейся, –
        // она на миг выскакивала обратно и закрывалась второй раз.
        flushSync(action);
        // если экран не сменился (например, спросили про несохранённый черновик) – возвращаем его на место;
        // уезжающую или убранную шторку не трогаем
        if (el.isConnected && !el.closest('.is-leaving')) clearMove(el);
      }, OUT_MS);
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [opts.root, opts.active]);
}
