/* verify-node.mjs — run the browser invariant suite headlessly.
 *
 * Same modules, same assertions as the in-page panel, but driven from disk so
 * the port can be checked in CI or from a terminal without a browser.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PUB  = resolve(here, '..', 'public');

const { runAllChecks } = await import('../src/verify/checks.js');
const { dclDecompress } = await import('../src/formats/dcl.js');
const { decodePI1, sliceTiles, TILE_COUNT } = await import('../src/formats/pi1.js');
const { parseMap, TILE_COUNTS } = await import('../src/formats/map.js');
const { Player } = await import('../src/game/player.js');
const { JUMP_DELTAS } = await import('../src/game/player.js');

const fetchRaw = async (url) => {
  const p = join(PUB, url);
  if (!existsSync(p)) throw new Error(`missing asset: ${url} (run: npm run assets)`);
  return new Uint8Array(readFileSync(p));
};

console.log('GODS web port — headless invariant run\n');

const { results, sampleMessages, hist } = await runAllChecks(fetchRaw);
let bad = 0;
/* Row totals, so the permanent write-up can quote the tool instead of a
 * hand-derived grep. `asserts` counts rows that can FAIL; `notes` counts rows
 * that only report. */
let asserts = 0, notes = 0;
const tally = (isNote) => { if (isNote) notes++; else asserts++; };
/* A `note` row reports a measurement rather than asserting one; print it as
 * `note`, never `ok`, so the headless output carries the same distinction the
 * in-page panel does. */
const line = (r) => { tally(r.note); return `  ${r.note ? 'note' : r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`; };
for (const r of results) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}
console.log(`\n  verb histogram: ${hist.join('/')}`);
console.log('  sample recovered text:');
for (const m of sampleMessages) console.log(`    "${m}"`);

/* --- extra checks that only make sense outside the page --- */

/* The jump table must be exactly symmetric: 4 zeros of wind-up, then a rise
 * whose total equals the descent. Verbatim from DS:0xd922. */
const rise = JUMP_DELTAS.filter((d) => d > 0).reduce((a, b) => a + b, 0);
const fall = -JUMP_DELTAS.filter((d) => d < 0).reduce((a, b) => a + b, 0);
const symOk = rise === fall && JUMP_DELTAS.length === 23;
tally(false);
console.log(`\n  ${symOk ? 'ok  ' : 'FAIL'}  jump table: 23 entries, rise ${rise} px == descent ${fall} px`);
if (!symOk) bad++;

/* Physics smoke test: a hero dropped in empty space must reach terminal
 * velocity of 14 px/tick (dY = 4 + v, v clamped at 10) and never exceed it. */
const emptyMap = {
  planeA: new Uint8Array(128 * 64), planeB: new Uint8Array(128 * 64),
  widthPx: 4096, heightPx: 1024,
};
const p = new Player(64, 0);
const noInput = { left: false, right: false, up: false, down: false, fire: false };
let maxStep = 0, prevY = p.y;
/* `tock` alternates as DS:0x36C does (gravity only steps when it is 0,
 * CS:0x48BB), so v reaches its clamp after ~20 ticks, not 10. */
for (let i = 0; i < 40; i++) { p.tick(emptyMap, noInput, null, (i & 1) ? 0 : 1); maxStep = Math.max(maxStep, p.y - prevY); prevY = p.y; }
const termOk = maxStep === 14;
tally(false);
console.log(`  ${termOk ? 'ok  ' : 'FAIL'}  terminal fall speed == 14 px/tick (got ${maxStep})`);
if (!termOk) bad++;

/* Tile slicing must produce exactly 120 tiles of 32x16. */
const sheet = decodePI1(dclDecompress(await fetchRaw('game/PBITS1A.PI1')).data);
const tiles = sliceTiles(sheet);
const tilesOk = tiles.length === TILE_COUNT && tiles.every((t) => t.length === 32 * 16);
tally(false);
console.log(`  ${tilesOk ? 'ok  ' : 'FAIL'}  tile sheet slices to ${TILE_COUNT} tiles of 32x16`);
if (!tilesOk) bad++;

