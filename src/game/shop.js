/* shop.js — the shop screen, `FUN_1000_6c19` (grid loop) / `FUN_1000_6e62`
 * (buy / weapon-swap dispatch) / `FUN_1000_7233`+`0x7276` (roster load/filter/sort).
 * Full disassembly and a live DOSBox confirmation of the grid geometry are in
 * `Gods/docs/shop.md` — read that file's own header before trusting a claim
 * here; this module's own comments cite it rather than repeat it.
 *
 * SCOPE, disclosed rather than silently simplified:
 *   - Roster CONTENT is an explicit constructor parameter, not a hardcoded
 *     per-world table, but the real source IS now read — `UNKNOWN_shop_
 *     roster_source` is CLOSED, see shop.md. The per-world pointer table
 *     lives at `SS:0x51aa`, not `DS:0x51aa` as first assumed (`[BP+disp]`
 *     addressing defaults to `SS` in real mode — that earlier "reads as
 *     zero" result was a segment error, not evidence of anything runtime-
 *     only). The constructor's `roster` param is now the FULL raw per-world
 *     candidate list (13 ids for world 2, 18 for worlds 3/4 — `main.js`'s
 *     `SHOP_ROSTER_WORLD_2`/`_3_4`), not a pre-filtered fixed-length array:
 *     `#rebuildVisible` reproduces `FUN_1000_7276`'s own filter/sort/
 *     truncate pipeline (below) rather than the caller doing it. World 1
 *     also has a real entry in `SS:0x51aa` but is never wired in — the shop
 *     is provably unreachable for world 1 (no password can target it).
 *   - The two eligibility gates ARE reproduced — `UNKNOWN_shop_
 *     eligibility_gates` is CLOSED (see shop.md): gate 1 (ids `2`/`3`, power
 *     potions) reads the hero's own weapon slots (`state.arsenal.slots` —
 *     `DS:0xdd10`/`0xdda2`/`0xde34` in the original) and opens once he
 *     holds any weapon; gate 2 (ids `40`/`41`, familiar boosts) reads the
 *     familiar's energy (`state.health.familiarEnergy` — `DS:0x168`) and
 *     opens once a familiar is alive, reachable in worlds 3/4 by buying id
 *     `39` (the familiar itself, `game/consumables.js`'s `applyFamiliar`) in
 *     this same shop.
 *   - The `0x25c` SCROLL path IS reproduced — `#rebuildVisible` sorts the
 *     eligible survivors ascending by price (`FUN_1000_7276`'s own
 *     selection sort) and, when there are more than `DATA_SLOTS` (17) of
 *     them, keeps only the LAST 17 — the original's renderer advances its
 *     base pointer into the sorted list by `count - 17` rather than
 *     exposing any player-facing scroll control, so overflow silently drops
 *     the CHEAPEST survivors, not the most recently added ones. This only
 *     fires for world 3/4 with every gate open and a large purse (13 < 17
 *     for world 2, so it never fires there).
 *   - Prices ARE ported for all 18 raw ids across worlds 2/3/4 —
 *     `UNKNOWN_shop_prices` is CLOSED, see shop.md. A machine-parsed (base64
 *     dump, decoded by script — not hand-transcribed) live read of
 *     `DS:0x2a4e` found a clean, unbroken 132-record table (a per-record
 *     tag byte increments by exactly 1 every record, wrapping at 0xff, with
 *     zero deviation), and the original 12 were independently corroborated
 *     by live purchases: the actual `DS:0x194` money deduction matched the
 *     decoded price exactly for every id bought (650 for id 70 is a unique
 *     match against every other decoded price in the table, not just a
 *     plausible-looking number). The table itself was confirmed GLOBAL
 *     rather than per-world/level-scoped by a direct re-read: the same
 *     2048-byte range read during an ordinary world-1 start and again with
 *     the world-2 shop open came back byte-for-byte identical. `2`/`3`/`40`/
 *     `41`'s own prices were read from the same table but never purchase-
 *     confirmed individually (they were excluded from every live capture
 *     this project made, by the very gates now reproduced above).
 *   - The weapon purchase/swap mechanic (raw id `>= WEAPON_ID_BASE`) IS now
 *     ported — `UNKNOWN_shop_tradein_value` is CLOSED, see shop.md. Buying
 *     a weapon that would displace a DIFFERENT one already in that physical
 *     slot (`#wouldDisplace`, mirroring `FUN_1000_953e`'s own slot choice)
 *     needs a third press and shows a warning (`#warningFor`, mirroring
 *     `FUN_1000_703a`'s "Warning.. this weapon replaces the X" message);
 *     buying into an empty slot or re-buying the same weapon is a plain
 *     two-press buy like a consumable. `#buyWeapon` credits half the
 *     displaced weapon's own price per extra pickup collected for it
 *     (`game/weapons.js`'s `refundFor`), charges the new weapon's own price,
 *     and arms it via `game/pickup.js`'s `pickUpWeapon` — the SAME function
 *     an in-level pickup uses. Weapon purchases are NOT subject to the
 *     per-visit category lockout (`DS:0x319`) — the original's own weapon-
 *     purchase branch never writes it, unlike the consumable buy branch.
 *     Every boundary check against the raw id goes through `pickup.js`'s
 *     own `isWeaponPickup`/`weaponIndexOf`, never a bare `id >=
 *     WEAPON_ID_BASE` — `pickup.js`'s own header explains why a bare
 *     comparison is unsafe (a dead/unused roster slot's `0xFFFF` sentinel
 *     also passes it).
 *   - Navigation is the original's own pass loop for keyboard and tape alike:
 *     `step(input)` packs the held keys into a DS:0x382 byte and runs one
 *     `iterate()` pass. Held-direction auto-repeat (`DS:0x339`/`0x33a`,
 *     `CS:0x6cb1`-`0x6cdc`): a new press moves at once, the 7th held pass
 *     after it moves again, and every 2nd pass after that; changing direction
 *     without releasing never moves. main.js runs passes at the original's
 *     20 Hz (CS:0x6D72's 2-tick wait), so a held key repeats at 10 Hz.
 *     FIRE acts on release (CS:0x6E62's poll loop), not on press.
 *
 * THE GRID: 18 cells, 3 rows x 6 columns, index 0-16 are data cells and 17 is
 * always EXIT — checked before any roster lookup (`CS:0x6e74`-`0x6e7e`), so
 * an empty roster still lets the player leave. UP/DOWN move by row (+-6),
 * LEFT/RIGHT by one (+-1) on the FLAT index (`CS:0x6cef`-`0x6d42`): only the
 * two ends clamp (left of 0, right of EXIT), so RIGHT from a row's last
 * column lands on the next row's first cell. UP/DOWN undo a step that would
 * leave [0, EXIT]. ⚠️ Corrected 2026-09-28: this header used to say every
 * direction clamps at the grid edge "[PROVEN] live"; the bytes say otherwise
 * for LEFT/RIGHT, and the live check only ever covered the grid's shape.
 *
 * BUY/SWAP is a TWO-PRESS confirm in the common case (`CS:0x6e91`-`0x6ea2`):
 * the first FIRE press on a slot only previews it (caches its id); a second
 * press on the SAME slot executes. Pressing FIRE on a DIFFERENT slot resets
 * the preview to the new one rather than buying anything. A weapon purchase
 * that would DISPLACE a different weapon is the one exception — its second
 * press only shows a warning (`#warningFor`) and needs a third, still on the
 * same cell, to actually execute; see the weapon-purchase bullet above.
 *
 * ON PURCHASE (`CS:0x6ee0`-`0x6f7a`): a category index locks that category
 * out for the rest of this shop visit (`DS:0x319`) — `game/pickup.js`'s own
 * `consumableRank` already established this as "count category-0 types
 * below `type`", which for any type IN `CONSUMABLES` is exactly that entry's
 * own `rank`, so this module reuses `rank` directly rather than re-deriving
 * it. Dispatch is by whether `CONSUMABLES` has a rank for the id: if so,
 * this is an auto-use item (`DS:0x5060[category] != 0` in the original) and
 * `applyConsumable` runs immediately, exactly as an in-level pickup would
 * (`CS:0x6f39` calls into the SAME `DS:0xd8b8` jump table `docs/message-
 * line.md` already documents for the hint tablet). If not (a weapon-type id
 * `CONSUMABLES` has no rank for), this is the give-to-inventory path: the
 * first empty slot in `inventory` is filled, SKIPPING `selectedSlot`
 * (`DS:0x366` — see `docs/consumables-and-treasure.md`'s own citation of
 * this exact skip on an ordinary pickup); if every eligible slot is full,
 * `onRefused` is called (mirrors the original's priority-0x19 message,
 * `CS:0x6f6d`, independently cross-validated against `docs/message-line.md`'s
 * own priority table) and nothing is consumed. This inventory-fill branch is
 * not exercised by the one real roster `main.js` feeds this session — every
 * live-observed world-2 item was auto-use — so it is tested here only with
 * synthetic ids (`checkShop()`).
 */

