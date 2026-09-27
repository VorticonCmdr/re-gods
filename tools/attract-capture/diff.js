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
  let res = await fetch(`/tools/attract-capture/${name}.raw.json`);
  if (!res.ok) res = await fetch(`/tools/attract-capture/${name}.v1.json`);
  const raw = await res.json();
  const rows = raw.output.rows.split(';').map((r) => {
    const [cursor, x, y, st, camX, camY, world, sub] = r.split(',').map(Number);
    return { cursor, x, y, st, camX, camY, world, sub };
  });
  return rows;
}

export async function runPort(name, maxTicks = 4000) {
  const g = window.__gods;
  const first = await g.startAttractAt(STATE_OF[name]);
  const byCursor = new Map([[0, first]]);
  for (let i = 0; i < maxTicks; i++) {
    const [s] = await g.stepTicks(1);
    if (!s.attract || s.attract.state !== STATE_OF[name]) break;   // tape ran out, cycler moved on
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
  const port = await runPort(name);
  const tape = await loadTape(name);
  const k = (t) => t ? (t.left ? 'L' : '') + (t.right ? 'R' : '') + (t.up ? 'U' : '') + (t.down ? 'D' : '') + (t.fire ? 'F' : '') : '?';
  const out = [];
  for (let c = from; c <= to; c++) {
    const d = dos.find((r) => r.cursor === c), p = port.get(c);
    out.push(`c${c} in[c-1]=${k(tape[c - 1])} dos ${d && `${d.x},${d.y} st${d.st}`} | port ${p && `${p.x},${p.y} st${p.st}`}` +
      (d && p && (d.x !== p.x || d.y !== p.y || d.st !== p.st) ? '  <<' : ''));
  }
  return out;
}

/** Compare; returns the first divergence per field plus a compact summary. */
export async function runDemo(name, { fields = FIELDS, context = 3 } = {}) {
  const dos = await loadCapture(name);
  const port = await runPort(name);
  const firstBad = {};
  let compared = 0, missing = 0;
  for (const d of dos) {
    const p = port.get(d.cursor);
    if (!p) { missing++; continue; }
    compared++;
    for (const f of fields) {
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
