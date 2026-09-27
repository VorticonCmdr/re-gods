/* diff.js — run one attract demo through the REAL port (main.js, via the
 * `?debug` handle `window.__gods`) and compare it, tick by tick, against a
 * DOSBox capture made by capture.lua/drive.py in this folder.
 *
 * Alignment: both sides are keyed by the tape cursor. A DOSBox row with
 * cursor c is the last state seen while DS:0x282 held c; the port's row
 * with cursor c is the last snapshot taken while `attract.tape.cursor` was c.
 *
 * Browser-only (imported from the dev server by an automation script):
 *   const m = await import('/tools/attract-capture/diff.js');
 *   await m.runDemo('joyg1')
 */

const STATE_OF = { joyl1: 0, joyg1: 1, joyl2: 2, joyg2: 3, joyl3: 4, joyg3: 5 };
const FIELDS = ['x', 'y', 'st', 'camX', 'camY', 'world', 'sub'];

export async function loadCapture(name) {
  /* The dev server answers a missing file with its index page (200), so
   * test the body, not the status. */
  let raw = null;
  for (const f of [`${name}.raw.json`, `${name}.v1.json`, `old/${name}.raw.json`]) {
    const t = await (await fetch(`/tools/attract-capture/${f}`)).text();
    if (t.startsWith('{')) { raw = JSON.parse(t).output; break; }
  }
  if (!raw) throw new Error(`no capture for ${name}`);
  /* World/sublevel: per row in the v1 format (8 fields), from the `ws`
   * change events in the current one (7 fields, the last is DS:0x160). */
  const ws = new Map();
  for (const e of (raw.ev || '').split(';')) {
    const m = /^(\d+):ws=(\d+)$/.exec(e);
    if (m) ws.set(+m[1], +m[2]);
  }
  let curWs = null;
  const rows = raw.rows.split(';').map((r) => {
    const v = r.split(',').map(Number);
    if (v.length === 8) {
      const [cursor, x, y, st, camX, camY, world, sub] = v;
      return { cursor, x, y, st, camX, camY, world, sub };
    }
    const [cursor, x, y, st, camX, camY, rc] = v;
    for (const [k, w] of ws) if (k <= cursor) curWs = w;
    return { cursor, x, y, st, camX, camY, r: rc,
      world: curWs === null ? undefined : curWs >> 4, sub: curWs === null ? undefined : curWs & 15 };
  });
  rows.rnd = (raw.rnd || '').split(';').filter(Boolean).map((e) => {
    const [cursor, r, hex] = e.split(':');
    return { cursor: +cursor, r: +r, hex };
  });
  return rows;
}

/* `rnd` (optional): the capture's random-table snapshots. Each is loaded
 * into the port once the port's own tape cursor reaches the snapshot's —
 * so both sides draw from the same DS:0x7E14 state. */
export async function runPort(name, maxTicks = 4000, rnd = []) {
  const g = window.__gods;
  /* DS:0x2F0 carries over between fights (see game/guardian.js); start each
   * run from a known value so the harness is reproducible. */
  g.resetProcessJaw();
  let first = await g.startAttractAt(STATE_OF[name]);
  const pending = rnd.slice();
  const inject = (cursor) => {
    while (pending.length && pending[0].cursor <= cursor) {
      const e = pending.shift();
      g.setRandom(e.hex, e.r);
    }
  };
  inject(0); first = g.snap();
  const byCursor = new Map([[0, first]]);
  for (let i = 0; i < maxTicks; i++) {
    const [s] = await g.stepTicks(1);
    if (!s.attract || s.attract.state !== STATE_OF[name]) break;   // tape ran out, cycler moved on
    inject(s.attract.cursor);
    byCursor.set(s.attract.cursor, s);
  }
  return byCursor;
}

const FILE_OF = { joyl1: 'PJOYL1', joyg1: 'PJOYG1', joyl2: 'PJOYL2', joyg2: 'PJOYG2', joyl3: 'PJOYL3', joyg3: 'PJOYG3' };

export async function loadTape(name) {
  const { dclDecompress } = await import('/src/formats/dcl.js');
  const { decodeJoyRecording } = await import('/src/formats/joy.js');
  const raw = new Uint8Array(await (await fetch(`/game/${FILE_OF[name]}.DAT`)).arrayBuffer());
  return decodeJoyRecording(dclDecompress(raw).data).ticks;
}