import { CONSUMABLES, applyConsumable } from './consumables.js';
import { chooseSlot, pickUpWeapon, isWeaponPickup, weaponIndexOf } from './pickup.js';
import { refundFor } from './weapons.js';
import { drawText, drawCentered } from './title-menu.js';
import { INVENTORY_EMPTY } from './treasure.js';

export const GRID_COLS = 6;
export const GRID_ROWS = 3;
export const GRID_SLOTS = GRID_COLS * GRID_ROWS;       // 18, CS:0x6cef "mov ax,0x11"
export const EXIT_SLOT = GRID_SLOTS - 1;               // 17, CS:0x6e74-0x6e7e
export const DATA_SLOTS = EXIT_SLOT;                   // 17 addressable grid cells
/* Renamed from SELL_ID_BASE — UNKNOWN_shop_tradein_value (CLOSED, Gods/docs/
 * shop.md) found this is not a sell threshold at all. Every raw id at or
 * above this is a WEAPON TYPE to buy and equip (id - WEAPON_ID_BASE = the
 * weapon's own index into game/weapons.js's WEAPON_NAMES/parseWeapons
 * output); there is no path anywhere that sells for cash without also
 * arming a new weapon. */
export const WEAPON_ID_BASE = 0xc0;                    // CS:0x6ead/0x6ed7
export const MOVE_SFX = 0x232;                         // CS:0x6D4C, the cursor changed cell
export const BUY_CONFIRM_SFX = 0x333;                  // CS:0x6ee1, CS:0x22ca's own SFX primitive
/* DS:0xEC8B, CS:0x6F67 `mov [0x212],0xec8b`: 11 " Inventory Full - You cannot
 * buy that " 11 00. The 0x11 framing glyphs are left out, as the weapon
 * warning's are (both go to the status-panel message line in the original;
 * this port's shop shows them on its own screen). */
