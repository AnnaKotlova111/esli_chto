import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import {
  ALL_FEATURES, DEFAULT_HOUSE_ID, decodeDeepLink, getElement, getHouse, getProblem, isKnownHouse, withFeatures,
  type Category, type Feature, type HouseProfile, type Scope, type UserInfo,
} from '@esli-chto/core';
import { backButton, closingConfirmation, haptic, startParam, storage } from './bridge';
import { sceneOfElement } from './scenes/scenes';

export type Tab = Scope;

export type SheetView =
  | { t: 'element'; id: string }
  | { t: 'flow'; problemId: string; answers: number[] }
  | { t: 'norm'; id: string }
  | { t: 'request'; problemId: string; answers: number[] }
  | { t: 'houses' }
  | { t: 'features' }
  | { t: 'about' }
  | { t: 'privacy' }
  | { t: 'terms' }
  | { t: 'urgent' };

interface State {
  ready: boolean;
  houseId: string;
  /** Что есть в доме – отметки жителя по каждому дому (в реестре этого нет) */
  features: Record<string, Feature[]>;
  tab: Tab;
  scene: Record<Tab, string>;
  category: Record<Tab, Category | null>;
  sheet: SheetView[];
  searchOpen: boolean;
  user: UserInfo;
  /** Недавно открытые ситуации */
  recent: string[];
  /** История поисковых запросов */
  searches: string[];
  /** Выбранный объект – подсвечивается на схеме */
  highlight: string | null;
  /** В конструкторе обращения есть несохранённые правки */
  draftDirty: boolean;
  /** Ждём подтверждения закрытия черновика: что сделать после «Закрыть» */
  confirmLeave: 'back' | 'close' | null;
  toast: string | null;
}

type Action =
  | { type: 'LOADED'; houseId?: string; features?: Record<string, Feature[]>; user?: UserInfo; recent?: string[]; searches?: string[] }
  | { type: 'SET_HOUSE'; houseId: string }
  | { type: 'SET_FEATURES'; houseId: string; features: Feature[] }
  | { type: 'SET_TAB'; tab: Tab }
  | { type: 'SET_SCENE'; tab: Tab; scene: string }
  | { type: 'SET_CATEGORY'; tab: Tab; category: Category | null }
  | { type: 'OPEN'; view: SheetView }
  | { type: 'REPLACE_TOP'; view: SheetView }
  | { type: 'BACK' }
  | { type: 'CLOSE_ALL' }
  | { type: 'CONFIRM_LEAVE' }
  | { type: 'CANCEL_LEAVE' }
  | { type: 'SEARCH'; open: boolean }
  | { type: 'REMEMBER_SEARCH'; query: string }
  | { type: 'USER'; user: UserInfo }
  | { type: 'RECENT'; problemId: string }
  | { type: 'HIGHLIGHT'; id: string | null }
  | { type: 'DRAFT'; dirty: boolean }
  | { type: 'TOAST'; text: string | null }
  | { type: 'ERASE' };

const initial: State = {
  ready: false,
  houseId: DEFAULT_HOUSE_ID,
  features: {},
  tab: 'house',
  scene: { house: 'outside', flat: 'plan' },
  category: { house: null, flat: null },
  sheet: [],
  searchOpen: false,
  user: {},
  recent: [],
  searches: [],
  highlight: null,
  draftDirty: false,
  confirmLeave: null,
  toast: null,
};

