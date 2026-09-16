/* consumables.js — what the other 18 category-0 handlers actually do.
 *
 * The dispatch itself lives in pickup.js: CS:0x1801 counts how many category-0
 * types sit strictly below this one and uses that RANK to index a 23-entry
 * table at DS:0xd8b8. Five ranks were decoded before this pass (the health
 * potions). This module is the rest.
 *
 * ── EVERY ONE IS CONFIRMED BY ITS OWN `POBJECTS` TEXT ─────────────────────
 * That is what makes this checkable rather than plausible. The 48-byte record
 * carries a 16-byte name and a 24-byte description, and the handler and the
 * words agree in every case — most sharply for the three "weapon arc" potions,
 * whose three velocity tables have Y-spreads of exactly 3 / 1 / 10 against
 * names `standard` / `intense` / `wide`.
 *
 * ── ⚠️ SEVEN OF THE 23 TYPES ARE NEVER PLACED ────────────────────────────
 * Measured across all 8 shipped maps: types 39, 40, 41 (the entire familiar
 * chain), 43, 44, 70 and 71. So decoding a handler does NOT mean a player can
 * reach it, and this module ports only what ships — the same call already made
 * for the cut `flame` weapon and the iron chest.
 *
 * ── THE RETURN VALUE IS A MESSAGE TIER, NOT A SUCCESS FLAG ────────────────
 *     182D  or dx,dx / jz 0x183c        ; 0  -> no message at all
 *     1831  dec dx   / jz 0x1839        ; 1  -> show the message
 *     1834  mov byte [0x394],0          ; >=2 -> clear DS:0x394 first
 *     1839  call 0x4609                 ;        then show it
 * Every shipped handler returns 1 except the shop potion, which returns 2.
 * A refusal returns 1 as well, so the caller cannot tell it from a success.
 */

import { setWeaponArc } from './projectiles.js';

/* ── The table, DS:0xd8b8, rank -> effect ─────────────────────────────── */

/** Message tier returned in DX (CS:0x182D). */
export const MSG_NONE = 0, MSG_SHOW = 1, MSG_CLEAR_394 = 2;

/**
 * Every category-0 type, its handler, and what it does.
 *
 * `effect` is the kind this port models; `placed` is the count across all 8
 * shipped maps, so "never reachable" is a number rather than an adjective.
 */
