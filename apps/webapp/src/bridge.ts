/**
 * Тонкая обёртка над MAX Bridge (window.WebApp).
 * Вне MAX (обычный браузер, предпросмотр) все методы имеют безопасные запасные варианты,
 * поэтому приложение остаётся рабочим. Документация: https://dev.max.ru/docs/webapps/bridge
 */

type HapticImpact = 'soft' | 'light' | 'medium' | 'heavy' | 'rigid';
type HapticNotify = 'error' | 'success' | 'warning';

interface MaxWebApp {
  initData?: string;
  initDataUnsafe?: { start_param?: string; user?: { first_name?: string; last_name?: string } };
  platform?: 'ios' | 'android' | 'desktop' | 'web';
  version?: string;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback?: {
    impactOccurred(style: HapticImpact, fallback?: boolean): void;
    notificationOccurred(type: HapticNotify, fallback?: boolean): void;
    selectionChanged(fallback?: boolean): void;
  };
  DeviceStorage?: {
    setItem(k: string, v: string): Promise<unknown>;
    getItem(k: string): Promise<unknown>;
    removeItem(k: string): Promise<unknown>;
  };
  requestContact?(): Promise<{ phone: string; authDate: string; hash: string }>;
  shareContent?(p: { text?: string; link?: string }): Promise<unknown> | void;
  shareMaxContent?(p: { text?: string; link?: string }): Promise<unknown> | void;
  openLink?(url: string): void;
  openMaxLink?(url: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

const raw = (): MaxWebApp | undefined => (typeof window !== 'undefined' ? window.WebApp : undefined);

/**
 * Реально ли мы внутри MAX. Вне MAX скрипт всё равно создаёт объект WebApp,
 * но без транспорта (platform и initData пусты), и вызовы вроде DeviceStorage.getItem
 * никогда не завершаются – поэтому к Bridge обращаемся только внутри MAX.
 */
export const isInMax = (): boolean => Boolean(raw()?.platform);

const wa = (): MaxWebApp | undefined => (isInMax() ? raw() : undefined);

/** DeviceStorage не поддерживается веб-версией MAX – там сразу используем localStorage. */
const deviceStorage = () => (raw()?.platform === 'web' ? undefined : wa()?.DeviceStorage);

/** Ограничивает ожидание ответа от нативного клиента, чтобы интерфейс не зависал. */
const withTimeout = <T,>(p: Promise<T> | undefined, ms = 1500): Promise<T | undefined> =>
  p ? Promise.race([p, new Promise<undefined>((r) => window.setTimeout(() => r(undefined), ms))]) : Promise.resolve(undefined);

export type UiPlatform = 'ios' | 'android';

/** MAX UI знает только ios/android; десктоп и веб оформляем как android. */
export function uiPlatform(): UiPlatform {
  return raw()?.platform === 'ios' || /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
}

export const runtimePlatform = (): string => raw()?.platform ?? 'browser';

export function startParam(): string | undefined {
  const fromBridge = raw()?.initDataUnsafe?.start_param;
  if (fromBridge) return fromBridge;
  // Запасной вариант для локальной разработки: ?startapp=...
  const q = new URLSearchParams(window.location.search).get('startapp');
  return q ?? undefined;
}

const safe = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* Bridge может быть недоступен – интерфейс не должен от этого ломаться */
  }
};

export const haptic = {
  impact: (s: HapticImpact = 'light') => safe(() => wa()?.HapticFeedback?.impactOccurred(s)),
  notify: (t: HapticNotify) => safe(() => wa()?.HapticFeedback?.notificationOccurred(t)),
  selection: () => safe(() => wa()?.HapticFeedback?.selectionChanged()),
};

export const backButton = {
  show: () => safe(() => wa()?.BackButton?.show()),
  hide: () => safe(() => wa()?.BackButton?.hide()),
  onClick: (cb: () => void) => safe(() => wa()?.BackButton?.onClick(cb)),
  offClick: (cb: () => void) => safe(() => wa()?.BackButton?.offClick(cb)),
};

export const closingConfirmation = (on: boolean) =>
  safe(() => (on ? wa()?.enableClosingConfirmation?.() : wa()?.disableClosingConfirmation?.()));

/** Хранилище: DeviceStorage в MAX (мобильные), иначе localStorage; любые сбои не критичны. */
export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      const v = await withTimeout(deviceStorage()?.getItem(key));
      if (typeof v === 'string' && v) return v;
      if (v && typeof v === 'object' && 'value' in (v as object)) {
        const val = (v as { value?: unknown }).value;
        if (typeof val === 'string' && val) return val;
      }
    } catch {
      /* fallthrough */
    }
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await withTimeout(deviceStorage()?.setItem(key, value));
    } catch {
      /* fallthrough */
    }
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await withTimeout(deviceStorage()?.removeItem(key));
    } catch {
      /* ignore */
    }
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** Открыть внешнюю ссылку: через Bridge (требует клика пользователя) либо новой вкладкой. */
export function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const app = wa();
  try {
    if (app?.openLink) return app.openLink(url);
  } catch {
    /* fallthrough */
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export type ShareResult = 'shared' | 'copied' | 'failed';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Поделиться текстом: сначала нативный шеринг MAX, затем Web Share API, затем копирование. */
export async function shareText(text: string): Promise<ShareResult> {
  const app = wa();
  try {
    if (app?.shareMaxContent) {
      await app.shareMaxContent({ text });
      return 'shared';
    }
    if (app?.shareContent) {
      await app.shareContent({ text });
      return 'shared';
    }
  } catch {
    /* fallthrough */
  }
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return 'failed';
  }
  return (await copyText(text)) ? 'copied' : 'failed';
}

/** Номер телефона из профиля MAX (модальное окно клиента). Только для подстановки в черновик. */
export async function requestPhone(): Promise<{ phone?: string; refused?: boolean; unavailable?: boolean }> {
  const app = wa();
  if (!app?.requestContact) return { unavailable: true };
  try {
    const r = await app.requestContact();
    const digits = String(r.phone ?? '').replace(/\D/g, '');
    if (!digits) return { unavailable: true };
    return { phone: `+${digits}` };
  } catch (e) {
    const code = (e as { error?: { code?: string } })?.error?.code ?? '';
    return code.includes('user_refused') ? { refused: true } : { unavailable: true };
  }
}