const onRequest = (s: State) => s.sheet[s.sheet.length - 1]?.t === 'request';

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'LOADED':
      return {
        ...s,
        ready: true,
        houseId: a.houseId ?? s.houseId,
        features: a.features ?? s.features,
        user: a.user ?? s.user,
        recent: a.recent ?? s.recent,
        searches: a.searches ?? s.searches,
      };
    case 'SET_HOUSE':
      return { ...s, houseId: a.houseId, sheet: s.sheet.filter((v) => v.t === 'houses' || v.t === 'features'), highlight: null, draftDirty: false };
    case 'SET_FEATURES':
      return { ...s, features: { ...s.features, [a.houseId]: a.features } };
    case 'SET_TAB':
      return { ...s, tab: a.tab, highlight: null };
    case 'SET_SCENE':
      return { ...s, scene: { ...s.scene, [a.tab]: a.scene }, highlight: null };
    case 'SET_CATEGORY':
      return { ...s, category: { ...s.category, [a.tab]: a.category } };
    case 'OPEN':
      return { ...s, sheet: [...s.sheet, a.view], searchOpen: false };
    case 'REPLACE_TOP':
      return { ...s, sheet: [...s.sheet.slice(0, -1), a.view] };
    case 'BACK': {
      if (s.confirmLeave) return { ...s, confirmLeave: null };
      if (s.searchOpen) return { ...s, searchOpen: false };
      const top = s.sheet[s.sheet.length - 1];
      if (!top) return s;
      if (onRequest(s) && s.draftDirty) return { ...s, confirmLeave: 'back' };
      // в диалоге вопросов «назад» отменяет последний ответ, а не закрывает всю карточку
      if (top.t === 'flow' && top.answers.length > 0) {
        return { ...s, sheet: [...s.sheet.slice(0, -1), { ...top, answers: top.answers.slice(0, -1) }] };
      }
      const sheet = s.sheet.slice(0, -1);
      return { ...s, sheet, draftDirty: onRequest(s) ? false : s.draftDirty, confirmLeave: null, highlight: sheet.length ? s.highlight : null };
    }
    case 'CLOSE_ALL':
      if (s.sheet.some((v) => v.t === 'request') && s.draftDirty) return { ...s, confirmLeave: 'close' };
      return { ...s, sheet: [], highlight: null, draftDirty: false, confirmLeave: null };
    case 'CONFIRM_LEAVE': {
      if (s.confirmLeave === 'back') {
        const sheet = s.sheet.slice(0, -1);
        return { ...s, sheet, draftDirty: false, confirmLeave: null };
      }
      return { ...s, sheet: [], highlight: null, draftDirty: false, confirmLeave: null };
    }
    case 'CANCEL_LEAVE':
      return { ...s, confirmLeave: null };
    case 'SEARCH':
      return { ...s, searchOpen: a.open };
    case 'REMEMBER_SEARCH': {
      const q = a.query.trim();
      if (!q) return s;
      return { ...s, searches: [q, ...s.searches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6) };
    }
    case 'USER':
      return { ...s, user: a.user };
    case 'RECENT':
      return s.recent[0] === a.problemId ? s : { ...s, recent: [a.problemId, ...s.recent.filter((x) => x !== a.problemId)].slice(0, 6) };
    case 'HIGHLIGHT':
      return { ...s, highlight: a.id };
    case 'DRAFT':
      return s.draftDirty === a.dirty ? s : { ...s, draftDirty: a.dirty };
    case 'TOAST':
      return { ...s, toast: a.text };
    case 'ERASE':
      return { ...s, houseId: DEFAULT_HOUSE_ID, features: {}, user: {}, recent: [], searches: [], sheet: [], highlight: null, draftDirty: false };
  }
}

export interface AppApi {
  state: State;
  house: HouseProfile;
  open(view: SheetView): void;
  replaceTop(view: SheetView): void;
  back(): void;
  closeAll(): void;
  /** Подтвердить уход из черновика обращения */
  confirmLeave(): void;
  cancelLeave(): void;
  setTab(tab: Tab): void;
  setScene(tab: Tab, scene: string): void;
  setCategory(tab: Tab, category: Category | null): void;
  setHouse(id: string): void;
  /** Отметить, что есть в доме: лишние объекты приглушаются с пометкой «нет в доме» */
  setFeatures(houseId: string, features: Feature[]): void;
  setSearch(open: boolean): void;
  rememberSearch(query: string): void;
  setUser(user: UserInfo): void;
  touchRecent(problemId: string): void;
  highlight(id: string | null): void;
  setDraftDirty(dirty: boolean): void;
  toast(text: string): void;
  /** Стереть всё, что приложение сохранило на устройстве */
  eraseLocalData(): void;
  /** Открыть объект: переключить вкладку и схему, подсветить, открыть карточку (и ситуацию) */
  goToElement(elementId: string, problemId?: string): void;
}

const Ctx = createContext<AppApi | null>(null);

const STORAGE_KEYS = ['house', 'features', 'user', 'recent', 'searches'] as const;

