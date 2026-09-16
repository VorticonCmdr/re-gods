/* scope-check.mjs — prove that a `const`/`let` declared in main.js's tick is
 * still in scope everywhere it is read.
 *
 * WHY THIS EXISTS. main.js holds the frame loop, and this port's whole
 * method is to make that loop's statement order mirror GAME.EXE's own frame
 * loop (FUN_1000_006f). Keeping it faithful means MOVING statements, often
 * hundreds of lines, and nothing else in the toolchain can catch a move that
 * lands a reference outside its binding's block:
 *
 *   - `vite build`/esbuild do not care: an out-of-scope identifier is just a
 *     global lookup, which compiles cleanly and throws only at runtime.
 *   - The invariant suite drives game MODULES directly and never executes
 *     main.js's tick, so it never evaluates the reference at all.
 *   - The browser would catch it instantly, but an automated Chrome tab
 *     reports `document.visibilityState === 'hidden'`, which throttles
 *     requestAnimationFrame to zero callbacks — the tick never runs there.
 *     (That is the same limitation this project already recorded for live
 *     browser verification; it is not specific to this check.)
 *
 * So this reads the real AST — acorn, not a brace counter. A hand-rolled
 * comment/string stripper was tried first and silently lost braces in a way
 * that still balanced at EOF, reporting a wrong (far too large) enclosing
 * block while every self-check passed. That near-miss is the reason this
 * file uses a parser. */
import { readFileSync } from 'node:fs';

/* Scope-creating nodes for `let`/`const`. A function's parameters and body
 * both live in its BlockStatement, so listing the block forms is enough. */
const SCOPEY = new Set(['BlockStatement', 'Program', 'ForStatement', 'ForOfStatement',
                        'ForInStatement', 'SwitchStatement', 'StaticBlock']);

/** Returns suite-shaped rows: {pass, name, detail}. `names` are the bindings
 *  to prove. Resolves acorn lazily so a checkout without dev deps degrades to
 *  a note instead of crashing the whole run. */
export async function checkScope(path, names) {
  let acorn;
  try { acorn = await import('acorn'); } catch {
    return [{ note: true, pass: true, name: 'scope check skipped — acorn not installed',
              detail: 'npm install, then re-run; this check needs a real parser' }];
  }
  const src = readFileSync(path, 'utf8');
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });

  const decls = new Map();   // name -> {scope, start} of the FIRST let/const binding
  const refs = [];           // every Identifier occurrence
  (function walk(node, stack) {
    if (!node || typeof node.type !== 'string') return;
    const next = SCOPEY.has(node.type) ? [...stack, node] : stack;
    if (node.type === 'VariableDeclaration' && node.kind !== 'var') {
      for (const d of node.declarations) {
        if (d.id.type === 'Identifier' && !decls.has(d.id.name)) {
          decls.set(d.id.name, { scope: next[next.length - 1], start: d.id.start });
        }
      }
    }
    if (node.type === 'Identifier') refs.push({ name: node.name, start: node.start });
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach((n) => walk(n, next));
      else if (v && typeof v.type === 'string') walk(v, next);
    }
  })(ast, []);

  return names.map((name) => {
    const d = decls.get(name);
    if (!d) {
      return { pass: false, name: `\`${name}\` is in scope at every use`,
               detail: 'no let/const declaration found — was it renamed?' };
    }
    const uses = refs.filter((r) => r.name === name && r.start !== d.start);
    const outside = uses.filter((r) => r.start < d.scope.start || r.start > d.scope.end);
    return {
      pass: outside.length === 0 && uses.length > 0,
      name: `\`${name}\` is in scope at every use`,
      detail: outside.length
        ? `${outside.length} of ${uses.length} uses OUTSIDE the binding's block `
          + `(first at line ${lineOf(outside[0].start)})`
        : `declared line ${lineOf(d.start)}, block lines `
          + `${lineOf(d.scope.start)}-${lineOf(d.scope.end)}, ${uses.length} uses all inside`,
    };
  });
}