export const CONSUMABLES = Object.freeze([
  { rank:  0, type:  0, at: 0x6327, placed: 15, dx: 1, effect: 'health', health: 0x0c,
    name: 'health', desc: 'restores energy' },
  { rank:  1, type:  2, at: 0x62da, placed:  4, dx: 1, effect: 'weaponPower', steps: 1,
    name: 'power potion', desc: 'increases weapon power' },
  { rank:  2, type:  3, at: 0x62d7, placed:  2, dx: 1, effect: 'weaponPower', steps: 2,
    name: 'power potion', desc: 'increases weapon power' },
  { rank:  3, type: 35, at: 0x6350, placed: 18, dx: 1, effect: 'health', health: 0x18,
    name: 'health', desc: 'restores energy' },
  { rank:  4, type: 36, at: 0x61f7, placed:  5, dx: 1, effect: 'starburst',
    name: 'starburst', desc: '' },
  { rank:  5, type: 37, at: 0x62bf, placed:  3, dx: 1, effect: 'noop34c',
    name: 'shield', desc: 'reduces damage' },
  { rank:  6, type: 38, at: 0x62c8, placed:  5, dx: 1, effect: 'invulnerable',
    name: 'shield', desc: 'invulnerabilty' },
  { rank:  7, type: 39, at: 0x61cf, placed:  0, dx: 1, effect: 'familiar',
    name: 'familiar', desc: '' },
  { rank:  8, type: 40, at: 0x61d6, placed:  0, dx: 1, effect: 'familiarWings',
    name: 'magic wings', desc: 'effects familiar' },
  { rank:  9, type: 41, at: 0x61df, placed:  0, dx: 1, effect: 'familiarClaws',
    name: 'power claws', desc: 'effects familiar' },
  { rank: 10, type: 42, at: 0x62ec, placed: 10, dx: 1, effect: 'extraLife',
    name: 'extra life', desc: '' },
  { rank: 11, type: 43, at: 0x5e9b, placed:  0, dx: null, effect: 'unimplemented',
    name: 'magic potion', desc: 'slows monsters' },
  { rank: 12, type: 44, at: 0x620d, placed:  0, dx: 1, effect: 'freeze',
    name: 'magic potion', desc: 'freezes aliens' },
  { rank: 13, type: 47, at: 0x62b5, placed:  3, dx: 1, effect: 'giantJump',
    name: 'magic potion', desc: 'giant jump' },
  { rank: 14, type: 51, at: 0x95b5, placed: 10, dx: 1, effect: 'weaponArc', arc: 0,
    name: 'weapon arc', desc: 'standard' },
  { rank: 15, type: 52, at: 0x62a1, placed:  5, dx: 1, effect: 'weaponArc', arc: 1,
    name: 'weapon arc', desc: 'intense' },
  { rank: 16, type: 53, at: 0x62ab, placed:  4, dx: 1, effect: 'weaponArc', arc: 2,
    name: 'weapon arc', desc: 'wide' },
  { rank: 17, type: 54, at: 0x6217, placed: 14, dx: 1, effect: 'teleport',
    name: 'teleport stone', desc: '' },
  /* ⚠️ `dx: 0`, CORRECTED. This row read `dx: 1` ("show the generic message")
   * for as long as it existed, and that is refuted on bytes: CS:0x646C is
   * `sub dx,dx / ret`. Tier 0 is load-bearing — it is what stops the player
   * seeing "tablet / reveals clues" on top of the hint the handler just
   * submitted itself. See game/message-compose.js's `composeHint`. */
  { rank: 18, type: 69, at: 0x63d5, placed: 46, dx: 0, effect: 'hint',
    name: 'tablet', desc: 'reveals clues' },
  { rank: 19, type: 70, at: 0x6306, placed:  0, dx: 1, effect: 'health', health: 0x02,
    name: 'food', desc: 'restores energy' },
  { rank: 20, type: 71, at: 0x6393, placed:  0, dx: 1, effect: 'health', health: 0x04,
    name: 'food', desc: 'restores energy' },
  { rank: 21, type: 72, at: 0x63b4, placed:  4, dx: 1, effect: 'health', health: 0x03,
    name: 'food', desc: 'restores energy' },
  { rank: 22, type: 83, at: 0x61e9, placed:  8, dx: 2, effect: 'shop',
    name: 'shop potion', desc: 'summons the shopkeeper' },
]);

/** Effects this port applies. The rest are decoded but deliberately not wired
 *  — see the per-effect notes below for why each. */
export const WIRED = Object.freeze([
  'health', 'weaponPower', 'invulnerable', 'extraLife', 'freeze', 'giantJump',
  'weaponArc', 'shop', 'noop34c', 'starburst',
]);

/* ── The three "weapon arc" potions, CS:0x95B5 / 0x62A1 / 0x62AB ──────────
 *
 * All three call the SAME copier, CS:0x95BC — `di = 0xdf0e / mov cx,0xc /
 * ss lodsw / stosw` — twelve words from an SS table into the six-entry
 * projectile velocity table this project already documented at DS:0xdf0e.
 * They differ only in the source:
 *
 *     standard  SS:0x3612    intense  SS:0x362a    wide  SS:0x3642
 *
 * 0x3612 + 0x18 = 0x362a + 0x18 = 0x3642 — three adjacent 24-byte tables.
 *
 * ⚠️ CS:0x95B5 is `mov si,0x3612 / call 0x95bc / ret`. An earlier pass read
 * rank 14 as "pointing into the middle of the velocity-table copy" and
 * flagged it suspicious; it is simply that routine's default-argument entry
 * point, and rank 14 is the potion that puts the STANDARD arc back.
 *
 * The tables, read out of GAME.EXE at SS + 0x1F560, land exactly on the
 * names — which is the confirmation that matters here, because nothing about
 * the addresses themselves says which is which:
 */
