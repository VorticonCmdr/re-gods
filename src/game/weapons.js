/* weapons.js — PWEAPONS.00x, and the hero's fire-slot allocation.
 *
 * 11 fixed 80-byte (0x50) records. The stride is closed two independent ways:
 * weapon-name text lands at a clean 0x50 boundary in the decompressed buffer,
 * and GAME.EXE's load-time init (CS:0x366d) byte-swaps exactly the first 32
 * bytes of each of 11 records at stride 0x50 over a table based at DS:0xE2B6.
 *
 * ⚠️ FIELDS BELOW 0x20 ARE BYTE-SWAPPED AT LOAD, fields above are not. So
 * `power` (+0x06) and `maxShots` (+0x0a) are native after the swap, while
 * `value` (+0x4a) is swapped only at display time. Reading the file's
 * big-endian words directly gives the post-swap value for the low fields,
 * which is what this module does.
 */

export const WEAPON_STRIDE = 0x50;
export const WEAPON_COUNT = 11;
export const WEAPON_TABLE_DS = 0xe2b6;      // the runtime table CS:0x95ca indexes

/** Each 80-byte record embeds its own null-terminated name at `+0x20` —
 *  confirmed by decompressing all four shipped `PWEAPONS.00{1-4}` with
 *  `blast.py` and reading the bytes directly (`"knife\0"`, `"time bomb\0"`,
 *  ...), byte-identical across every world. `CS:0x703A` reads this exact
 *  field to build the shop's own "Warning.. this weapon replaces the X"
 *  message (`Gods/docs/shop.md`'s `UNKNOWN_shop_tradein_value`, CLOSED) —
 *  the same "small record with an embedded name" idiom this project already
 *  knows from `POBJECTS`. Hardcoded here rather than parsed at runtime,
 *  matching `consumables.js`'s own `CONSUMABLES` table: the text is fixed
 *  and world-invariant, so parsing it from the buffer on every load would
 *  just re-derive a constant. */
export const WEAPON_NAMES = Object.freeze([
  'knife', 'time bomb', 'fireball', 'flame', 'lightning bolt',
  'throwing star', 'spear', 'axe', 'hunter', 'magic axe', 'mace',
]);

/* ── THREE fields are pinned at the EXE-image value, not read from the file ──
 *
 * The load path is CS:0x35e9 (sublevel 'a' only, `cmp byte [0x43],0 / jnz`),
 * and it brackets the file load with TWO INDEPENDENT save/restore mechanisms:
 *
 *   +0x0c and +0x1e   CS:0x35b7 copies both out of all 11 records into a
 *                     scratch at DS:0x2f76; CS:0x35d0, called at the very end
 *                     of the loader, copies them back.
 *
 *   +0x08             CS:0x367a..0x3682 pushes it from all 11 records, calls
 *                     the file loader, then pops and stores it back with a
 *                     compensating `xchg al,ah` (CS:0x368f) so the later
 *                     32-byte byte-swap pass returns it to its native value.
 *
 * So each PWEAPONS file's own copies of these three are DISCARDED. The values
 * below are read straight out of GAME.EXE at DS:0xe2b6 + n*0x50.
 *
 * ⚠️ This bit the port once already. +0x08 feeds the projectile volley-size
 * branch, and 7 of the 44 shipped file records disagree with the image — all
 * of them in PWEAPONS.003/.004, the same authoring drift this project has
 * recorded for the sprite fields. Reading +0x08 from the file makes four
 * world-4 weapons fire the wrong number of projectiles and invents a
 * two-projectile volley that no shipped weapon ever fires.
 *
 * Corroboration that these are the right bytes: PINNED_SPRITE lands in
 * 331..437, inside the POBJ2 descriptor range (#331..#449), and
 * PINNED_SPRITE2 is zero for every weapon except the two that visibly have a
 * second sprite — lightning bolt and spear. */
