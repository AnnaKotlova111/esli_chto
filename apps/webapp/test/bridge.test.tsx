import { afterEach, describe, expect, it, vi } from 'vitest';
import { storage } from '../src/bridge';

/** Имитация хранилища устройства MAX; hang – не отвечать, как вне MAX или при сбое клиента. */
function fakeMax({ hang = false } = {}) {
  const data = new Map<string, string>();
  const reply = <T,>(v: T): Promise<T> => (hang ? new Promise<T>(() => undefined) : Promise.resolve(v));
  window.WebApp = {
    platform: 'android',
    DeviceStorage: {
      setItem: (k, v) => reply(data.set(k, v) && true),
      getItem: (k) => reply(data.get(k) ?? null),
      removeItem: (k) => reply(data.delete(k)),
    },
  };
  return data;
}

afterEach(() => {
  delete window.WebApp;
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('хранилище: DeviceStorage MAX основное, localStorage запасное', () => {
  it('внутри MAX данные пишутся только в DeviceStorage', async () => {
    const device = fakeMax();
    await storage.set('house', 'vch_korovina_11');
    expect(device.get('esli_chto:house')).toBe('vch_korovina_11');
    expect(window.localStorage.getItem('esli_chto:house')).toBeNull();
    expect(await storage.get('house')).toBe('vch_korovina_11');
  });

  it('запасная копия в браузере удаляется, когда DeviceStorage снова отвечает', async () => {
    window.localStorage.setItem('esli_chto:house', 'old');
    const device = fakeMax();
    await storage.set('house', 'new');
    expect(device.get('esli_chto:house')).toBe('new');
    expect(window.localStorage.getItem('esli_chto:house')).toBeNull();
  });

  it('DeviceStorage не ответил – данные сохраняются в localStorage и читаются оттуда', async () => {
    vi.useFakeTimers();
    fakeMax({ hang: true });
    const saved = storage.set('house', 'vch_korovina_11');
    await vi.advanceTimersByTimeAsync(2000);
    await saved;
    expect(window.localStorage.getItem('esli_chto:house')).toBe('vch_korovina_11');
    const read = storage.get('house');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await read).toBe('vch_korovina_11');
  });

  it('если последняя запись не дошла до DeviceStorage, читается она, а не старое значение из MAX', async () => {
    const device = fakeMax();
    await storage.set('house', 'old');
    // DeviceStorage перестал отвечать – новое значение ушло в localStorage
    window.WebApp!.DeviceStorage!.setItem = () => new Promise(() => undefined);
    vi.useFakeTimers();
    const saved = storage.set('house', 'new');
    await vi.advanceTimersByTimeAsync(2000);
    await saved;
    expect(device.get('esli_chto:house')).toBe('old');
    expect(await storage.get('house')).toBe('new');
  });

  it('вне MAX используется localStorage', async () => {
    await storage.set('house', 'vch_korovina_11');
    expect(window.localStorage.getItem('esli_chto:house')).toBe('vch_korovina_11');
    await storage.remove('house');
    expect(window.localStorage.getItem('esli_chto:house')).toBeNull();
  });
});