export const REFUSAL_TEXT = 'Inventory Full - You cannot buy that';
export const REFUSAL_MESSAGE_PRIORITY = 0x19;          // matches message-line.md's own table (25)

/* `FUN_1000_7392`'s table, DS:0x2a4e + id*10, price word at +6/+7 (byte-
 * swapped) — live-read this session (base64 dump, script-decoded). The
 * original 12 (world 2) are purchase-confirmed (`DS:0x194` money delta on a
 * real buy exactly matched the decoded value); the rest are read from the
 * same table with the same unbroken landmark but not individually purchase-
 * confirmed. All 18 raw ids either world's `SS:0x51aa` list can name are
 * listed — see shop.md's `UNKNOWN_shop_prices` for the full 132-record
 * table this was drawn from. */
export const PRICES = {
  0: 4000, 2: 6000, 3: 12000, 35: 8000, 36: 10000, 37: 20000, 38: 5000,
  39: 30000, 40: 5000, 41: 10000, 42: 20000, 44: 4000, 51: 1000, 52: 1000,
  53: 1000, 70: 650, 71: 1300, 72: 1000,
};

/** CS:0x71AA / 0x71D6 `0x2ee` — the shown money's step per shop pass. */
export const MONEY_STEP = 750;
/** CS:0x71A3 / 0x71CF — played on every step of the shown money. */
export const MONEY_TICK_SFX = 0x111;