export const PINNED_08      = [1, 5, 3, 4, 8, 1, 6, 4, 5, 3, 3];
export const PINNED_SPRITE  = [331, 339, 343, 347, 363, 369, 373, 377, 385, 426, 437];
export const PINNED_SPRITE2 = [0, 0, 0, 0, 366, 0, 375, 0, 0, 0, 0];

/** Parse a decompressed PWEAPONS.00x. */
export function parseWeapons(buf) {
  const be = (o) => (buf[o] << 8) | buf[o + 1];
  const out = [];
  for (let i = 0; i < WEAPON_COUNT; i++) {
    const o = i * WEAPON_STRIDE;
    out.push({
      index: i,
      /* +0x00 — the SLOT-A eligibility flag, and it is genuine file data.
       * CS:0x9554 `cmp word [di],0x0 / jz 0x95A2` sends a weapon whose +0x00
       * is zero straight to slot A; everything else competes for B and C.
       * Not one of the pinned fields: the loader's save/restore pairs read
       * displacement 0x0c/0x1e (CS:0x35b7, CS:0x35d0) and 0x08 (CS:0x367a),
       * never 0. Measured 0 for knife/throwing star/spear/axe/mace and 1 for
       * the other six, identical in worlds 1 and 4. */
      slotAClass: be(o + 0x00),
      power: be(o + 0x06),          // the shop's "Power" stat
      /* +0x08 — PINNED, see PINNED_08 above. The file's own value is loaded
       * and then overwritten before anything reads it, so this is kept only
       * to make the discrepancy checkable; `unknown08` is what the game uses.
       * The field feeds the spawn handlers' `[si+8] - [si+6] + 1`, which is
       * NOT a count — see volleySize() in projectiles.js. Its own meaning
       * remains UNKNOWN_weapon_08. */
      file08: be(o + 0x08),
      unknown08: PINNED_08[i],
      /* +0x0a — the maximum number of this weapon's projectiles that may be
       * live at once. CS:0x9609 `mov bx,[bx+si+0xa]` loads it and the fire
       * routine then tries at most that many projectile sub-slots. Every
       * shipped record holds 1 or 3, which is exactly what a 3-iteration
       * unrolled loop can consume — see MAX_SUBSLOTS below. */
      maxShots: be(o + 0x0a),
      /* Both PINNED — the file's copies are restored away by CS:0x35d0. */
      sprite: PINNED_SPRITE[i],     // sprite descriptor index (+0x0c)
      sprite2: PINNED_SPRITE2[i],   // second descriptor (+0x1e), picked by facing
      fileSprite: be(o + 0x0c),
      fileSprite2: be(o + 0x1e),
      /* +0x48 reads 0x00 or 0xFF as a BYTE — the "projectile breaks solid
       * terrain" flag, i.e. the famous "maces break blocks". +0x49 is a
       * second, separate byte flag. Reading them as one big-endian word
       * conflates two fields.
       *
       * +0x49 — CS:0x937C `cmp byte ptr [di+0x49],0x0` inside FUN_1000_9320
       * (the shared grid-tag decoder, collision.js's damageForTag / this
       * port's main.js decodeTag). On ANY ordinary weapon-tag hit — not the
       * FF/FE/FD/FC special sources — CS:0x9382 `mov word ptr [si+0x2],0x0`
       * zeroes THAT PROJECTILE RECORD'S OWN TAG when this byte is nonzero,
       * unconditionally, regardless of the damage dealt or whether the
       * target dies. Same despawn shape as CS:0x9d91/0xA85B. Read directly
       * off all four shipped PWEAPONS files, byte-identical across worlds:
       * SET (0xFF) for knife, fireball, flame, hunter, magic axe; CLEAR
       * (0x00) for time bomb, lightning bolt, throwing star, spear, axe,
       * mace. So the knife is single-hit / non-piercing in the shipped
       * game — consumed by the first creature it damages, kill or not —
       * while the other six weapons already correctly persist through a
       * hit. This corrects combat-and-projectiles.md's UNKNOWN_tag_fd
       * closure, which said the record's tag byte "has exactly one [other]
       * writer" (CS:0x9d91/0xA85B) — CS:0x9382 is a third, missed because
       * that pass stopped reading FUN_1000_9320 at CS:0x9361. */
      breaksTerrain: buf[o + 0x48] !== 0,
      consumedOnHit: buf[o + 0x49] !== 0,
      value: be(o + 0x4a),          // the shop's "Value" stat — also its PRICE, see WEAPON_NAMES above
      name: WEAPON_NAMES[i],
      /* Projectile-behaviour handler indices into DS:0xd88c, one per facing.
       * The emitters read them as BYTES from the post-swap record — `mov
       * cl,[si+0x16]` (right, CS:0x987f) and `mov cl,[si+0x12]` (left,
       * CS:0x98b5). Because the load-time pass byte-swaps the first 32 bytes
       * as words, the native byte at 0x16 is the FILE byte at 0x17, and 0x12
       * is file 0x13. Reading the file byte at 0x12/0x16 instead picks up the
       * high half of the word and yields 0 for every weapon. */
      handlerLeft: buf[o + 0x13],
      handlerRight: buf[o + 0x17],
      /* +0x1A — the MOVER index, into the 6-entry table at DS:0xd8ac.
       * CS:0x9497 `mov al,[si+0x1a] / shl al,1` then jumps through it. Native
       * byte 0x1a is file byte 0x1b (the load-time word swap). Across all 44
       * shipped records this is exactly 0..5 and constant per weapon, which
       * is precisely the table's width. */
      mover: buf[o + 0x1b],
      /* +0x02 — a DRAW-STYLE index into a second table at DS:0xdf26
       * (CS:0x9cf1 `mov cx,[si+0x2] / shl cx,1 / jmp`). Also runtime state:
       * the pickup path zeroes it when it reads 3 (CS:0x9118).
       * UNKNOWN_weapon_02 — the draw table itself is not decoded. */
      drawStyle: be(o + 0x02),
      /* +0x04 is the weapon's CURRENT animation frame and +0x1c its frame
       * count: the mover's tail (CS:0x9d74) steps +0x04 up or down according
       * to +0x0e (facing) and wraps against +0x1c. +0x04 is reset to 0 on
       * pickup (CS:0x910d), so it is runtime state, not file data — but it
       * is NOT one of the three pinned fields either, so a sublevel-'a' load
       * overwrites it fresh from the newly loaded file (CS:0x366d loads the
       * whole 0x50-byte record, and only +0x0c/+0x1e/+0x08 are saved and
       * restored around that). This is what the file's own +0x04 bytes are:
       * essentially arbitrary per world (measured 0..7 across all 44 shipped
       * records), because nothing meaningful is ever encoded there — it is
       * simply whatever frame the animation happened to be on when the
       * record was last saved from within the level tool. `armWeapon`
       * mutates this field on the SAME shared record CS:0x9d74 reads from
       * (see stepMoverFrame in projectiles.js), matching the original's
       * single DS:0xe2b6 table rather than this port's separate per-slot
       * `count`/`base` runtime state. */
      frame: be(o + 0x04),
      frameCount: be(o + 0x1c),
      /* +0x0e is the facing the emitter writes back (1 right, 0xFFFF left),
       * which is what selects between the +0x0c and +0x1e sprite descriptors.
       * The file's value is just the initial state. */
      facing: be(o + 0x0e) === 0xffff ? -1 : 1,
    });
  }
  return out;
}

