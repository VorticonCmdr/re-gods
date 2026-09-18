import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* Only needed for the production build — Vite's dev server already serves
 * any root-level .html file (editor.html included) with no config at all;
 * `build.rollupOptions.input` defaults to `index.html` alone otherwise, so
 * `npm run build` would silently drop editor.html from `dist/`. */
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
});