export const WEAPON_ARCS = Object.freeze([
  { name: 'standard', ss: 0x3612,   // dY +/-3 — the table the game boots with
    dirs: [[12, -3], [12, 0], [12, 3], [-12, -3], [-12, 0], [-12, 3]] },
  { name: 'intense',  ss: 0x362a,   // dY +/-1 — a TIGHT bundle
    dirs: [[12, -1], [12, 0], [12, 1], [-12, -1], [-12, 0], [-12, 1]] },
  { name: 'wide',     ss: 0x3642,   // dY +/-10, and slower in X — a broad fan
    dirs: [[10, -10], [10, 0], [10, 10], [-10, -10], [-10, 0], [-10, 10]] },
]);

/* ── Invulnerability, CS:0x62C8 -> CS:0xA90B ──────────────────────────────
 *     A90B  mov word [0x19c],0xff       ; the TIMER
 *     A915  di = 0x1d8 ; stosw 0,0x10,0x20,0x30   ; four aura phase offsets
 *     A924  mov word [0x1e0],0x0
 *     A92A  mov word [0x172],0x1        ; the flag the damage gate reads
 * ticked down at CS:0xA99B (`dec word [0x19c]`) from the per-frame call at
 * CS:0x026F, clearing DS:0x172 at zero (CS:0xA9A2).
 *
 * ⚠️ THE SAME HELPER SERVES SPAWN PROTECTION, AND THE DURATIONS DIFFER.
 * CS:0x085D — inside the level-start / respawn block that also sets health
 * target 24 and bar 1 — calls CS:0xA90B and then immediately does
 *     0860  sub word [0x19c],0xaa
 * So a spawn gets 255 - 170 = 85 frames and the POTION gets the full 255.
 * At the proven 15 Hz that is 5.7 s against 17 s. Finding the `sub` and not
 * chasing it would have put a confidently wrong 17 s on spawn protection.
 *
 * ⚠️ And invulnerability is not purely defensive: CS:0xACCC's `jnz` skips only
 * the health subtraction, so while DS:0x172 is set the hero takes no damage
 * AND STILL KILLS EVERYTHING HE TOUCHES. That is this project's own earlier
 * finding; it is what these 17 seconds actually buy.
 */
export const INVULN_TICKS_POTION = 0xff;          // CS:0xA90B
export const INVULN_SPAWN_DEDUCTION = 0xaa;       // CS:0x0860
export const INVULN_TICKS_SPAWN =
  INVULN_TICKS_POTION - INVULN_SPAWN_DEDUCTION;   // 85
export const AURA_PHASES = Object.freeze([0x00, 0x10, 0x20, 0x30]);  // CS:0xA91B

/* ── Freeze, CS:0x620D ────────────────────────────────────────────────────
 *     620D  mov word [0x2fa],0xaa
 * decremented once per frame at CS:0x0186 and floored at CS:0x018C. DS:0x2fa
 * is read by EIGHTEEN sites, including CS:0xEDB8 — the System-B entity
 * driver's gate this project already documented as skipping the movement-mode
 * handler — and CS:0xAD8D / CS:0xAE53 in System A. So it stops BOTH entity
 * systems for 170 frames = 11.3 s. "freezes aliens", exactly.
 *
 * NEVER PLACED in any shipped map. */
export const FREEZE_TICKS = 0xaa;

/* ── Giant jump, CS:0x62B5 ────────────────────────────────────────────────
 *     62B5  mov word [0x174],0x154
 * DS:0x174 is the word this project documented on the jump path: CS:0x4F6F
 * walks the 23-entry arc table subtracting each delta from Y *twice* while it
 * is set. 340 frames = 22.7 s of double-height jumps. */
export const GIANT_JUMP_TICKS = 0x154;

/* ── Extra life, CS:0x62EC ────────────────────────────────────────────────
 *     62EC  sfx 0x6416 ; inc word [0x224] ; [0x6c] = [0x6d] = 0xff
 * DS:0x224 is the lives counter this project already identified from the
 * trigger predicates COND15/COND16. The two 0xFF bytes mark the display
 * dirty, the same idiom the BCD score uses at CS:0x19AF. */
export const LIVES_DS = 0x224;