/* PWEAPONS.004's sprite fields are shifted +5, the same authoring drift already
 * recorded for POBJECTS.004 — and, as there, it never takes effect, because
 * the loader pins +0x0c and +0x1e at the EXE-image values.
 *
 * That hazard no longer exists in THIS code: `sprite`/`sprite2` are served from
 * PINNED_SPRITE/PINNED_SPRITE2 above. It applies to `fileSprite`/`fileSprite2`,
 * which are retained only so the divergence stays checkable — using either of
 * those to draw with puts every world-4 weapon 5 sprites off.
 *
 * `power`, `maxShots` and `value` are NOT pinned and do differ per world; the
 * axe's projectile count changing between worlds 2 and 3 rides entirely on
 * Power. Power is assumed static WITHIN a level — the per-world variation in
 * the PWEAPONS files is itself the progression mechanism, so a runtime writer
 * would be redundant. Not exhaustively proven; flagged rather than dug at. */
export const SPRITE_FIELDS_ARE_PINNED = true;

/* ── Fire-slot allocation, CS:0x95ca ─────────────────────────────────────
 *
 * The hero carries THREE weapon slots. Each holds a weapon index, or a
 * negative value when empty:
 *
 *     slot A   DS:0xdd10, projectiles from DS:0xdd12, tag base 1
 *     slot B   DS:0xdda2, projectiles from DS:0xdda4
 *     slot C   DS:0xde34, projectiles from DS:0xde36, tag base 0x13
 *
 * Those three words are the same three the trigger predicates COND3/COND4
 * test (CS:0x3ea8/0x3ec1), which is an independent confirmation that they are
 * the weapon inventory rather than three unrelated globals.
 *
 * For each slot the routine computes the weapon record with an explicit
 * `idx*16 + idx*64` — i.e. stride 0x50 — reads maxShots from +0x0a, and then
 * walks up to THREE projectile sub-slots at stride 0x18, stopping after
 * maxShots attempts:
 *
 *     95ed  cmp word [di-2],0 / js            ; empty slot -> skip
 *     95f6  bx <<= 4 ; bp = bx ; bx <<= 2 ; bx += bp     ; idx * 0x50
 *     9609  bx = [bx+si+0xa]                  ; maxShots
 *     960e  call 0x9724 / jz found            ; is this sub-slot free?
 *     9613  dec bx / jz none                  ; out of allowed shots
 *     9616  add di,0x18 / add dx,3            ; next sub-slot
 *
 * A sub-slot is free when THREE of its words are all zero (CS:0x9724:
 * `[di]`, `[di+8]`, `[di+0x10]`) — the same `x|y`-style emptiness idiom this
 * codebase uses for the open list and the ledge records, not three separate
 * sub-projectiles. UNKNOWN_projectile_record: what those three fields hold is
 * not established, so this module allocates slots but does not populate them.
 */
