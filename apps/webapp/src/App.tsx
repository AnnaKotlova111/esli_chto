import { CITY } from '@esli-chto/core';
import { IconButton, Spinner } from '@maxhub/max-ui';
import { HowItWorks, TabContent } from './screens/Home';
import { SearchOverlay } from './screens/Search';
import { SheetHost } from './screens/Sheets';
import { AppProvider, useApp, type Tab } from './state';
import { Icon, type UiIconName } from './ui/icons';

const TABS: { id: Tab; label: string; icon: UiIconName }[] = [
  { id: 'house', label: 'Наш дом', icon: 'tabHouse' },
  { id: 'flat', label: 'Моя квартира', icon: 'tabFlat' },
];

function Shell() {
  const { state, house, setTab, open, setSearch } = useApp();

  if (!state.ready) {
    return (
      <div className="boot" role="status" aria-live="polite">
        <Spinner size={32} />
        <p>Загружаем дом…</p>
      </div>
    );
  }

  const covered = state.sheet.length > 0 || state.searchOpen;

  return (
    <div className="app">
      <div className="app__page" aria-hidden={covered} {...(covered ? { inert: true } : {})}>
        <div className="demo-banner" role="note">
          <Icon name="info" size={18} />
          <span>
            {house.isDemo
              ? 'Демо-данные: организации и телефоны вымышлены'
              : `${CITY.name}: данные из открытых источников на ${CITY.updatedAt.split('-').reverse().join('.')}`}
          </span>
        </div>

        <header className="topbar">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <Icon name="urgent" size={18} />
            </span>
            <span className="brand__name">Если что</span>
          </div>
          <IconButton variant="ghost" size="medium" className="icon-btn" onClick={() => open({ t: 'about' })} aria-label="О приложении">
            <Icon name="info" />
          </IconButton>
        </header>

        {house.id === 'none' ? (
          <button type="button" className="house-picker is-empty" onClick={() => open({ t: 'houses' })}>
            <span className="house-picker__icon">
              <Icon name="location" />
            </span>
            <span className="house-picker__text">
              <span className="house-picker__address">Выберите свой дом</span>
              <span className="house-picker__meta">Покажем телефоны вашей управляющей организации</span>
            </span>
            <Icon name="forward" size={20} />
          </button>
        ) : (
          <button type="button" className="house-picker" onClick={() => open({ t: 'houses' })} aria-label={`Мой дом: ${house.address}. Сменить дом`}>
            <span className="house-picker__icon">
              <Icon name="location" />
            </span>
            <span className="house-picker__text">
              <span className="house-picker__address">{house.title}</span>
              <span className="house-picker__meta">{house.contacts.manager?.name ?? house.managerKind}</span>
            </span>
            <Icon name="expand" size={20} />
          </button>
        )}
        {house.id !== 'none' && !house.featuresKnown && (
          <button type="button" className="features-hint" onClick={() => open({ t: 'features' })}>
            <Icon name="help" size={18} />
            <span>Есть ли в доме лифт, газ, мусоропровод? Отметьте – лишнее скроем</span>
          </button>
        )}

        <h1 className="page-title">Что случилось?</h1>
        <button type="button" className="search-field" onClick={() => setSearch(true)}>
          <Icon name="search" size={20} />
          <span>Например: течёт кран</span>
        </button>

        <HowItWorks />

        <main className="page-main" id="main">
          <TabContent tab={state.tab} key={state.tab} />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Разделы" aria-hidden={covered} {...(covered ? { inert: true } : {})}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={state.tab === t.id ? 'bottom-nav__item is-active' : 'bottom-nav__item'}
            aria-current={state.tab === t.id ? 'page' : undefined}
            onClick={() => {
              setTab(t.id);
              window.scrollTo({ top: 0 });
            }}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
        <button type="button" className="bottom-nav__item bottom-nav__urgent" onClick={() => open({ t: 'urgent' })}>
          <Icon name="urgent" />
          <span>Срочно</span>
        </button>
      </nav>

      <SheetHost />
      <SearchOverlay />
      {state.toast && (
        <div className="toast" role="status" aria-live="polite">
          <Icon name="success" size={18} />
          <span>{state.toast}</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