export class ShopScreen {
  /**
   * @param {number[]} roster the FULL raw per-world candidate list (`SS:
   *   0x51aa`'s own ids, any order — `#rebuildVisible` filters/sorts/
   *   truncates it exactly as `FUN_1000_7276` does), not a pre-filtered
   *   fixed-length array. May be longer than `DATA_SLOTS`; overflow and
   *   ineligible ids are computed here, not by the caller.
   * @param {number[]} inventory the 4-slot weapon/item array, `INVENTORY_EMPTY`
   *   marks an empty slot (mirrors `DS:0x17e/0x180/0x182/0x184`'s own `-1`
   *   sentinel — this port already represents that as the unsigned
   *   `treasure.js` constant everywhere else, so this class matches rather
   *   than reintroducing a second empty-slot convention) — mutated in place
   *   on a successful give-to-inventory purchase
   * @param {number} selectedSlot `DS:0x366`, the slot the fill scan skips
   * @param {object} state passed straight through to `applyConsumable` as its
   *   own `state` argument for an auto-use purchase (the same shape
   *   `game/pickup.js` already builds for an in-level pickup). Also read
   *   directly by `#isEligible` for the two eligibility gates:
   *   `state.arsenal.slots` (ids `2`/`3`) and `state.health.familiarEnergy`
   *   (ids `40`/`41`) — `UNKNOWN_shop_eligibility_gates`, CLOSED — and by
   *   every weapon-purchase id (`>= WEAPON_ID_BASE`): `state.arsenal` is
   *   passed straight to `game/pickup.js`'s `chooseSlot`/`pickUpWeapon`,
   *   the same `Arsenal` instance the rest of the game already mutates.
   * @param {{total:number, add:(v:number)=>any}} [purse] the game's money —
   *   `game/treasure.js`'s `Purse` already has exactly this shape. Omit it
   *   (as a synthetic test might) to skip pricing entirely: every item is
   *   then free and always eligible, the pre-pricing behavior.
   * @param {(text:string, priority:number)=>void} [onRefused] called when a
   *   give-to-inventory purchase finds no eligible empty slot, with
   *   REFUSAL_TEXT (DS:0xEC8B) and priority 0x19
   * @param {()=>void} [onDone] called once, when the EXIT cell is confirmed
   * @param {(effect:string, result:?object)=>void} [onConsumable] called after
   *   a consumable is applied. The shop dispatches through the SAME handler
   *   table as a pickup (DS:0xD8B8: CS:0x6F32 here, CS:0x1822 there), so a
   *   bought potion's timer, and the shield's loop sound, are the caller's.
   */
  constructor({ roster, inventory, selectedSlot = -1, state = {}, purse = null, onRefused, onDone,
                prices = null, onConsumable = null }) {
    this.prices = prices;          // per-world POBJECTS +6 values, or null for PRICES
    this.candidates = roster ? roster.slice() : [];   // the FULL raw list, SS:0x51aa
    this.roster = new Array(DATA_SLOTS).fill(null);   // the visible grid — #rebuildVisible fills this
    this.inventory = inventory;
    this.selectedSlot = selectedSlot;
    this.state = state;
    this.purse = purse;
    this.onRefused = onRefused;
    this.onDone = onDone;
    this.onConsumable = onConsumable;

    this.cursor = 0;              // DS:0x385
    /* DS:0x258. Positive = an ordinary preview. Negative = a weapon-purchase
     * preview that has already shown its "replaces the X" warning (#fire's
     * own NEG, CS:0x6fa0) — its magnitude is still the raw id, so `Math.abs`
     * is how every comparison against it reads "is this the same cell". */
    this.previewId = null;
    this.pendingWarning = null;   // text for the warning above, or null
    this.purchasedCategories = new Set();   // DS:0x319, cleared fresh each shop visit
    this.lastPurchase = null;     // surfaced for draw()/tests, not itself game state
    this.done = false;
    this.moved = false;           // the last pass changed the cursor (CS:0x6D45)
    /* `iterate()` state — the original's own per-pass bookkeeping. */
    this.repeatBits = 0;          // DS:0x339, the input byte being held
    this.repeatCount = 0;         // DS:0x33A
    this.fireWait = false;        // inside CS:0x6E62's poll-until-released loop
    /* DS:0x254/0x256, the money the shop SHOWS. Both entries copy the real
     * money into it (CS:0x6BED, CS:0x0676), and every non-FIRE pass moves it
     * 750 toward the real amount (CS:0x718B), with sound 0x111 per step. */
    this.shownMoney = purse ? purse.total : 0;
    this.moneyTicked = false;     // this pass stepped the shown money (sound 0x111)

    this.#rebuildVisible();      // an unaffordable/ineligible starting item is never shown, CS:0x72c9
  }

  /** The item id under the cursor, or `null` on an empty cell / EXIT. */
  get hoveredId() {
    return this.cursor === EXIT_SLOT ? null : this.roster[this.cursor];
  }

  /**
   * One shop pass from held keys (`{up,down,left,right,fire}`), packed into
   * the DS:0x382 byte `iterate()` takes. main.js calls it at the pass rate.
   * @returns {object|null} the purchase made on THIS pass, if any (also kept
   *   on `this.lastPurchase` for a caller that renders a tick or two later)
   */
  step(input) {
    return this.iterate((input.up ? 0x01 : 0) | (input.down ? 0x02 : 0)
                      | (input.left ? 0x04 : 0) | (input.right ? 0x08 : 0)
                      | (input.fire ? 0x80 : 0));
  }