/* ── The power potion, CS:0x62DA (and CS:0x62D7) ──────────────────────────
 *     62D7  call 0x9426          ; type 3 enters HERE and so calls it TWICE
 *     62DA  call 0x9426
 *     62DD  call 0x94f5
 *     62E0  sfx 0xa3e
 * CS:0x9426 walks the three weapon slots and does `inc word [si+0x8]` on each
 * live one, with si = 0xe2b6 + weapon*0x50. That is the PICKUP COUNT — so a
 * power potion buys, on every weapon at once, exactly what collecting a
 * duplicate buys: a bigger volley, +1 damage per hit, and (for the hunter) a
 * faster turn. Type 3 applies it twice and costs 12000 against type 2's 6000.
 *
 * CS:0x94F5 then recomputes a display figure into DS:0x1ba by summing
 * `Power` once per extra pickup up to three, plus the remainder.
 */
export const POWER_POTION_STEPS = Object.freeze({ 2: 1, 3: 2 });

/* ── ⚠️ "shield / reduces damage" (type 37) IS A SHIPPED NO-OP ────────────
 *
 *     62BF  mov byte [0x34c],0x1
 *
 * and NOTHING READS DS:0x34c. This is asserted to the standard this project
 * demanded of the `.DAT` word2 finding, not the weaker base-address standard:
 *
 *   - the two-byte immediate `4C 03` occurs FOUR times across all twelve
 *     shipped binaries, and every one is `C6 06 4C 03 imm` — `mov byte
 *     [0x34c],imm`. Writes at CS:0x62BF and CS:0xC57B (set 1), CS:0x656E and
 *     CS:0x8E11 (clear). No read encoding, in any binary.
 *   - a WORD access based one byte low would read 0x34c as its high half and
 *     encode `4B 03`. That pair occurs four times too, and all four are again
 *     `C6 06 4B 03 imm` — byte writes to the neighbouring variable 0x34b.
 *     (The one hit outside GAME.EXE is instruction bytes in UNPACK.EXE, not
 *     an address.) So neither alignment yields a reader.
 *
 * The remaining escape is an address computed into a register rather than
 * encoded — the blind spot this project flags for SS/DS-relative addressing
 * generally. Short of that, the item is inert: **three "shield" potions ship
 * across the eight maps and none of them reduces any damage.**
 */
export const SHIELD_NOOP_DS = 0x34c;
export const SHIELD_NOOP_SITES = Object.freeze([0x62bf, 0xc57b, 0x656e, 0x8e11]);

/* ── ⚠️ "slows monsters" (type 43) HAS NO HANDLER ─────────────────────────
 *
 * Rank 11's table word is 0x5e9b, which is the PLAYER STATE MACHINE'S
 * EPILOGUE (`mov [0x36b],cl`, then the event probe, the camera update, sprite
 * selection and the hero draw). Calling it from the object walk would run a
 * whole spurious player epilogue and return.
 *
 * Two facts make "cut item" the reading rather than "undecoded effect":
 *   - type 43 is placed in ZERO shipped maps;
 *   - the epilogue never sets DX, and CS:0x182D reads DX to decide the
 *     message tier — so even the message behaviour is undefined. An
 *     implemented handler sets DX; all 22 others do.
 * This port records it and refuses to invent a value for DX.
 */
export const UNIMPLEMENTED_TYPE = 43;

