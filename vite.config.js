import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /* The shipped game files live in game/ at the project root. In dev, Vite
   * serves them as-is, so every `game/…` URL gets the original bytes. They are
   * commercial software and deliberately NOT copied into a build: there is no
   * public/ dir, and a built index.html asks for the user's own copy
   * ("Load folder…"). */
  publicDir: false,
  /* Vite's dev server serves any root-level .html file with no config at all;
   * `build.rollupOptions.input` defaults to `index.html` alone otherwise, so
   * `npm run build` would silently drop the other pages from `dist/`. */
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
    },
  },
});
