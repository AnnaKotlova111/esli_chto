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

/** Сколько ждать ответа хранилища MAX, прежде чем перейти на запасной вариант. */
const DEVICE_STORAGE_TIMEOUT_MS = 1500;
const NO_ANSWER = Symbol('no answer');

/**
 * Вызов хранилища устройства MAX с ограничением ожидания, чтобы интерфейс не зависал.
 * NO_ANSWER – хранилища нет, оно не ответило вовремя или вернуло ошибку: тогда работает localStorage.
 */
async function deviceCall<T>(call: (s: NonNullable<MaxWebApp['DeviceStorage']>) => Promise<T>): Promise<T | typeof NO_ANSWER> {
  const s = deviceStorage();
  if (!s) return NO_ANSWER;
  try {
    return await Promise.race([call(s), new Promise<typeof NO_ANSWER>((r) => window.setTimeout(() => r(NO_ANSWER), DEVICE_STORAGE_TIMEOUT_MS))]);
  } catch {
    return NO_ANSWER;
  }
}

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

/**
 * Префикс ключей хранилища. Вне MAX данные лежат в localStorage, а он общий для всего домена:
 * на GitHub Pages (<аккаунт>.github.io) его делят все сайты аккаунта. Префикс не даёт другим
 * проектам прочитать или затереть данные жителя (ФИО, телефон) по общим именам вроде «user».
 */
const KEY_PREFIX = 'esli_chto:';

const local = {
  get: (key: string): string | null => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
  remove: (key: string) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Основное хранилище – DeviceStorage MAX. localStorage – только запасной вариант, если DeviceStorage
 * нет (вне MAX, веб-версия MAX) или он не ответил: данные не дублируются в двух местах.
 */
const rawStorage = {
  async get(key: string): Promise<string | null> {
    // Копия в браузере есть, только если последняя запись не дошла до DeviceStorage, – значит, она новее
    const saved = local.get(key);
    if (saved !== null) return saved;
    const v = await deviceCall((s) => s.getItem(key));
    if (typeof v === 'string' && v) return v;
    if (v && typeof v === 'object' && 'value' in (v as object)) {
      const val = (v as { value?: unknown }).value;
      if (typeof val === 'string' && val) return val;
    }
    return null;
  },
  async set(key: string, value: string): Promise<void> {
    const r = await deviceCall((s) => s.setItem(key, value));
    if (r === NO_ANSWER) return local.set(key, value);
    // сохранено в MAX – запасная копия в браузере больше не нужна
    local.remove(key);
  },
  async remove(key: string): Promise<void> {
    await deviceCall((s) => s.removeItem(key));
    local.remove(key);
  },
};

/** Хранилище: DeviceStorage в MAX (мобильные), если его нет или он не ответил – localStorage; любые сбои не критичны. */
export const storage = {
  get: (key: string) => rawStorage.get(KEY_PREFIX + key),
  set: (key: string, value: string) => rawStorage.set(KEY_PREFIX + key, value),
  remove: (key: string) => rawStorage.remove(KEY_PREFIX + key),
  /** Ключи без префикса, как их сохраняли версии до 26.09.2026, – только для однократного переноса. */
  legacy: {
    get: (key: string) => rawStorage.get(key),
    remove: (key: string) => rawStorage.remove(key),
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