  /**
   * One pass of the original's shop loop (CS:0x6C90-0x6D78), or one poll of
   * its fire-release wait (CS:0x6E62-0x6E72), fed one input byte — exactly
   * one DS:0x382 poll (CS:0x241D), i.e. one tape entry during a demo. This
   * is what a joyl recording's bytes mean inside the shop; `step()` (edge-
   * triggered, per tick) stays the keyboard path.
   *     6CAA  byte == 0          -> [0x339]:=0, [0x33A]:=0, move
   *     6CB1  [0x339] == 0       -> [0x33A]:=1, [0x339]:=byte, move
   *     6CC6  byte == [0x339]    -> [0x33A]++ ; < 8 skip ; else [0x33A]:=6, move
   *           else (changed)     -> [0x33A]:=0, skip  (no move until released)
   *     6CEF  move: RIGHT inc (dec back if > 0x11) ; LEFT dec (inc back if
   *           < 0) ; UP -6 (+6 back if < 0) ; DOWN +6 (-6 back if > 0x11) —
   *           a FLAT cursor, so LEFT/RIGHT wrap between rows (an earlier
   *           note here said every direction clamps at the grid edge; only
   *           the flat ends clamp)
   *     6D53  FIRE -> CS:0x6E62: poll until an entry without FIRE, then act
   *           on the cursor (EXIT, preview, buy) and restart the loop.
   * @param {number} bits DS:0x382: 1 UP, 2 DOWN, 4 LEFT, 8 RIGHT, 0x80 FIRE
   * @returns {?object} a purchase, like `step()`, or null
   */
  iterate(bits) {
    this.moneyTicked = false;
    if (this.done) return null;
    if (this.fireWait) {
      this.moved = false;
      if (bits & 0x80) return null;              // CS:0x6E6D `jnz 0x6e62`
      this.fireWait = false;
      return this.#fire();                        // CS:0x6E74
    }
    let move;
    if (bits === 0) { this.repeatBits = 0; this.repeatCount = 0; move = true; }
    else if (this.repeatBits === 0) { this.repeatCount = 1; this.repeatBits = bits; move = true; }
    else if (this.repeatBits === bits) {
      this.repeatCount++;
      if (this.repeatCount < 8) move = false;
      else { this.repeatCount = 6; move = true; }
    } else { this.repeatCount = 0; move = false; }
    const before = this.cursor;                   // CS:0x6CA2 [0x25a] = [0x385]
    if (move) {
      if (bits & 0x08) { this.cursor++; if (this.cursor > EXIT_SLOT) this.cursor--; }
      if (bits & 0x04) { this.cursor--; if (this.cursor < 0) this.cursor++; }
      if (bits & 0x01) { this.cursor -= GRID_COLS; if (this.cursor < 0) this.cursor += GRID_COLS; }
      if (bits & 0x02) { this.cursor += GRID_COLS; if (this.cursor > EXIT_SLOT) this.cursor -= GRID_COLS; }
    }
    this.moved = this.cursor !== before;          // CS:0x6D42 -> sfx MOVE_SFX
    if (bits & 0x80) this.fireWait = true;       // CS:0x6D53 -> 0x6E62
    else this.moneyTicked = this.#chaseMoney();  // CS:0x6D5D-0x6D60, not on a FIRE pass
    return null;
  }

