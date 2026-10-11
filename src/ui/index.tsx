import type { AppProps } from '../contracts';
import { APP_NAME } from '../config';

/** PLACEHOLDER from the lead. The ui teammate replaces this whole file. */
export function App({ services }: AppProps) {
  return (
    <main style={{ color: '#fff', fontFamily: 'system-ui', padding: 24 }}>
      <h1>{APP_NAME}</h1>
      <p>{services.catalog.items.length} titles loaded. Screens are not built yet.</p>
    </main>
  );
}
