import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './ui/tokens.css';
import './ui/styles.css';
import App from './App';
import { uiPlatform } from './bridge';
import { ErrorBoundary } from './ui/ErrorBoundary';

/** Светлая или тёмная тема – по настройке устройства (MAX следует ей же). */
function useColorScheme(): 'light' | 'dark' {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark ? 'dark' : 'light';
}

function Root() {
  const scheme = useColorScheme();
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', scheme === 'dark' ? '#0e1420' : '#f6f8fa');
  }, [scheme]);
  return (
    <MaxUI platform={uiPlatform()} colorScheme={scheme} className="maxui-root">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MaxUI>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