export const MAX_SUBSLOTS = 3;              // the unrolled loop's length
export const PROJECTILE_STRIDE = 0x18;      // CS:0x9616 `add di,0x18`
export const SLOT_TAG_STEP = 3;             // CS:0x9619 `add dx,3`

/** The three weapon slots, with the tag base each one's sub-slots count from.
 *
 * ⚠️ Slot B's base is 10 (CS:0x9674 `mov dx,0xa`), not absent — an earlier
 * revision of this file had it as null. All three come straight out of the
 * bytes: A from `mov cx,1 / mov dx,cx` (CS:0x95e8), B from `mov dx,0xa`, C
 * from `mov dx,0x13` (CS:0x96df). With the shared `add dx,3` per sub-slot the
 * whole tag space is regular:  tag = 1 + slot*9 + subslot*3,  i.e. 1/4/7,
 * 10/13/16, 19/22/25. A tag is therefore never 0, which is what lets the
 * tag word double as the projectile record's free flag. */
export const WEAPON_SLOTS = [
  { name: 'A', weaponAt: 0xdd10, projectilesAt: 0xdd12, tagBase: 0x01 },
  { name: 'B', weaponAt: 0xdda2, projectilesAt: 0xdda4, tagBase: 0x0a },
  { name: 'C', weaponAt: 0xde34, projectilesAt: 0xde36, tagBase: 0x13 },
];

