import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppServices } from '../contracts';
import { APP_NAME, THEME_ACCENT } from '../config';
import { createEngine } from '../engine';
import { createSync } from '../sync';
import { App } from '../ui';
import { loadData } from './loadCatalog';

/**
 * Wiring: load the catalog, start the engine and sync, hand them to the UI.
 *
 * Switches (query string, remembered for the browser tab so they survive navigation):
 *   ?catalog=fixture  use the built-in sample catalog instead of the daily one
 *   ?sync=memory      keep data on this device only (no Firebase)
 */
function option(name: string, allowed: string[], fallback: string): string {
  const fromUrl = new URLSearchParams(location.search).get(name);
  const key = `wtw.opt.${name}`;
  if (fromUrl && allowed.includes(fromUrl)) {
    try {
      sessionStorage.setItem(key, fromUrl);
    } catch {
      /* private mode */
    }
    return fromUrl;
  }
  try {
    const saved = sessionStorage.getItem(key);
    if (saved && allowed.includes(saved)) return saved;
  } catch {
    /* private mode */
  }
  return fallback;
}

const root = createRoot(document.getElementById('root')!);

function Splash({ message, error }: { message: string; error?: boolean }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 32,
        boxSizing: 'border-box',
        textAlign: 'center',
        color: '#fff',
        fontFamily: '-apple-system, system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 34, fontWeight: 800, color: THEME_ACCENT }}>{APP_NAME}</div>
      <div data-testid={error ? 'boot-error' : 'boot-loading'} style={{ opacity: 0.75, fontSize: 16, lineHeight: 1.4 }}>
        {message}
      </div>
      {error && (
        <button
          onClick={() => location.reload()}
          style={{ marginTop: 12, padding: '12px 24px', borderRadius: 999, border: 0, background: THEME_ACCENT, color: '#fff', fontSize: 16, fontWeight: 600 }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

async function boot() {
  root.render(<Splash message="Loading…" />);
  const catalogSource = option('catalog', ['live', 'fixture'], 'live') as 'live' | 'fixture';
  const syncMode = option('sync', ['firebase', 'memory'], 'firebase') as 'firebase' | 'memory';

  const data = await loadData(catalogSource);
  const engine = createEngine();
  const sync = createSync({ mode: syncMode });
  // Don't block first paint on the network: the UI shows its own state while the device is 'loading'.
  void sync.init().catch((err) => console.error('sync init failed', err));

  const services: AppServices = { catalog: data.catalog, newArrivals: data.newArrivals, engine, sync };
  root.render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  );
}

boot().catch((err) => {
  console.error(err);
  root.render(<Splash error message="Couldn't load the catalog. Check your connection and try again." />);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