const parse = <T,>(raw: string | null, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const house = useMemo(() => withFeatures(getHouse(state.houseId), state.features[state.houseId]), [state.houseId, state.features]);

  // Действия зависят только от dispatch – их идентичность стабильна, эффекты не зацикливаются.
  const actions = useMemo<Omit<AppApi, 'state' | 'house'>>(() => {
    const openElement = (elementId: string, problemId?: string) => {
      const el = getElement(elementId);
      if (!el) return;
      dispatch({ type: 'SET_TAB', tab: el.scope });
      const scene = sceneOfElement(el.id, el.scope);
      if (scene) dispatch({ type: 'SET_SCENE', tab: el.scope, scene: scene.id });
      dispatch({ type: 'HIGHLIGHT', id: el.id });
      dispatch({ type: 'OPEN', view: { t: 'element', id: el.id } });
      if (problemId && getProblem(problemId)) dispatch({ type: 'OPEN', view: { t: 'flow', problemId, answers: [] } });
    };
    return {
      open: (view) => {
        haptic.selection();
        dispatch({ type: 'OPEN', view });
      },
      replaceTop: (view) => dispatch({ type: 'REPLACE_TOP', view }),
      back: () => dispatch({ type: 'BACK' }),
      closeAll: () => dispatch({ type: 'CLOSE_ALL' }),
      confirmLeave: () => dispatch({ type: 'CONFIRM_LEAVE' }),
      cancelLeave: () => dispatch({ type: 'CANCEL_LEAVE' }),
      setTab: (tab) => {
        haptic.selection();
        dispatch({ type: 'SET_TAB', tab });
      },
      setScene: (tab, scene) => {
        haptic.selection();
        dispatch({ type: 'SET_SCENE', tab, scene });
      },
      setCategory: (tab, category) => dispatch({ type: 'SET_CATEGORY', tab, category }),
      setHouse: (id) => dispatch({ type: 'SET_HOUSE', houseId: id }),
      setFeatures: (houseId, features) => dispatch({ type: 'SET_FEATURES', houseId, features }),
      setSearch: (open) => dispatch({ type: 'SEARCH', open }),
      rememberSearch: (query) => dispatch({ type: 'REMEMBER_SEARCH', query }),
      setUser: (user) => dispatch({ type: 'USER', user }),
      touchRecent: (problemId) => dispatch({ type: 'RECENT', problemId }),
      highlight: (id) => dispatch({ type: 'HIGHLIGHT', id }),
      setDraftDirty: (dirty) => dispatch({ type: 'DRAFT', dirty }),
      toast: (text) => dispatch({ type: 'TOAST', text }),
      eraseLocalData: () => {
        dispatch({ type: 'ERASE' });
        void Promise.all(STORAGE_KEYS.map((k) => storage.remove(k)));
      },
      goToElement: openElement,
    };
  }, []);

  // Загрузка сохранённых данных и разбор параметра запуска (диплинка)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [h, f, u, r, q] = await Promise.all(STORAGE_KEYS.map((k) => storage.get(k)));
      if (!alive) return;
      const link = decodeDeepLink(startParam());
      const known = (id?: string | null) => (id && isKnownHouse(id) ? id : undefined);
      // отметки особенностей: только известные дома и известные особенности
      const saved = parse<Record<string, unknown>>(f ?? null, {});
      const features = Object.fromEntries(
        Object.entries(saved)
          .filter(([id, list]) => isKnownHouse(id) && Array.isArray(list))
          .map(([id, list]) => [id, ALL_FEATURES.filter((x) => (list as unknown[]).includes(x))]),
      );
      dispatch({
        type: 'LOADED',
        houseId: known(link.houseId) ?? known(h),
        features,
        user: parse<UserInfo>(u ?? null, {}),
        recent: parse<string[]>(r ?? null, []).filter((id) => getProblem(id)),
        searches: parse<string[]>(q ?? null, []).filter((x) => typeof x === 'string').slice(0, 6),
      });
      if (link.elementId) actions.goToElement(link.elementId, link.problemId);
    })();
    return () => {
      alive = false;
    };
  }, [actions]);

  // Сохранение на устройстве
  useEffect(() => {
    if (state.ready) void storage.set('house', state.houseId);
  }, [state.houseId, state.ready]);
  useEffect(() => {
    if (state.ready) void storage.set('features', JSON.stringify(state.features));
  }, [state.features, state.ready]);
  useEffect(() => {
    if (state.ready) void storage.set('user', JSON.stringify(state.user));
  }, [state.user, state.ready]);
  useEffect(() => {
    if (state.ready) void storage.set('recent', JSON.stringify(state.recent));
  }, [state.recent, state.ready]);
  useEffect(() => {
    if (state.ready) void storage.set('searches', JSON.stringify(state.searches));
  }, [state.searches, state.ready]);

  // Нативная кнопка «Назад» MAX закрывает поиск и шаги шторки по одному
  const active = state.sheet.length > 0 || state.searchOpen || state.confirmLeave !== null;
  useEffect(() => {
    const cb = () => dispatch({ type: 'BACK' });
    if (!active) {
      backButton.hide();
      return;
    }
    backButton.show();
    backButton.onClick(cb);
    return () => backButton.offClick(cb);
  }, [active]);

  // Подтверждение закрытия мини-приложения, пока в черновике обращения есть правки
  useEffect(() => {
    closingConfirmation(state.draftDirty);
  }, [state.draftDirty]);

  // Esc – тот же шаг назад
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'BACK' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Подсказка исчезает сама
  useEffect(() => {
    if (!state.toast) return;
    const t = window.setTimeout(() => dispatch({ type: 'TOAST', text: null }), 2800);
    return () => window.clearTimeout(t);
  }, [state.toast]);

  const api = useMemo<AppApi>(() => ({ state, house, ...actions }), [state, house, actions]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp вне AppProvider');
  return v;
}