/* Plane A is 1-BASED (tile = A-1) and legal values are 1..count, where count
 * comes from GAME.EXE's per-level table. Values outside that range read the
 * tile cache past what export 17 filled; on a fresh load that tail is zeros,
 * so they draw empty. Report the counts rather than asserting - they are a
 * property of the level data, not an error. */
const map = parseMap(dclDecompress(await fetchRaw('game/PLEV1A.MAP')).data);
let outside = 0, zero = 0;
for (const v of map.planeA) { if (v === 0) zero++; else if (v - 1 >= TILE_COUNTS['1A']) outside++; }
tally(true);
console.log(`  note  PLEV1A: ${zero} cells A==0, ${outside} cells outside [1,${TILE_COUNTS['1A']}] -> drawn empty`);

/* --- the event-probe column fix, demonstrating itself ---------------------
 * CS:0x5fb2 rounds X to the nearest column (`add ax,0x10 / and ax,0xffe0`)
 * before indexing plane B, while Y is floored. This port used `x >> 5`, which
 * fires every plane-B event 16 px late. Rather than claim the fix is right,
 * measure the shift: walk a hero eastward along every row of every level and
 * record the X at which each event cell first triggers under both formulas. */
const { EventRunner, parsePalfils, palfilsNameFor } = await import('../src/game/events.js');

/* Walk a hero east along every row that carries an event cell and record the
 * SEQUENCE of trigger indices that fire, under each column formula. This is
 * data-dependent: two rounding rules can select different cells, fire
 * different triggers, or fire them in a different order — the arithmetic
 * "every cell shifts by 16" is true by construction and tests nothing. */
async function fireSequence(key, colFn) {
  const m = parseMap(dclDecompress(await fetchRaw(`game/PLEV${key}.MAP`)).data);
  const pal = parsePalfils(dclDecompress(await fetchRaw(`game/${palfilsNameFor(key)}`)).data);
  const seq = [];
  for (let row = 0; row < 64; row++) {
    let any = false;
    for (let c = 0; c < 128; c++) if (m.planeB[row * 128 + c] >= 3) { any = true; break; }
    if (!any) continue;
    const run = new EventRunner(m, pal);
    const y = row * 16;
    for (let x = 0; x < 4096; x += 4) {
      /* Drive the runner's own logic, overriding only the column rule. */
      /* `events: null` — COND5/6 see no consumed events, so this compares the
       * column rule alone, not the order the two walks consume events in. */
      const fired = run.step(x, y, run.makeState({ timer: 0, events: null }), colFn(x));
      if (fired) seq.push({ id: `${row}:${fired.trigger}`, x });
    }
  }
  return seq;
}

/* MEASURED — and it corrects the claim this fix was first written under.
 * Sweeping a whole row visits every column under either rule, in the same
 * order, so the SET and ORDER of triggers is identical on all 8 levels: the
 * rounding does NOT change which events a traversing hero reaches. What it
 * changes is the hero X at which each fires. Both halves are asserted, so a
 * future change that made the rules diverge in coverage would show up. */
let sameList = 0, deltas = new Set(), firedTotal = 0;
for (const key of ['1A','1B','2A','2B','3A','3B','4A','4B']) {
  const oldSeq = await fireSequence(key, (x) => x >> 5);
  const newSeq = await fireSequence(key, (x) => (x + 16) >> 5);
  firedTotal += newSeq.length;
  if (oldSeq.length === newSeq.length && oldSeq.every((e, i) => e.id === newSeq[i].id)) sameList++;
  oldSeq.forEach((e, i) => { if (newSeq[i]) deltas.add(e.x - newSeq[i].x); });
}
const dk = [...deltas];
const probeOk = sameList === 8 && dk.length === 1 && dk[0] === 16;
tally(false);
console.log(`\n  ${probeOk ? 'ok  ' : 'FAIL'}  event probe: identical trigger list on ${sameList}/8 levels, ` +
            `all ${firedTotal} fires moved earlier by exactly ${dk.join(',')} px`);
tally(true);
console.log('  note  so the rounding is a TIMING correction, not a coverage one — a hero who ' +
            'sweeps a whole row reaches the same events either way');