  /** CS:0x718B: the shown money steps 0x2EE (750) toward the real money,
   *  never past it, and every step plays 0x111 (CS:0x71A3 down, 0x71CF up).
   *  Equal: nothing. [PROVEN] live: the PJOYL2/PJOYL3 sweeps' 0x111 runs
   *  after each purchase. @returns {boolean} whether it stepped */
  #chaseMoney() {
    if (!this.purse) return false;
    const want = this.purse.total, cur = this.shownMoney;
    if (cur === want) return false;
    this.shownMoney = cur > want ? Math.max(want, cur - MONEY_STEP) : Math.min(want, cur + MONEY_STEP);
    return true;
  }

  #fire() {
    if (this.cursor === EXIT_SLOT) {           // CS:0x6e74-0x6e7e
      this.done = true;
      if (this.onDone) this.onDone();
      return null;
    }
    const id = this.roster[this.cursor];
    if (id == null) return null;                // CS:0x6e8f-0x6e93, empty slot: no-op
    if (this.previewId != null && Math.abs(this.previewId) === id) {
      /* CS:0x6f8e-0x6f9b — a weapon id whose preview hasn't been warned yet
       * (still positive) needs one more look at whether it would displace a
       * DIFFERENT weapon before buying. An empty target slot or re-buying
       * the same weapon already there skips straight through, same as any
       * consumable's plain second press. */
      if (isWeaponPickup(id) && this.previewId > 0
          && this.#wouldDisplace(weaponIndexOf(id))) {
        this.pendingWarning = this.#warningFor(weaponIndexOf(id));
        this.previewId = -id;                   // CS:0x6fa0 NEG — one more press to execute
        return null;
      }
      const purchase = this.#buy(id);
      /* ⚠️ DS:0x258 is NOT cleared by a purchase — neither the consumable
       * path (CS:0x6EE0-0x6F3E) nor the weapon path (CS:0x6FA7-0x7037)
       * writes it; both just rebuild the grid (CS:0x7233) and loop. So a
       * later first press on a cell that shows the same id buys at once.
       * An earlier revision reset it to null here. [PROVEN] live: PJOYL2's
       * shop keeps [0x258]=197 after buying 197. */
      if (!purchase?.refused) this.pendingWarning = null;   // #buy set REFUSAL_TEXT
      return purchase;
    }
    this.previewId = id;                        // CS:0x6ea4 — preview only, no purchase yet
    this.pendingWarning = null;
    return null;
  }

  #buy(id) {
    const cost = this.#priceFor(id) ?? 0;
    if (this.purse && this.purse.total < cost) {
      /* CS:0x72c9's own affordability filter would never have left this id
       * selectable in the first place; reachable here only if money changed
       * out from under an already-previewed slot. Refuse rather than let
       * the purse go negative. */
      return this.lastPurchase = { id, cost, refused: true, reason: 'unaffordable' };
    }
    if (isWeaponPickup(id)) return this.#buyWeapon(id, cost);
    const rank = CONSUMABLES.findIndex((c) => c.type === id);
    if (rank >= 0) {
      this.purchasedCategories.add(rank);
      if (this.purse) this.purse.add(-cost);         // CS:0x6ef7 — deduct on confirm
      const result = safeApplyConsumable(CONSUMABLES[rank], this.state);
      if (this.onConsumable) this.onConsumable(CONSUMABLES[rank].effect, result);
      this.#rebuildVisible();
      return this.lastPurchase = { id, rank, cost, effect: CONSUMABLES[rank].effect, result };
    }
    /* A weapon-type id (no CONSUMABLES rank) — DS:0x5060[category]==0 in the
     * original. There is no established category id for a non-consumable
     * type here, so the id itself keys the once-per-visit lock instead. */
    this.purchasedCategories.add(id);
    const slot = this.inventory.findIndex((v, i) => v === INVENTORY_EMPTY && i !== this.selectedSlot);
    if (slot < 0) {
      this.pendingWarning = REFUSAL_TEXT;         // CS:0x6F67-0x6F74
      if (this.onRefused) this.onRefused(REFUSAL_TEXT, REFUSAL_MESSAGE_PRIORITY);
      return this.lastPurchase = { id, cost, refused: true };
    }
    if (this.purse) this.purse.add(-cost);
    this.inventory[slot] = id;
    this.#rebuildVisible();
    return this.lastPurchase = { id, slot, cost };
  }

  /* CS:0x6f7c-0x7037 — buy and equip a weapon. If its target slot
   * (`chooseSlot`, mirroring `FUN_1000_953e`) already holds a DIFFERENT
   * weapon, that weapon is displaced: credit half its own price per extra
   * pickup collected for it (`refundFor`, `game/weapons.js`), read BEFORE
   * arming overwrites the slot's state. Then charge the new weapon's own
   * price and arm it via `pickUpWeapon` — the SAME function an in-level
   * pickup uses, so a duplicate purchase (re-buying what's already
   * equipped) correctly becomes a genuine extra-pickup rather than a
   * silent no-op. No category lockout: `DS:0x319` is never written on this
   * branch in the original. */
  #buyWeapon(id, cost) {
    const weaponIndex = weaponIndexOf(id);
    const arsenal = this.state.arsenal;
    let refund = 0, replaced = null;
    if (arsenal) {
      const slot = arsenal.slots[chooseSlot(arsenal, weaponIndex)];
      if (slot.weapon >= 0 && slot.weapon !== weaponIndex) {
        const oldWeapon = arsenal.weapons[slot.weapon];
        refund = refundFor(slot.st, oldWeapon);
        replaced = oldWeapon.name;
      }
    }
    if (this.purse) { this.purse.add(refund); this.purse.add(-cost); }
    const result = arsenal ? pickUpWeapon(arsenal, weaponIndex) : null;
    this.#rebuildVisible();
    return this.lastPurchase = { id, weaponIndex, cost, refund, replaced, result };
  }

  /** CS:0x6f8e-0x6f9b, read-only: would buying this weapon displace a
   *  DIFFERENT one from its target slot? False for an empty slot or the
   *  same weapon already there — both are a plain two-press buy. */
  #wouldDisplace(weaponIndex) {
    const arsenal = this.state.arsenal;
    if (!arsenal) return false;
    const slot = arsenal.slots[chooseSlot(arsenal, weaponIndex)];
    return slot.weapon >= 0 && slot.weapon !== weaponIndex;
  }

  /** CS:0x703a — "Warning.. this weapon replaces the X", X read from the
   *  currently-equipped weapon's own embedded name (`game/weapons.js`'s
   *  `WEAPON_NAMES`, confirmed by decompressing PWEAPONS.001 with blast.py). */
  #warningFor(weaponIndex) {
    const arsenal = this.state.arsenal;
    const slot = arsenal.slots[chooseSlot(arsenal, weaponIndex)];
    return `Warning.. this weapon replaces the ${arsenal.weapons[slot.weapon].name}`;
  }

  /** `!isWeaponPickup(id)`: the static consumable table. Otherwise: the
   *  CURRENT world's own loaded weapon record — unlike consumable prices,
   *  weapon prices are per-world (`game/weapons.js`'s own `value` field
   *  varies by `PWEAPONS.00{1-4}`, not a single global table). Goes through
   *  `pickup.js`'s own sign-aware `isWeaponPickup`, not a bare `>=
   *  WEAPON_ID_BASE`, since a dead/unused roster slot's `0xFFFF` sentinel
   *  would otherwise also read as a "weapon" id here. */
  #priceFor(id) {
    /* CS:0x7392: the price is the runtime descriptor's +6 word, which
     * CS:0x35FB copies from the LOADED world's POBJECTS record — so it is
     * per world. `PRICES` below is world 1's file; worlds 2-4 charge more
     * for 2/3 (20000/32500, PJOYL2's shop). A caller that passes `prices`
     * (main.js: the level's own `objValues`) gets the real ones. */
    if (!isWeaponPickup(id)) return this.prices ? this.prices[id] : PRICES[id];
    return this.state.arsenal?.weapons?.[weaponIndexOf(id)]?.value;
  }

  /* Not eligible once its price exceeds the purse (`FUN_1000_7392` via
   * `CS:0x72c9`), or — `UNKNOWN_shop_eligibility_gates`, CLOSED (Gods/docs/
   * shop.md) — one of the two gates the original's own roster rebuild
   * re-applies every time: `FUN_1000_731b` (ids 2/3, gated on the hero's
   * weapon slots) and `FUN_1000_7336` (ids 40/41, gated on the familiar's
   * energy). The per-visit category lockout (`DS:0x319`) only applies to
   * consumable ids — a weapon purchase never writes it in the original, so
   * it never gates one here either (`UNKNOWN_shop_tradein_value`, CLOSED). */
  #isEligible(id) {
    if (id == null) return false;
    if (!isWeaponPickup(id)) {
      const rank = CONSUMABLES.findIndex((c) => c.type === id);
      if (this.purchasedCategories.has(rank >= 0 ? rank : id)) return false;
    }
    const cost = this.#priceFor(id);
    if (cost != null && this.purse && this.purse.total < cost) return false;
    if ((id === 2 || id === 3) && !this.#hasArmedWeapon()) return false;   // FUN_1000_731b
    if ((id === 40 || id === 41) && !this.#hasFamiliar()) return false;   // FUN_1000_7336
    return true;
  }

  /** DS:0xdd10 & 0xdda2 & 0xde34 != -1 — at least one of the hero's three
   *  weapon slots holds a real weapon index rather than the empty sentinel. */
  #hasArmedWeapon() {
    return !!this.state.arsenal?.slots?.some((s) => s.weapon >= 0);
  }

  /** DS:0x168 != -1 — a familiar is currently alive. */
  #hasFamiliar() {
    return (this.state.health?.familiarEnergy ?? -1) >= 0;
  }

  /* CS:0x7233/0x7276's own full rebuild: filter the FULL raw candidate list
   * by #isEligible, sort survivors ascending by price (the original's own
   * selection sort on FUN_1000_7392's value — this port uses a stable JS
   * sort instead; tie order among same-priced ids was never established as
   * significant), and if there are more than DATA_SLOTS (17), keep only the
   * LAST 17 — FUN_1000_707d's own `DS:0x25c = count - 17` scroll, which
   * advances the render base pointer FORWARD into the ascending list rather
   * than exposing any player-facing scroll control, so overflow silently
   * drops the CHEAPEST survivors. Called at construction and after every
   * purchase, since a bought-out category, a now-unaffordable item, or a
   * newly-opened gate (buying the familiar reveals 40/41 on the very same
   * rebuild) can each change the eligible set. */
  #rebuildVisible() {
    /* CS:0x7347-0x7391: the survivors are PUSHED onto the stack (which
     * reverses them), bubble-sorted there by price with a strict `>` swap
     * (`cmp bx,dx / jle` — stable), then popped back in ascending order. So
     * equal prices end up in REVERSE list order. ⚠️ An earlier revision sorted
     * the list in its own order, which put 38 before 197 (both 5000) in
     * world 2's grid; PJOYL2's live shop shows 197 in cell 8. */
    const eligible = this.candidates.filter((id) => this.#isEligible(id)).reverse();
    eligible.sort((a, b) => (this.#priceFor(a) ?? 0) - (this.#priceFor(b) ?? 0));
    const visible = eligible.length > DATA_SLOTS
      ? eligible.slice(eligible.length - DATA_SLOTS)
      : eligible;
    for (let i = 0; i < DATA_SLOTS; i++) this.roster[i] = visible[i] ?? null;
    /* CS:0x7306-0x730D: no survivors at all -> the cursor is FORCED onto
     * EXIT. [PROVEN] live: PJOYL2's third 5000 purchase empties the purse at
     * cursor 1226 and [0x385] becomes 0x11 in the same pass. */
    if (eligible.length === 0) this.cursor = EXIT_SLOT;
  }

  /** Text-only rendering — no shop-icon sprite sheet was RE'd this session,
   *  so this draws the grid as item names (`CONSUMABLES`' own `name` field,
   *  itself confirmed against POBJECTS text per consumables.js's header)
   *  rather than the original's pixel icons. A disclosed simplification,
   *  same spirit as tally.js's own draw() smoke test. */
  draw(renderer, glyphs) {
    if (!glyphs) return;
    if (renderer.clear) renderer.clear(0);   // no backdrop bitmap was RE'd — plain background
    drawCentered(renderer, glyphs, 'SHOP', 8);
    if (this.purse) drawText(renderer, glyphs, `$${this.shownMoney}`, 16, 8);   // DS:0x254, CS:0x71F8
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const slot = row * GRID_COLS + col;
        if (slot === EXIT_SLOT) continue;
        const id = this.roster[slot];
        if (id == null) continue;
        const label = this.#labelFor(id).toUpperCase();
        const marker = slot === this.cursor
          ? (this.previewId != null && Math.abs(this.previewId) === id ? '>>' : '>')
          : '  ';
        const price = this.#priceFor(id);
        const priceText = price != null ? ` ${price}` : '';
        drawText(renderer, glyphs, `${marker}${label}${priceText}`, 16, 32 + slot * 12);
      }
    }
    if (this.pendingWarning) {
      drawText(renderer, glyphs, this.pendingWarning.toUpperCase(), 16, 176);
    }
    drawCentered(renderer, glyphs, this.cursor === EXIT_SLOT ? '>EXIT<' : 'EXIT', 188);
  }

  /** The name shown in the grid: a `CONSUMABLES` entry's own `name` below
   *  `WEAPON_ID_BASE`, or the current world's own weapon record's `name`
   *  (`game/weapons.js`'s `WEAPON_NAMES`) above it. */
  #labelFor(id) {
    if (!isWeaponPickup(id)) {
      const rank = CONSUMABLES.findIndex((c) => c.type === id);
      return rank >= 0 ? CONSUMABLES[rank].name : `#${id}`;
    }
    const w = this.state.arsenal?.weapons?.[weaponIndexOf(id)];
    return w ? w.name : `#${id}`;
  }
}

/* `applyConsumable` expects a `state` shaped like `game/pickup.js`'s own
 * caller builds (`{health, arsenal, ...effects}`) — a shop purchase may run
 * with a partial one (e.g. a synthetic test), so guard the call rather than
 * let a missing field throw mid-purchase. */
function safeApplyConsumable(entry, state) {
  try { return applyConsumable(entry, state); }
  catch { return null; }
}