/** tag = 1 + slot*9 + subslot*3 — the closed form of the three bases above. */
export const tagFor = (slot, subslot) => 1 + slot * 9 + subslot * SLOT_TAG_STEP;

/* ── UNKNOWN_weapon_08 — CLOSED: it is the weapon's pickup COUNT ──────────
 *
 * +0x08 is not a stat. It is mutable state, and it has exactly three writers
 * in the whole image, all reachable only from the pickup path CS:0x94a7:
 *
 *   CS:0x9115  [rec+8] := [rec+6]   a NEW weapon: count := base
 *   CS:0x94e8  inc [rec+8]          picking up one you ALREADY hold
 *   CS:0x9451  inc [rec+8]          a bulk power-up, applied to all 3 slots
 *
 * +0x06 (Power) has NO runtime writer at all — it is immutable, which is what
 * makes the pair a base and a counter rather than two independent stats.
 *
 * So the spawn handlers' `[si+8] - [si+6] + 1` reads as **1 + the number of
 * EXTRA pickups**, and the `dec bp / jz` chain clamps it to three: collect the
 * same weapon repeatedly and it fires more projectiles at once, up to 3.
 *
 * The shop confirms the same reading from the other side. CS:0x6fde refunds
 * `([+8] - [+6]) * (value + 1) / 2` — proportional to the extras collected,
 * which is only meaningful if the difference counts pickups.
 *
 * ⚠️ CONSEQUENCE FOR THE PORT: the volley size is NOT a per-weapon constant
 * and must not be derived from the shipped files. Every weapon starts at
 * ONE projectile the moment it is picked up, whatever PINNED_08 held — the
 * loaded value is overwritten by CS:0x9115 before the weapon can ever fire.
 */

/* ⚠️ THE TWO MECHANISMS COMPOSE — neither alone describes the volley.
 *
 * +0x08 is mutable pickup state (above), AND the level loader re-pins it to
 * the EXE-image value for all 11 records on every sublevel-'a' load
 * (CS:0x35e9, gated `cmp byte [0x43],0`). The weapon slots are only cleared
 * by CS:0x914c, whose two callers (CS:0x473, CS:0x8dd9) are full game
 * restarts, not level transitions — so a weapon is CARRIED between worlds
 * while its count is reset underneath it.
 *
 * The consequence is that a carried weapon's volley on entering a new world
 * is `1 + (imageCount - thatWorld's Power)`, because Power is per-file and
 * the count is not. For the axe entering world 3 that is 1 + (4 - 12), which
 * clamps to a 3-projectile spread. Freshly picking the same weapon up instead
 * re-bases the count to Power and drops it back to one.
 *
 * That asymmetry is what the bytes say; whether it reads as a designed reward
 * or an artefact is not decidable from them. UNKNOWN_carried_weapon_volley —
 * a dynamic check (level 2 -> 3 carrying an axe) would settle the observable
 * half. Both paths are modelled below rather than one being picked. */

/** Runtime state of one weapon: `count` is +0x08, `base` is +0x06 (Power). */
export function armWeapon(w) {            // CS:0x9115 — a NEW pickup
  /* CS:0x910d `mov word [di+0x4],0x0` — the ONE write to +0x04 outside the
   * mover's own tail. It lands on `w` itself, not on the returned per-slot
   * state, because +0x04 lives in the SAME shared weapon-table record as
   * +0x06/+0x08 in the original (DS:0xe2b6 + idx*0x50) — this port only
   * splits count/base out into per-slot state, not frame/facing. */
  w.frame = 0;
  return { index: w.index, base: w.power, count: w.power };
}

/** CS:0x35e9 — a sublevel-'a' load re-pins the count for every weapon, while
 *  `base` comes from the newly loaded world's file. */
export function reloadWorld(w) {
  return { index: w.index, base: w.power, count: PINNED_08[w.index] };
}
export function pickUpAgain(st) {         // CS:0x94e8 / CS:0x9451
  return { ...st, count: st.count + 1 };
}
/** CS:0x6fde — the shop's trade-in credit for a weapon, from its extras. */
export const refundFor = (st, w) =>
  (((st.count - st.base) * (w.value + 1)) >> 1);