/** Side-by-side rows for cursors [from, to], with the tape input at each. */
export async function window_(name, from, to) {
  const dos = await loadCapture(name);
  const port = await runPort(name, 4000, dos.rnd);
  const tape = await loadTape(name);
  const k = (t) => t ? (t.left ? 'L' : '') + (t.right ? 'R' : '') + (t.up ? 'U' : '') + (t.down ? 'D' : '') + (t.fire ? 'F' : '') : '?';
  const out = [];
  for (let c = from; c <= to; c++) {
    const d = dos.find((r) => r.cursor === c), p = port.get(c);
    out.push(`c${c} in[c-1]=${k(tape[c - 1])} dos ${d && `${d.x},${d.y} st${d.st} r${d.r}`} | port ${p && `${p.x},${p.y} st${p.st} r${p.r}`}` +
      (d && p && (d.x !== p.x || d.y !== p.y || d.st !== p.st) ? '  <<' : ''));
  }
  return out;
}

/** Compare; returns the first divergence per field plus a compact summary. */
/* `random: true` also compares DS:0x160 (the random cursor) — a strong
 * diagnostic, but other subsystems' draws make it diverge long before the
 * hero does, so it is off by default. */
export async function runDemo(name, { fields = FIELDS, context = 3, random = false } = {}) {
  const dos = await loadCapture(name);
  const port = await runPort(name, 4000, dos.rnd);
  const firstBad = {};
  let compared = 0, missing = 0;
  for (const d of dos) {
    const p = port.get(d.cursor);
    if (!p) { missing++; continue; }
    /* Menu/password rows: the original's hero fields there are stale
     * leftovers from the previous demo, so only gameplay rows compare. */
    if (p.ui !== 'game') continue;
    compared++;
    for (const f of fields.concat(random && d.r !== undefined ? ['r'] : [])) {
      if (d[f] === undefined) continue;
      if (firstBad[f] === undefined && p[f] !== d[f]) firstBad[f] = d.cursor;
    }
  }
  const firstAny = Math.min(...Object.values(firstBad), Infinity);
  const around = [];
  if (firstAny !== Infinity) {
    for (let c = firstAny - context; c <= firstAny + context; c++) {
      const d = dos.find((r) => r.cursor === c), p = port.get(c);
      if (!d || !p) continue;
      around.push(`c${c} dos ${d.x},${d.y} st${d.st} cam${d.camX},${d.camY} w${d.world}${d.sub}` +
        ` | port ${p.x},${p.y} st${p.st} cam${p.camX},${p.camY} w${p.world}${p.sub} ${p.ui}`);
    }
  }
  const lastD = dos[dos.length - 1], lastP = port.get(lastD.cursor);
  return {
    name, dosTicks: dos.length, portCursors: port.size, compared, missing, firstBad,
    firstAny: firstAny === Infinity ? null : firstAny, around,
    end: { dos: lastD && `${lastD.x},${lastD.y} st${lastD.st}`, port: lastP && `${lastP.x},${lastP.y} st${lastP.st}` },
  };
}

/* The guardian stream `gd` (capture.lua): one entry per tick while DS:0x34
 * is set, holding only the fields that changed, as `cursor:i=v,i=v`. Field i
 * is GD_FIELDS[i-1]. Returns Map(cursor -> {field: value}) with every field
 * carried forward. Older captures used a positional format; those return null. */
export const GD_FIELDS = ['hp_28a', 'x_28c', 'y_28e', 'frame_290', 'script_292',
  'w2ca', 'w2cc', 'w2ce', 'w2d0', 'w2d4', 'w2d6', 'w2d8', 'w2da', 'w2dc', 'w2de',
  'w2e0', 'w2e2', 'w2e4', 'w2e6', 'w2e8', 'w2ea', 'cam32', 'poolN', 'poolSum'];

export async function loadGd(name) {
  const t = await (await fetch(`/tools/attract-capture/${name}.raw.json`)).text();
  const raw = JSON.parse(t).output;
  if (!raw.gd || !/=/.test(raw.gd)) return null;
  const out = new Map(), cur = {};
  for (const e of raw.gd.split(';').filter(Boolean)) {
    const [c, body] = e.split(':');
    for (const kv of (body || '').split(',').filter(Boolean)) {
      const [i, v] = kv.split('=');
      cur[GD_FIELDS[+i - 1]] = +v;
    }
    out.set(+c, { ...cur });
  }
  return out;
}