/* ── Decoded, deliberately NOT wired ──────────────────────────────────────
 *
 * STARBURST (type 36, CS:0x61F7 -> CS:0xA461) spawns into an 80-slot 6-byte
 * array at DS:0x8cfa from a template at DS:0xdd00, at (heroX+8, heroY+0x20),
 * gated on DS:0x34d and `[0x1d6] < 0xbe`. A whole particle subsystem; five
 * ship, but wiring it means porting that subsystem.
 *
 * THE FAMILIAR (types 39/40/41, CS:0xC2F6) — NONE OF THE THREE IS EVER
 * PLACED, so this is the iron-chest call with more surface area:
 *     C2F6  cmp word [0x168],0 / jns  ; already have one -> +1000 energy,
 *     C2FD    add word [0x168],0x3e8  ;    and +1 power
 *     C303    inc word [0x210]
 *     C308  else SUMMON: position = hero - 160 in Y, sprite [0x30c] = 0x185,
 *           [0x168] = 1000, [0x210] = 4, [0x304] = 0, [0x343] = 0
 * with `magic wings` doing `inc [0x304]` first and `power claws` `[0x210] +=
 * 2`. CS:0xC440 dismisses it (`[0x168] = -1`, `[0x33d] = 0xff`, sprite -1) and
 * is called from CS:0x047D and CS:0x8DDF — the two FULL RESTARTS — and from
 * CS:0xAB53, right after the familiar takes damage at CS:0xAB4D.
 *
 * TELEPORT STONE (type 54, CS:0x6217) is decoded and PROVEN, just not
 * actionable in a port with no level transitions. It sets three variables:
 *     [0x370] = 1     "a teleport is pending"   (consumed at CS:0x0324)
 *     [0x3a8] = 1     the kind
 *     [0x22e] = the destination, packed (col << 8) | row
 * and CS:0x0FDF unpacks exactly that — `bl = al` (row), `al = ah`, `shl ax,5`
 * (col * 32). The destination comes from the 30-record {key, x, y} table at
 * DS:0xa778 — the PALFILS +0x1770 window this project had recorded only as
 * "a lookup at 0x6241" — searched by a key read through DS:0x20a, with
 * world 2 sublevel 'a' and hero x in [0x5c0,0x640] hard-coded to 0x202e.
 * ⚠️ The SAME three variables are written by the ACT3 trigger at CS:0x4AA5,
 * which is what confirms the meaning: the stone and the teleport zone are one
 * mechanism reached two ways.
 *
 * THE TABLET (type 69, CS:0x63D5) is the hint system this project already
 * decoded from the other end — the exact-equality scan over the 40 PALFILS
 * hint keys. Nothing new here.
 */
export const NOT_WIRED_REASON = Object.freeze({
  /* ⚠️ CORRECTED: these three are placed as MAP pickups zero times, but that
   * is not the same as unreachable. Type 39 is itself purchasable in the
   * shop's own world-3/4 roster (Gods/docs/shop.md, UNKNOWN_shop_
   * eligibility_gates — CLOSED) — buying it is the shipped, designed path
   * to a live familiar, which in turn is what gate 2 checks to allow
   * 40/41's own purchase. None of the three has an applyConsumable effect
   * wired here yet (this port has no familiar entity at all), which is the
   * real reason they're unimplemented — not that they're unreachable. */
  familiar:      'no familiar entity in this port; reachable via a world 3/4 shop purchase',
  familiarWings: 'no familiar entity in this port; reachable via a world 3/4 shop purchase',
  familiarClaws: 'no familiar entity in this port; reachable via a world 3/4 shop purchase',
  teleport:      'decoded and proven; needs level transitions the port lacks',
  /* ⚠️ THIS ENTRY USED TO READ "already ported as the PALFILS hint system",
   * and that was FALSE — the hint TABLE had been decoded (docs/asset-formats
   * .md's 40 keys / 40 strings), but nothing in this port ever rendered it, so
   * walking over the first tablet in PLEV1A produced no text at all. The hint
   * is now genuinely wired: game/text-arena.js resolves the key, game/message-
   * compose.js composes `<> Hint <> ...`, game/message.js paginates and draws
   * it. It is not listed in WIRED because its effect is not an `applyConsum-
   * able` state change — CS:0x63D5 submits a message and returns tier 0. */
  hint:          'handled by CS:0x63D5 itself, not by applyConsumable — it '
               + 'submits the PALFILS hint message and returns tier 0',
  unimplemented: 'type 43 has no handler and is never placed',
});