/**
 * CS:0x95ca — pick a free projectile sub-slot for each armed weapon slot.
 *
 * @param {Array<{weapon:number, subslots:boolean[]}>} slots
 *   `weapon` < 0 means the slot is empty; `subslots[i]` true means occupied.
 * @param {Array} weapons parsed PWEAPONS records
 * @returns {{allocated:Array, any:boolean, slotCFired:boolean}}
 *
 * ⚠️ THE ASYMMETRY IS BETWEEN SLOT A AND THE OTHER TWO, not between C and the
 * other two — an earlier revision of this file had it as a slot-C special
 * case and gated both guards on `n === 2`. Slots B and C each carry:
 *
 *   - a maxShots sign guard, `cmp bx,0 / js` (CS:0x966f, CS:0x96da)
 *   - the DS:0x33e interlock (CS:0x969a, CS:0x9705), byte-for-byte identical:
 *       cmp bp,1 / jnz fire / cmp byte [0x33e],0 / jnz skip
 *
 * Slot A has neither. It is instead the only WRITER of DS:0x33e (CS:0x963b),
 * setting it when its own weapon's maxShots is 1 and it allocated. So the
 * rule is: if the hero's slot-A weapon is single-shot and fires this frame,
 * no other single-shot weapon fires with it. Multi-shot weapons are exempt on
 * both sides of the test. Why is not derivable from these sites —
 * UNKNOWN_weapon_slot_c_interlock — but the shape is plain in the bytes.
 *
 * ⚠️ The original's return value is INVERTED: `ax = cx`, where cx starts at 1
 * and is zeroed by `xor cx,cx` on any successful allocation. So 0 means
 * something fired. The lockout path at CS:0x971f returns 1 as well. This
 * function returns a positive `any` instead; do not "fix" it to match ax.
 *
 * DS:0x351 is a top-of-function lockout (CS:0x95cb): if already set, the
 * routine returns 1 immediately without clearing DS:0x33e or the three live
 * pointers. Pass `locked: true` to reproduce it.
 */
export function allocateShots(slots, weapons, { locked = false } = {}) {
  if (locked) return { allocated: [null, null, null], any: false, lockedOut: true };

  const allocated = [];
  let any = false;
  let flag33e = false;                      // DS:0x33e — cleared at CS:0x95da
  let slotCFired = false;

  slots.forEach((slot, n) => {
    const meta = WEAPON_SLOTS[n];
    if (!slot || slot.weapon < 0) { allocated.push(null); return; }   // 95ed `js`

    const w = weapons[slot.weapon];
    if (!w) { allocated.push(null); return; }
    /* CS:0x966f / 0x96da — slots B and C reject a negative maxShots before
     * probing; slot A does not test it at all. */
    if (n !== 0 && w.maxShots < 0) { allocated.push(null); return; }

    let budget = w.maxShots;
    let found = -1;
    for (let i = 0; i < MAX_SUBSLOTS && budget > 0; i++, budget--) {
      if (!slot.subslots[i]) { found = i; break; }                    // 9724
    }
    if (found < 0) { allocated.push(null); return; }

    /* CS:0x969a (B) and CS:0x9705 (C) — the interlock, on BOTH. */
    if (n !== 0 && w.maxShots === 1 && flag33e) { allocated.push(null); return; }
    /* CS:0x963b — and slot A is its only writer. */
    if (n === 0 && w.maxShots === 1) flag33e = true;

    if (n === 2) slotCFired = true;
    allocated.push({
      slot: n,
      subslot: found,
      tag: tagFor(n, found),
      weapon: slot.weapon,
      power: w.power,
    });
    any = true;                                                       // cx = 0
  });

  return { allocated, any, slotCFired, flag33e };
}
