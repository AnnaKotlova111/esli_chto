import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALL_ELEMENTS, getElement, getHouse, isElementAvailable, withFeatures, type Feature } from '@esli-chto/core';
import App from '../src/App';
import { SCENES, hitAreas, type Box } from '../src/scenes/scenes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLElement | undefined;

const tick = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

/** Монтирует приложение с параметром запуска, как если бы его открыли из бота. */
async function mount(startapp = '', saved: Record<string, unknown> = {}): Promise<HTMLElement> {
  window.localStorage.clear();
  for (const [k, v] of Object.entries(saved)) window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  window.history.replaceState(null, '', startapp ? `/?startapp=${startapp}` : '/');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<App />));
  for (let i = 0; i < 50 && host.querySelector('.boot'); i += 1) await tick();
  await tick();
  return host;
}

const click = async (el: Element | null | undefined, what: string) => {
  expect(el, `не найдено: ${what}`).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};

const sheetBody = (el: HTMLElement) => el.querySelector('.sheet__body');
const backBtn = (el: HTMLElement) => el.querySelector('.sheet__head button[aria-label="Назад"]');

beforeAll(() => {
  // в jsdom нет прокрутки к элементу – интерфейс вызывает её только по нажатию «Почему сюда?»
  Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('обход всех объектов, ситуаций и веток вопросов', () => {
  const errors = vi.spyOn(console, 'error');

  const NO_LIFT: Feature[] = ['gas', 'central_heating', 'intercom', 'basement'];
  const cases = [
    { house: getHouse('none'), saved: {} },
    { house: getHouse('vch_korovina_11'), saved: {} },
    { house: withFeatures(getHouse('vch_pyatnitskiy_13'), NO_LIFT), saved: { features: { vch_pyatnitskiy_13: NO_LIFT } } },
  ];
  for (const { house, saved } of cases) {
    it(`дом ${house.id}: всё открывается без ошибок и зависаний`, async () => {
      let answers = 0;

      /** Обходит все ветки вопросов открытой ситуации и возвращается кнопкой «Назад» по одному шагу. */
      const walk = async (el: HTMLElement, ctx: string): Promise<void> => {
        const body = sheetBody(el)!;
        if (body.querySelector('.result')) {
          expect(body.querySelector('.verdict__title')?.textContent, `${ctx}: пустой вердикт`).toBeTruthy();
          expect(body.querySelectorAll('.steps__item').length, `${ctx}: нет шагов`).toBeGreaterThan(0);
          expect(body.querySelectorAll('.norm-row').length, `${ctx}: нет норм`).toBeGreaterThan(0);
          expect(body.textContent, `${ctx}: неразвёрнутая подстановка`).not.toMatch(/\{M/);
          answers += 1;
          return;
        }
        const options = body.querySelectorAll('.flow .list-row');
        expect(body.querySelector('.flow__ask'), `${ctx}: ни вопроса, ни ответа`).toBeTruthy();
        expect(options.length, `${ctx}: меньше двух вариантов`).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < options.length; i += 1) {
          await click(sheetBody(el)!.querySelectorAll('.flow .list-row')[i], `${ctx}: вариант ${i}`);
          await walk(el, `${ctx}.${i}`);
          await click(backBtn(el), `${ctx}: кнопка «Назад»`);
        }
      };

      for (const element of ALL_ELEMENTS.filter((e) => isElementAvailable(house, e))) {
        const el = await mount(house.id === 'none' ? `e_${element.id}` : `h_${house.id}-e_${element.id}`, saved);
        expect(el.querySelector('.sheet__title')?.textContent).toBe(element.title);
        const rows = sheetBody(el)!.querySelectorAll('.list-row');
        expect(rows.length, element.id).toBe(element.problems.length);
        for (let i = 0; i < element.problems.length; i += 1) {
          await click(sheetBody(el)!.querySelectorAll('.list-row')[i], `${element.id}: ситуация ${i}`);
          await walk(el, element.problems[i]!.id);
          // «Назад» из первого шага ситуации возвращает к списку ситуаций, а не закрывает карточку
          await click(backBtn(el), `${element.id}: назад к списку`);
          expect(el.querySelector('.sheet__title')?.textContent).toBe(element.title);
        }
        await act(async () => root?.unmount());
        root = undefined;
        host?.remove();
      }

      expect(answers).toBeGreaterThan(150);
      expect(errors).not.toHaveBeenCalled();
    }, 120_000);
  }
});

describe('схемы-иллюстрации', () => {
  const inside = (outer: Box, inner: Box) =>
    inner[0] >= outer[0] && inner[1] >= outer[1] && inner[0] + inner[2] <= outer[0] + outer[2] && inner[1] + inner[3] <= outer[1] + outer[3];
  const overlap = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

  const ZONES: Record<string, string[]> = { outside: ['outside'], entrance: ['entrance'], technical: ['technical'], plan: ['hall', 'kitchen', 'bath', 'room', 'balcony'] };

  for (const scene of SCENES) {
    it(`«${scene.title}»: зоны на все объекты схемы, внутри картинки и без наложений`, () => {
      const targets = new Set([...scene.spots.map((s) => s.target), ...(scene.corner ? [scene.corner.target] : [])]);
      for (const e of ALL_ELEMENTS.filter((x) => ZONES[scene.id]!.includes(x.zone))) {
        expect(targets.has(e.id), `на схеме «${scene.title}» нет зоны для «${e.title}»`).toBe(true);
      }
      for (const s of scene.spots) {
        if (!s.target.startsWith('portal:')) expect(getElement(s.target), s.target).toBeDefined();
        expect(inside([0, 0, scene.image.w, scene.image.h], s.hit), `${s.target} за пределами картинки`).toBe(true);
        expect(inside(s.hit, s.plate), `${s.target}: зона меньше плашки`).toBe(true);
        expect(s.plate[3], `${s.target}: подозрительная высота плашки`).toBeGreaterThanOrEqual(30);
      }
      for (let i = 0; i < scene.spots.length; i += 1) {
        for (let j = i + 1; j < scene.spots.length; j += 1) {
          const a = scene.spots[i]!;
          const b = scene.spots[j]!;
          expect(overlap(a.hit, b.hit), `зоны «${a.target}» и «${b.target}» пересекаются`).toBe(false);
        }
      }
    });
  }

  it('каждый объект данных нарисован хотя бы на одной схеме', () => {
    const drawn = new Set(SCENES.flatMap((s) => [...s.spots.map((p) => p.target), ...(s.corner ? [s.corner.target] : [])]));
    for (const e of ALL_ELEMENTS) expect(drawn.has(e.id), `«${e.title}» нет ни на одной схеме`).toBe(true);
  });

  it('разведение зон не допускает наложений даже у вплотную стоящих плашек', () => {
    const hits = hitAreas([[100, 100, 200, 50], [100, 160, 200, 50], [310, 100, 100, 50]], [1000, 1000], 20);
    expect(overlap(hits[0]!, hits[1]!)).toBe(false);
    expect(overlap(hits[0]!, hits[2]!)).toBe(false);
  });

  it('на экране у каждой подписи есть кликабельная зона с понятным названием', async () => {
    const el = await mount();
    const scene = SCENES.find((s) => s.id === 'outside')!;
    const markers = el.querySelectorAll('.scene-marker');
    expect(markers.length).toBe(scene.spots.length);
    for (const m of markers) expect(m.getAttribute('aria-label')?.length).toBeGreaterThan(2);
  });

  it('объект, которого нет в доме, приглушён, помечен «нет в доме» и не нажимается', async () => {
    const el = await mount('h_vch_pyatnitskiy_13', { features: { vch_pyatnitskiy_13: ['gas', 'central_heating', 'intercom', 'basement'] } });
    const lift = [...el.querySelectorAll<HTMLButtonElement>('.scene-marker')].find((b) => b.getAttribute('aria-label')?.startsWith('Лифт'));
    expect(lift?.disabled).toBe(true);
    expect(lift?.getAttribute('aria-label')).toContain('нет в этом доме');
    expect(lift?.textContent).toContain('нет в доме');
  });

  it('переход со схемы двора на схему подъезда одним нажатием', async () => {
    const el = await mount();
    await click(el.querySelector('.scene-marker.is-portal'), 'переход «Подъезд»');
    expect(el.querySelector('.segmented__item.is-active')?.textContent).toBe('Подъезд');
  });
});

describe('сценарии', () => {
  it('диплинк из бота открывает именно ту ситуацию', async () => {
    const el = await mount('h_vch_korovina_11-p_gas_stove__smell');
    expect(el.querySelector('.sheet__title')?.textContent).toBe('Газовая плита и газовая труба');
    expect(el.querySelector('.alert-panel--critical')?.textContent).toContain('104');
    expect(el.querySelector('a[href="tel:104"]')).toBeTruthy();
  });

  it('мусорный диплинк не ломает приложение: открывается схема по умолчанию', async () => {
    const el = await mount('p_nope;drop');
    expect(el.querySelector('.sheet')).toBeNull();
    expect(el.querySelector('.scene')).toBeTruthy();
  });

  it('постоянная плашка об источнике данных видна на главном экране', async () => {
    const el = await mount();
    expect(el.querySelector('.demo-banner')?.textContent).toContain('открытых');
    expect(el.querySelector('.demo-banner')?.textContent).toContain('Вичуга');
  });

  it('выбор дома по адресу: поиск, карточка дома с организацией, отметки «что есть в доме»', async () => {
    const el = await mount();
    expect(el.querySelector('.house-picker.is-empty')).toBeTruthy();
    await click(el.querySelector('.house-picker'), 'выбор дома');
    const input = el.querySelector<HTMLInputElement>('.houses input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Коровина 11');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const first = el.querySelector('.houses .list-row');
    expect(first?.textContent).toContain('ул. Коровина, 11');
    expect(first?.textContent).toContain('Жилищно-ремонтный участок №1');
    await click(first, 'дом в результатах');
    expect(el.querySelector('.house-card')?.textContent).toContain('г. Вичуга, ул. Коровина, д. 11');
    expect(el.querySelector('.house-card')?.textContent).toContain('+7 (493) 542-34-73');
    // сняли отметку «Лифт» – лифт на схеме приглушается
    const lift = [...el.querySelectorAll('.houses .chip')].find((c) => c.textContent?.includes('Лифт'));
    await click(lift, 'отметка «Лифт»');
    await click([...el.querySelectorAll('.houses button')].find((b) => b.textContent?.includes('Готово')), 'Готово');
    const marker = [...el.querySelectorAll<HTMLButtonElement>('.scene-marker')].find((b) => b.getAttribute('aria-label')?.startsWith('Лифт'));
    expect(marker?.disabled).toBe(true);
    expect(el.querySelector('.house-picker__address')?.textContent).toBe('ул. Коровина, 11');
    expect(JSON.parse(window.localStorage.getItem('features') ?? '{}')).toEqual({ vch_korovina_11: ['garbage_chute', 'gas', 'central_heating', 'intercom', 'basement'] });
  });

  it('до выбора дома карточка управляющей организации предлагает выбрать дом', async () => {
    const el = await mount('p_lamp_entrance__burned');
    expect(el.querySelector('.sheet')?.textContent).toContain('Выберите свой дом');
    await click([...el.querySelectorAll('.sheet button')].find((b) => b.textContent === 'Выбрать дом'), 'Выбрать дом');
    expect(el.querySelector('.sheet__title')?.textContent).toBe('Мой дом');
  });

  it('поиск свободным текстом находит ситуацию и открывает её', async () => {
    const el = await mount();
    await click(el.querySelector('.search-field'), 'строка поиска');
    const input = el.querySelector<HTMLInputElement>('.search input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'застрял в лифте');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const first = el.querySelector('.search .list-row');
    expect(first?.textContent).toContain('Застрял в лифте');
    await click(first, 'результат поиска');
    expect(el.querySelector('.sheet .result')).toBeTruthy();
  });

  it('раздел «Срочно»: 112 и 104 и все угрозы жизни с кнопкой звонка', async () => {
    const el = await mount();
    await click(el.querySelector('.bottom-nav__urgent'), 'кнопка «Срочно»');
    expect(el.querySelector('a[href="tel:112"]')).toBeTruthy();
    expect(el.querySelector('a[href="tel:104"]')).toBeTruthy();
    expect(el.querySelectorAll('.urgent-row__call.is-critical').length).toBeGreaterThan(5);
  });

  it('недосохранённый черновик обращения требует подтверждения при закрытии', async () => {
    const el = await mount('h_vch_korovina_11-p_roof__leak');
    const request = [...sheetBody(el)!.querySelectorAll('button')].find((b) => b.textContent?.includes('Составить обращение'));
    await click(request, 'кнопка «Составить обращение»');
    const area = el.querySelector<HTMLTextAreaElement>('.sheet textarea')!;
    expect(area.value).toContain('УК «Жилищно-ремонтный участок №1» (ИНН 3701043128)');
    expect(area.value).toContain('г. Вичуга, ул. Коровина, д. 11');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(area, `${area.value}\nДополнение жильца.`);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(el.querySelector('.sheet__head button[aria-label="Закрыть"]'), 'закрыть');
    expect(el.querySelector('.confirm')).toBeTruthy();
    await click([...el.querySelectorAll('.confirm__btn')].find((b) => b.textContent === 'Остаться'), 'остаться');
    expect(el.querySelector('.sheet textarea')).toBeTruthy();
    await click(el.querySelector('.sheet__head button[aria-label="Закрыть"]'), 'закрыть');
    await click([...el.querySelectorAll('.confirm__btn')].find((b) => b.textContent === 'Закрыть'), 'подтвердить');
    expect(el.querySelector('.sheet')).toBeNull();
  });

  it('дом из диплинка подставляет свою организацию и телефоны', async () => {
    const tszh = await mount('h_vch_pyatnitskiy_13-p_lamp_entrance__burned');
    expect(tszh.querySelector('.sheet')?.textContent).toContain('ТСЖ «Старатели»');
    expect(tszh.querySelector('.sheet a[href="tel:+79203778788"]')).toBeTruthy();
    await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    const uk = await mount('h_vch_korovina_11-p_lamp_entrance__burned');
    expect(uk.querySelector('.sheet')?.textContent).toContain('УК «Жилищно-ремонтный участок №1»');
  });

  it('дом за двумя организациями показывает расхождение из источника', async () => {
    const el = await mount('h_vch_moskovskaya_13-p_lamp_entrance__burned');
    expect(el.querySelector('.sheet')?.textContent).toContain('также указан за УК «Стоун»');
  });
});