/* ── UNKNOWN_DS_0168 — CLOSED: it is the FAMILIAR'S ENERGY ────────────────
 *
 * This project listed DS:0x168 with four behaviours and no meaning. All four
 * are the familiar:
 *     set to 1000   CS:0xC347   summoning one
 *     += 1000       CS:0xC2FD   a second "familiar" potion
 *     -= bp         CS:0xAB4D   it takes a hit
 *     set to -1     CS:0xC470   it dies or is dismissed
 * and the reader that looked unrelated fits too: CS:0x9129 builds the hunter's
 * target list when `[0x168] >= 0` OR a hunter is held, because a live familiar
 * needs targets for the same reason the hunter does.
 *
 * ⚠️ CORRECTED — this is reachable, not dead. Over-healing at CS:0x6377
 * banks the excess at 32 a point into DS:0x168 — CS:0x6384 is
 * `cmp word [0x168],0 / JNS`, so it only banks while the familiar is ALIVE.
 * CS:0xC470 sets -1 and is called from both full restarts, and the only
 * thing that lifts it is a familiar potion (type 39) — an earlier revision
 * of this note said "which no map places" and stopped there, missing that
 * `39` is itself purchasable in world 3/4's own shop (Gods/docs/shop.md's
 * UNKNOWN_shop_eligibility_gates, CLOSED). So the banking is real code that
 * a player who buys the familiar there CAN reach — it just needs the
 * familiar-summon effect to actually be wired (see NOT_WIRED_REASON above)
 * before this port's own over-heal path can exercise it.
 */
export const FAMILIAR_ENERGY_DS = 0x168;
export const FAMILIAR_START_ENERGY = 0x3e8;       // CS:0xC347
export const FAMILIAR_DEAD = -1;                  // CS:0xC470
export const FAMILIAR_CLEAR_SITES = Object.freeze([0x047d, 0x8ddf]);

/** True when over-healing is banked rather than discarded — CS:0x6384 `jns`.
 *  False in this port today because summoning a familiar (buying type 39 in
 *  the world 3/4 shop) isn't wired to set `familiarEnergy` yet — see
 *  NOT_WIRED_REASON.familiar — not because no shipped path can reach it. */
export const banksOverheal = (familiarEnergy) => familiarEnergy >= 0;

/* ── Applying an effect ───────────────────────────────────────────────────
 * `state` carries only what the wired effects touch, so a caller that does not
 * model a field simply does not get that effect.
 */
export function applyConsumable(entry, state) {
  switch (entry.effect) {
    case 'health':
      return state.health ? state.health.potion(entry.health) : null;
    case 'weaponPower':                              // CS:0x9426, once or twice
      if (!state.arsenal) return null;
      for (let i = 0; i < entry.steps; i++) {
        for (const s of state.arsenal.slots) if (s.weapon >= 0) s.st.count += 1;
      }
      return { steps: entry.steps };
    case 'invulnerable':                             // CS:0xA90B
      state.invuln = INVULN_TICKS_POTION;
      return { ticks: INVULN_TICKS_POTION };
    case 'extraLife':                                // CS:0x62EC
      state.lives = (state.lives ?? 0) + 1;
      return { lives: state.lives };
    case 'freeze':                                   // CS:0x620D
      state.freeze = FREEZE_TICKS;
      return { ticks: FREEZE_TICKS };
    case 'giantJump':                                // CS:0x62B5
      state.giantJump = GIANT_JUMP_TICKS;
      return { ticks: GIANT_JUMP_TICKS };
    case 'weaponArc':                                // CS:0x95BC
      state.arc = entry.arc;
      setWeaponArc(WEAPON_ARCS[entry.arc].dirs);     // overwrite DS:0xdf0e
      return { arc: WEAPON_ARCS[entry.arc].name };
    case 'shop':                                     // CS:0x61E9
      state.shop = true;
      state.stateMachineSuspended = true;            // [0x363] = 0x41, a POSITIVE
      return { dx: MSG_CLEAR_394 };
    case 'starburst':                                // CS:0x61F7 -> CS:0xA461
      /* The potion bursts at the hero's CENTRE, not his anchor. */
      if (!state.starburst || !state.hero) return null;
      return { placed: state.starburst.spawn(state.hero.x + 8,
                                             state.hero.y + 0x20) };
    case 'noop34c':                                  // CS:0x62BF — writes only
      state.shieldFlagWritten = true;
      return { noop: true };
    default:
      return null;                                   // decoded, not wired
  }
}
