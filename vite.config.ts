import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { APP_NAME, THEME_BACKGROUND } from './src/config.ts';

const BASE = '/pick-tonight/';

/** Builds the home-screen manifest and page title from src/config.ts so the name lives in one place. */
function appIdentity(): Plugin {
  const manifest = () =>
    JSON.stringify({
      name: APP_NAME,
      short_name: APP_NAME,
      start_url: BASE,
      scope: BASE,
      display: 'standalone',
      orientation: 'portrait',
      background_color: THEME_BACKGROUND,
      theme_color: THEME_BACKGROUND,
      icons: [
        { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
  return {
    name: 'app-identity',
    transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%THEME_BG%', THEME_BACKGROUND),
    configureServer(server) {
      server.middlewares.use(`${BASE}manifest.webmanifest`, (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), appIdentity()],
  build: { outDir: 'dist', sourcemap: false },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