/* The fire count is also the live proof that the 1-based selector correction
 * actually reached the trigger chain: it read 82 while the port dispatched on
 * selector 2, and reads ~202 now that it dispatches on selector 3. A constant
 * changed in one module and not honoured downstream would leave it at 82. */
tally(true);
console.log(`  note  ${firedTotal} fires under selector ${(await import('../src/game/events.js')).SELECTOR_TRIGGER}` +
            ` — was 82 when this port wrongly dispatched on selector 2`);
if (!probeOk) bad++;

/* descriptor anchors + hero sprite selection */
const { checkDescriptorAnchors, checkHeroSprites } = await import('../src/verify/checks.js');
console.log('\n  descriptor numbering:');
for (const r of await checkDescriptorAnchors(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}
console.log('\n  hero sprite selection:');
for (const r of await checkHeroSprites(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  death-fade sprite ranges (both entity systems, against the real atlas):');
const { checkDeathFadeSprites } = await import('../src/verify/checks.js');
for (const r of await checkDeathFadeSprites(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  plane-B selectors and object sprites:');
const { checkSelectorsAndObjects } = await import('../src/verify/checks.js');
for (const r of await checkSelectorsAndObjects(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  enemy spawn chain:');
const { checkSpawn } = await import('../src/verify/checks.js');
for (const r of await checkSpawn(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  System-B enemy locomotion:');
const { checkEntityB } = await import('../src/verify/checks.js');
for (const r of checkEntityB()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  System-A enemy locomotion (CS:0xe001, stages 1/2/4/5/6):');
const { checkEntityA } = await import('../src/verify/checks.js');
for (const r of checkEntityA()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  The "attracts monsters" marker list (CS:0x1632-0x1668):');
const { checkMarkers } = await import('../src/verify/checks.js');
for (const r of checkMarkers()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  The world-1 sublevel-B awakened statue (CS:0x7CBD/0x7B68/0x7C4B/0x7C7C):');
const { checkStatue } = await import('../src/verify/checks.js');
for (const r of checkStatue()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  The world-3 DS:0xce64 creature and its "spit" sub-projectile:');
const { checkCe64 } = await import('../src/verify/checks.js');
for (const r of checkCe64()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  The selector-2 stationary shooting turrets (CS:0xAD88/0xAD0D/0xB60E/0xB5E9/0xB670):');
const { checkSelectorTwo } = await import('../src/verify/checks.js');
for (const r of checkSelectorTwo()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  The "falling rock" hazard pools (CS:0xB1C2/0xB3CE/0xB4E7, fed by B144/B2C7 — NOT dead):');
const { checkRockfall } = await import('../src/verify/checks.js');
for (const r of checkRockfall()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  PGOD0x.PAT scripted objects and their shooting (CS:0xB908/0xB987/0xBC4B/0xBDDB):');
const { checkPatObjects } = await import('../src/verify/checks.js');
for (const r of await checkPatObjects(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the status-panel message line (CS:0x434e/0x43b6/0x443e/0x4609/0x63d5):');
const { checkMessages } = await import('../src/verify/checks.js');
for (const r of await checkMessages(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the group-elimination reward popup (CS:0xBF5F/0xBF80):');
const { checkPopup } = await import('../src/verify/checks.js');
for (const r of checkPopup()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  idle+FIRE lever/switch toggle (CS:0x1045/0x115b/0x10dd):');
const { checkLevers } = await import('../src/verify/checks.js');
for (const r of checkLevers()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  selectors 7-10, the line-barrier system (CS:0x75FC/0x77D6/0x7779):');
const { checkLineBarriers } = await import('../src/verify/checks.js');
for (const r of await checkLineBarriers(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the shipped HISCORES.BIN defaults, hardcoded against the corrected 16+4 layout:');
const { checkHiscoresFile } = await import('../src/verify/checks.js');
for (const r of checkHiscoresFile()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  level-editor round trip (map-writer.js / dcl-encode.js vs. all 8 shipped levels):');
const { checkMapWriter } = await import('../src/verify/checks.js');
for (const r of await checkMapWriter(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the retracting spike hazard (CS:0x1B72/0x1AF6, types 50/117/130):');
const { checkSpikes } = await import('../src/verify/checks.js');
for (const r of checkSpikes()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the crouch/inventory panel (CS:0x1e1a/0x1f5a/0x1dd1/0x1e06/0x1ee3):');
const { checkInventoryPanel } = await import('../src/verify/checks.js');
for (const r of checkInventoryPanel()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the status panel health bar (CS:0x0e77/0x0e93):');
const { checkHealthBar } = await import('../src/verify/checks.js');
for (const r of checkHealthBar()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the status panel score/lives/money digits (CS:0x0bbf/0x0ab1/0x0b40):');
const { checkHudDigits } = await import('../src/verify/checks.js');
for (const r of checkHudDigits()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  System-A spawn chain and strategy census:');
const { checkSpawnA } = await import('../src/verify/checks.js');
for (const r of await checkSpawnA(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  weapons, fire slots and projectile spawn:');
const { checkWeaponsProjectiles } = await import('../src/verify/checks.js');
for (const r of await checkWeaponsProjectiles(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the 15 trigger ACTION verbs (SS:0x3592):');
const { checkTriggerActions } = await import('../src/verify/checks.js');
for (const r of await checkTriggerActions(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  zones — the read side of ACT3/ACT4 (CS:0x4A6D, CS:0x0FAC-0x1042):');
const { checkZones } = await import('../src/verify/checks.js');
for (const r of await checkZones(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

/* --- camera: dead zone and clamps, from CS:0x5ea4-0x5f76 ----------------- */
const { Camera, CAM_X_MAX, CAM_Y_MAX } = await import('../src/game/camera.js');
const lvl = { world: 1, sublevel: 0 };
let c = new Camera(0, 0), moved = false;
for (let i = 0; i < 5; i++) { const p = c.x; c.update(150, 60, lvl); if (c.x !== p) moved = true; }
tally(false);
console.log(`  ${!moved ? 'ok  ' : 'FAIL'}  camera holds still inside the dead zone (screenX 150, screenY 60)`);
if (moved) bad++;
c = new Camera(0, 0);
for (let i = 0; i < 2000; i++) c.update(4000, 1000, lvl);
const clampOk = c.x === CAM_X_MAX && c.y === CAM_Y_MAX;
tally(false);
console.log(`  ${clampOk ? 'ok  ' : 'FAIL'}  camera clamps at ${CAM_X_MAX},${CAM_Y_MAX} ` +
            `(+320 = 4096 world px; +160 = 1024, the backdrop region) — got ${c.x},${c.y}`);
if (!clampOk) bad++;

console.log('\n  death: the burst, the lives/respawn fork, and the arrival-'
  + 'tile search (CS:0x09BB/0x0930-0x0943/0x0873-0x08BD):');
const { checkDeath } = await import('../src/verify/checks.js');
for (const r of await checkDeath(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the title screen — menu clamp/dispatch and the password '
  + 'grid (CS:0x2C82-0x2E26/0x2e2f-0x2ea8):');
const { checkTitleMenu } = await import('../src/verify/checks.js');
for (const r of checkTitleMenu()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the inter-level tally/bonus screen and password reveal '
  + '(CS:0x6553/0x69d7):');
const { checkTally } = await import('../src/verify/checks.js');
for (const r of checkTally()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  the shop screen (CS:0x6c19/0x6e62):');
const { checkShop } = await import('../src/verify/checks.js');
for (const r of checkShop()) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

console.log('\n  #11 audio, music half — PGODS.MUS\'s container + SMF blobs:');
const { checkMusic } = await import('../src/verify/checks.js');
for (const r of await checkMusic(fetchRaw)) {
  if (!r.pass && !r.note) bad++;
  console.log(line(r));
}

/* ── THE SINGLE POPUP SLOT'S PRIORITY ORDER ──────────────────────────────
 *
 * Every kill reward contends for ONE slot (DS:0x1a0) and the loser is landed
 * in place rather than tossed (CS:0xBF6B), so the ORDER the channels run in
 * is observable behaviour, not a style choice. The frame loop FUN_1000_006f
 * fixes that order by call-site address:
 *
 *     0x0209 bf80 tick · 0x0223 ad88 selector-2 · 0x0285 ed15 System B
 *     0x028b df39 System A · 0x0294 b987 PAT · 0x029a 7b68 statue
 *
 * main.js once ran this almost exactly BACKWARDS — statue first, tick last —
 * which made every award on a landing frame divert, and let PAT beat both
 * entity systems to the slot. Nothing caught it, because the suite drives
 * modules directly and never executes main.js's tick. This check closes that
 * hole the only way available from outside: by reading main.js's own source
 * and asserting the six channels still appear in the binary's order.
 *
 * ⚠️ ONE KNOWN, DELIBERATE DIVERGENCE, not asserted here. Chasing the xrefs
 * DOES establish "all of System B before all of System A": B's group reward
 * (CS:0xF068) is in FUN_1000_f030, reached from FUN_1000_ff20 at CS:0xED6A,
 * which is inside ed38 — System B's own walker under 0x0285. But this port
 * runs ONE shared contact/damage pass over both entity arrays (main.js's
 * stepCreatureDamage) where the original runs each system's inside its own
 * walker, and both group-reward loops have to sit after it. So the port's
 * order is B-entity, A-entity, damage, B-group, A-group. The group
 * DETECTION is unaffected — a groupsB check reads only groupsB members, and
 * B's own damage lands before it either way — so the sole observable
 * difference is which of {B-group, A-entity} wins the popup slot on a frame
 * where both award. Moving the group loops ahead of the shared damage pass
 * would trade that for a one-frame lag in group elimination, which is
 * worse. The anchors below therefore use each system's ENTITY pass only. */
{
  const mainSrc = readFileSync(join(here, '..', 'src', 'main.js'), 'utf8');
  /* Blank out comment-only lines, preserving every offset (and every
   * newline — `.` does not match one), so both the ordering anchors and the
   * call census below read CODE and never main.js's own prose about it. A
   * comment naming `popup.spawn(` must not be able to fail this check. */
  const code = mainSrc.replace(/^[ \t]*(\/\/|\/?\*).*$/gm, (m) => ' '.repeat(m.length));
  const at = (needle) => {
    const i = code.indexOf(needle);
    if (i < 0) throw new Error(`verify-node: popup-order anchor missing from main.js: ${needle}`);
    return i;
  };
  const chain = [
    ['tick       CS:0x0209', at('popup.step(dropCarriedIntoWorld);')],
    ['selector-2 CS:0x0223', at('for (const r of selectorTwo.rewards) {')],
    ['System B   CS:0x0285', at('stealAttemptB(')],
    ['System A   CS:0x028b', at('const carried = stepCarriedItem(e, e.desc')],
    ['PAT        CS:0x0294', at('for (const d of patGroups.drops) {')],
    ['statue     CS:0x029A', at('for (const p of statueResult.popups)')],
  ];
  const outOfOrder = chain.filter((c, i) => i > 0 && chain[i - 1][1] >= c[1]);
  const popupOrder = [{
    pass: outOfOrder.length === 0,
    name: "the six popup channels run in FUN_1000_006f's own call order",
    detail: outOfOrder.length
      ? `out of order: ${outOfOrder.map((c) => c[0]).join(', ')}`
      : chain.map((c) => c[0].replace(/\s+CS:.*$/, '')).join(' < '),
  }];

  /* The tick frees the slot when an arc ends (CS:0xBFE9/0xC03B). Running it
   * after ANY award means that award never sees the slot it should have.
   *
   * Matched against `code`, not the raw source — see the blanking above. */
  const spawnSites = [...code.matchAll(/popup\.spawn\(/g)].map((m) => m.index);
  popupOrder.push({
    pass: spawnSites.length > 0 && spawnSites.every((i) => i > chain[0][1]),
    name: 'the popup tick precedes every popup.spawn in the tick',
    detail: `${spawnSites.length} spawn sites, earliest at ${Math.min(...spawnSites)}, tick at ${chain[0][1]}`,
  });

  /* CS:0xC041 runs INLINE, by fall-through, from the arc terminator
   * (CS:0xBFE9/0xC03B), the busy-slot divert (CS:0xBF6B) and the 0x3D snap
   * (CS:0xBF59) alike — so a landed reward is a real object for the rest of
   * the frame and later channels can see it. Every call site must therefore
   * hand popup.js the landing callback; deferring to a drain at the bottom
   * of the tick hides a divert from anything that runs in between. */
  const calls = [...code.matchAll(/popup\.(spawn|step)\([^;]*/g)].map((m) => m[0]);
  const unwired = calls.filter((c) => !c.includes('dropCarriedIntoWorld'));
  popupOrder.push({
    /* 9: the guardian death's CS:0xCE78 / 0xD5FC popup joined the eight. */
    pass: calls.length === 9 && unwired.length === 0
          && !/for \(const l of popup\.landed\)/.test(code),
    name: 'every popup call lands CS:0xC041 inline, with no deferred drain',
    detail: unwired.length
      ? `${unwired.length} call(s) without a landing callback`
      : `${calls.length} call sites wired, 0 drains`,
  });

  /* Reordering the frame loop MOVES statements past hundreds of lines, and
   * a move that lands a reference outside its binding's block compiles
   * cleanly and throws only when the tick runs — which neither the bundler
   * nor this suite nor a hidden (rAF-throttled) browser tab ever does. So
   * prove the bindings the reordering actually carried. */
  const { checkScope, checkCallOrder } = await import('./scope-check.mjs');
  popupOrder.push(...await checkScope(join(here, '..', 'src', 'main.js'),
    ['statueResult', 'camNow', 'dropCarriedIntoWorld', 'patGroups', 'selectorTwo',
     'progress']));

  console.log('\n  the single popup slot — who wins it, and when it lands '
    + '(FUN_1000_006f call order):');
  for (const r of popupOrder) {
    if (!r.pass && !r.note) bad++;
    console.log(line(r));
  }

  /* game/frame.js's own LINE_BARRIERS_AT (CS:0x01F2, get_xrefs_to-proven this
   * session): the line-barrier rescan is one of the EARLIEST systems in the
   * real tick, called unconditionally from BOTH FUN_1000_006f and the death
   * driver FUN_1000_09BB — never gated behind the death check. An earlier
   * pass shipped it near the END of main.js's tick instead, grouped with
   * lineHazards.step(), disclosed as merely "not pinned to an exact CS: call
   * site" — this is the check that placement never had, and the one that
   * would have caught it being wrong rather than just unproven. */
  const barrierOrder = await checkCallOrder(join(here, '..', 'src', 'main.js'), {
    calleeSrc: 'lineBarriers.tick', beforeSrc: 'stepHeroFrame',
    notInsideIfTest: '!deathSeq',
  });
  console.log("\n  the line-barrier rescan's own tick position (CS:0x01F2 vs. "
    + '0x09C7, both unconditional):');
  for (const r of barrierOrder) {
    if (!r.pass && !r.note) bad++;
    console.log(line(r));
  }
}

/* The enemy suite's head, CS:0x0279 -> 0x027F -> 0x0282: the DS:0xCF40
 * flier, then the brood, then the nests. [PROVEN] live: running the nests
 * first moved freshly spawned brood a tick early (PJOYL2 1898-1909). */
{
  const { checkCallOrder } = await import('./scope-check.mjs');
  console.log('\n  the enemy suite head order (CS:0x0279 / 0x027F / 0x0282):');
  for (const [a, b] of [['cf40.step', 'brood.step'], ['brood.step', 'nests.step']]) {
    for (const r of await checkCallOrder(join(here, '..', 'src', 'main.js'), { calleeSrc: a, beforeSrc: b })) {
      if (!r.pass && !r.note) bad++;
      console.log(line(r));
    }
  }
}

console.log(`\n${asserts} assertions + ${notes} notes = ${asserts + notes} rows`);
console.log(`${bad ? `FAILURES: ${bad}` : 'ALL CHECKS PASS'}`);
process.exit(bad ? 1 : 0);

