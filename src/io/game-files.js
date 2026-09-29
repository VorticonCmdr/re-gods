/* game-files.js — where the pages get the shipped game files from.
 *
 * The files are not part of this repository. In dev, Vite serves them from
 * the git-ignored game/ at the project root, so a `game/<NAME>` URL returns
 * the original bytes. A build ships none of them; there, the header's
 * "Load folder…" button lets the user pick their own copy, which is read
 * straight from disk and never uploaded. Shared by index.html (main.js) and
 * editor.html (editor/state.js).
 */

const cache = new Map();
/* Files picked with "Load folder…", by upper-case base name. When set, they
 * stand in for the served game/ directory. */
const folderFiles = new Map();

/** Raw bytes of `game/<NAME>` (memoized). */
export async function fetchRaw(url) {
  if (cache.has(url)) return cache.get(url);
  const picked = folderFiles.get(url.replace(/^game\//, '').toUpperCase());
  let b;
  if (picked) {
    b = new Uint8Array(await picked.arrayBuffer());
  } else {
    const res = await fetch(url);
    /* Vite's dev server can answer a missing file with index.html and a 200. */
    if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) {
      throw new Error(`fetch ${url}: ${res.status}`);
    }
    b = new Uint8Array(await res.arrayBuffer());
  }
  cache.set(url, b);
  return b;
}

const PROBE_FILE = 'PLEV1A.MAP';

/** Resolves once the game files are readable. If game/ is not served, shows
 *  `button` (a hidden "Load folder…") and waits until the user picks a
 *  directory that holds them; `input` is its `webkitdirectory` file input and
 *  `status` a text span for messages. */
export async function ensureGameData({ button, input, status }) {
  try { await fetchRaw(`game/${PROBE_FILE}`); return; } catch { /* not served */ }
  button.hidden = false;
  status.textContent = 'no game data — load the GODS folder';
  button.onclick = () => input.click();
  await new Promise((resolve) => {
    input.onchange = () => {
      const files = [...input.files];
      input.value = '';
      if (!files.some((f) => f.name.toUpperCase() === PROBE_FILE)) {
        status.textContent = `${PROBE_FILE} not found in that folder — pick the GODS directory`;
        return;
      }
      folderFiles.clear();
      for (const f of files) folderFiles.set(f.name.toUpperCase(), f);
      resolve();
    };
  });
  button.hidden = true;
  status.textContent = '';
}
