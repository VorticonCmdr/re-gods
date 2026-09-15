/* shop.js — the shop screen, `FUN_1000_6c19` (grid loop) / `FUN_1000_6e62`
 * (buy/sell dispatch) / `FUN_1000_7233`+`0x7276` (roster load/filter/sort).
 * Full disassembly and a live DOSBox confirmation of the grid geometry are in
 * `Gods/docs/shop.md` — read that file's own header before trusting a claim
 * here; this module's own comments cite it rather than repeat it.
 *
 * SCOPE, disclosed rather than silently simplified:
 *   - Roster CONTENT is an explicit constructor parameter, not a hardcoded
 *     per-world table. The real source (`DS:0x51aa`, one static list per
 *     world) was never read this session — `UNKNOWN_shop_roster_source` in
 *     shop.md. `main.js` feeds this class the one live-captured sample this
 *     session got for world 2 (a real, byte-observed set of item ids), not
 *     an invented list, and an empty (EXIT-only) roster for worlds 3/4.
 *   - Prices ARE now ported for the 12 ids this session has a roster for —
 *     `UNKNOWN_shop_prices` is CLOSED, see shop.md. A machine-parsed (base64
 *     dump, decoded by script — not hand-transcribed) live read of
 *     `DS:0x2a4e` found a clean, unbroken 132-record table (a per-record
 *     tag byte increments by exactly 1 every record, wrapping at 0xff, with
 *     zero deviation), and the 12 prices below were independently
 *     corroborated by live purchases: the actual `DS:0x194` money deduction
 *     matched the decoded price exactly for every id bought (650 for id 70
 *     is a unique match against every other decoded price in the table, not
 *     just a plausible-looking number), and the table itself was confirmed
 *     GLOBAL rather than per-world/level-scoped by a direct re-read: the
 *     same 2048-byte range read during an ordinary world-1 start and again
 *     with the world-2 shop open came back byte-for-byte identical. Ids
 *     outside `PRICES` (any world 3/4 roster would need) remain unpriced —
 *     the live table's own ids 0-131 were all read and landmark-verified,
 *     but only these 12 were purchase-confirmed, and no world 3/4 roster
 *     exists in this port yet to need them.
 *   - Sell (raw item id `>= SELL_ID_BASE`) is not ported at all —
 *     `UNKNOWN_shop_tradein_value`. `roster` here should only ever contain
 *     ids below `SELL_ID_BASE`; the EXIT slot is the only non-buy cell.
 *   - Navigation is EDGE-triggered (one grid step per press). The original's
 *     own held-direction auto-repeat (`DS:0x339`/`0x33a`: an initial move,
 *     then a repeat every tick once a held direction crosses an 8-tick
 *     threshold, `CS:0x6cb1`-`0x6cdc`) is not ported — a played-with, not
 *     measured-against, simplification, same spirit as this project's other
 *     disclosed input-timing simplifications (e.g. the turn-cancel branch
 *     `docs/player-state-machine.md` notes as unported).
 *
 * THE GRID: 18 cells, 3 rows x 6 columns, index 0-16 are data cells and 17 is
 * always EXIT — checked before any roster lookup (`CS:0x6e74`-`0x6e7e`), so
 * an empty roster still lets the player leave. UP/DOWN move by row (+-6),
 * LEFT/RIGHT by column (+-1), and EVERY direction CLAMPS at the grid edge
 * rather than wrapping (`CS:0x6cef`-`0x6d42`) — moving left from column 0, or
 * up from row 0, is a no-op that tick, and likewise past the last populated
 * column or past row 2. `[PROVEN]`, live-confirmed under DOSBox for the
 * 3x6-plus-EXIT shape.
 *
 * BUY is always a TWO-PRESS confirm (`CS:0x6e91`-`0x6ea2`): the first FIRE
 * press on a slot only previews it (caches its id); a second press on the
 * SAME slot executes the purchase. Pressing FIRE on a DIFFERENT slot resets
 * the preview to the new one rather than buying anything.
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
import { drawText, drawCentered } from './title-menu.js';
import { INVENTORY_EMPTY } from './treasure.js';

export const GRID_COLS = 6;
export const GRID_ROWS = 3;
export const GRID_SLOTS = GRID_COLS * GRID_ROWS;       // 18, CS:0x6cef "mov ax,0x11"
export const EXIT_SLOT = GRID_SLOTS - 1;               // 17, CS:0x6e74-0x6e7e
export const DATA_SLOTS = EXIT_SLOT;                   // 17 addressable grid cells
export const SELL_ID_BASE = 0xc0;                      // CS:0x6ead/0x6ed7 — not ported, see header
export const BUY_CONFIRM_SFX = 0x333;                  // CS:0x6ee1, CS:0x22ca's own SFX primitive
export const REFUSAL_MESSAGE_PRIORITY = 0x19;          // matches message-line.md's own table (25)

/* `FUN_1000_7392`'s table, DS:0x2a4e + id*10, price word at +6/+7 (byte-
 * swapped) — live-read this session (base64 dump, script-decoded) and
 * purchase-confirmed for every id below (`DS:0x194` money delta on a real
 * buy exactly matched the decoded value). Only the 12 ids this port's own
 * world-2 roster (`main.js`'s `SHOP_ROSTER_WORLD_2`) actually shows are
 * listed — see shop.md's `UNKNOWN_shop_prices` for the full 132-record
 * table this was drawn from. */
export const PRICES = {
  0: 4000, 35: 8000, 36: 10000, 38: 5000, 42: 20000, 44: 4000,
  51: 1000, 52: 1000, 53: 1000, 70: 650, 71: 1300, 72: 1000,
};

export class ShopScreen {
  /**
   * @param {(number|null)[]} roster up to DATA_SLOTS raw item ids (<SELL_ID_BASE),
   *   already the caller's own sorted choice — short rosters are padded with
   *   `null` (empty slots). This class DOES prune by affordability and
   *   per-visit category lockout (see `#pruneRoster`), but not by the two
   *   still-unresolved eligibility gates (`UNKNOWN_shop_eligibility_gates`)
   * @param {number[]} inventory the 4-slot weapon/item array, `INVENTORY_EMPTY`
   *   marks an empty slot (mirrors `DS:0x17e/0x180/0x182/0x184`'s own `-1`
   *   sentinel — this port already represents that as the unsigned
   *   `treasure.js` constant everywhere else, so this class matches rather
   *   than reintroducing a second empty-slot convention) — mutated in place
   *   on a successful give-to-inventory purchase
   * @param {number} selectedSlot `DS:0x366`, the slot the fill scan skips
   * @param {object} state passed straight through to `applyConsumable` as its
   *   own `state` argument for an auto-use purchase (the same shape
   *   `game/pickup.js` already builds for an in-level pickup)
   * @param {{total:number, add:(v:number)=>any}} [purse] the game's money —
   *   `game/treasure.js`'s `Purse` already has exactly this shape. Omit it
   *   (as a synthetic test might) to skip pricing entirely: every item is
   *   then free and always eligible, the pre-pricing behavior.
   * @param {(text:string, priority:number)=>void} [onRefused] called when a
   *   give-to-inventory purchase finds no eligible empty slot; the reference
   *   text is not ported (`CS:0xec8b` was never read this session) so the
   *   caller decides what to show, if anything
   * @param {()=>void} [onDone] called once, when the EXIT cell is confirmed
   */
  constructor({ roster, inventory, selectedSlot = -1, state = {}, purse = null, onRefused, onDone }) {
    this.roster = Array.from({ length: DATA_SLOTS }, (_, i) => roster?.[i] ?? null);
    this.inventory = inventory;
    this.selectedSlot = selectedSlot;
    this.state = state;
    this.purse = purse;
    this.onRefused = onRefused;
    this.onDone = onDone;

    this.cursor = 0;              // DS:0x385
    this.previewId = null;        // DS:0x258 (magnitude only — sign is the sell toggle, not ported)
    this.purchasedCategories = new Set();   // DS:0x319, cleared fresh each shop visit
    this.lastPurchase = null;     // surfaced for draw()/tests, not itself game state
    this.done = false;
    this.firePrev = false;
    this.dirPrev = { up: false, down: false, left: false, right: false };

    this.#pruneRoster();         // an unaffordable starting item is never shown, CS:0x72c9
  }

  /** The item id under the cursor, or `null` on an empty cell / EXIT. */
  get hoveredId() {
    return this.cursor === EXIT_SLOT ? null : this.roster[this.cursor];
  }

  /**
   * One tick. `input` is the same held-state shape `main.js` already reads
   * every tick (`{up,down,left,right,fire}`) — edges are computed here.
   * @returns {object|null} the purchase made THIS tick, if any (also kept on
   *   `this.lastPurchase` for a caller that renders a tick or two later)
   */
  step(input) {
    if (this.done) return null;

    for (const dir of ['up', 'down', 'left', 'right']) {
      const held = !!input[dir];
      if (held && !this.dirPrev[dir]) this.#move(dir);
      this.dirPrev[dir] = held;
    }

    const firePressed = !!input.fire && !this.firePrev;
    this.firePrev = !!input.fire;
    return firePressed ? this.#fire() : null;
  }

  #move(dir) {
    const delta = dir === 'up' ? -GRID_COLS : dir === 'down' ? GRID_COLS
                : dir === 'left' ? -1 : 1;
    const next = this.cursor + delta;
    /* CS:0x6cf2-0x6d42 — clamp at the grid edge, never wrap. Off the top/
     * bottom edge is caught by the resulting index leaving [0, EXIT_SLOT];
     * off the left/right edge by the row changing, which a plain +-1 on a
     * flat index would otherwise do silently. */
    if (next < 0 || next > EXIT_SLOT) return;
    if ((dir === 'left' || dir === 'right')
        && Math.floor(next / GRID_COLS) !== Math.floor(this.cursor / GRID_COLS)) return;
    this.cursor = next;
  }

  #fire() {
    if (this.cursor === EXIT_SLOT) {           // CS:0x6e74-0x6e7e
      this.done = true;
      if (this.onDone) this.onDone();
      return null;
    }
    const id = this.roster[this.cursor];
    if (id == null) return null;                // CS:0x6e8f-0x6e93, empty slot: no-op
    if (this.previewId === id) {
      const purchase = this.#buy(id);
      this.previewId = null;
      return purchase;
    }
    this.previewId = id;                        // CS:0x6ea4 — preview only, no purchase yet
    return null;
  }

  #buy(id) {
    const cost = PRICES[id] ?? 0;
    if (this.purse && this.purse.total < cost) {
      /* CS:0x72c9's own affordability filter would never have left this id
       * selectable in the first place; reachable here only if money changed
       * out from under an already-previewed slot. Refuse rather than let
       * the purse go negative. */
      return this.lastPurchase = { id, cost, refused: true, reason: 'unaffordable' };
    }
    const rank = CONSUMABLES.findIndex((c) => c.type === id);
    if (rank >= 0) {
      this.purchasedCategories.add(rank);
      if (this.purse) this.purse.add(-cost);         // CS:0x6ef7 — deduct on confirm
      const result = safeApplyConsumable(CONSUMABLES[rank], this.state);
      this.#pruneRoster();
      return this.lastPurchase = { id, rank, cost, effect: CONSUMABLES[rank].effect, result };
    }
    /* A weapon-type id (no CONSUMABLES rank) — DS:0x5060[category]==0 in the
     * original. There is no established category id for a non-consumable
     * type here, so the id itself keys the once-per-visit lock instead. */
    this.purchasedCategories.add(id);
    const slot = this.inventory.findIndex((v, i) => v === INVENTORY_EMPTY && i !== this.selectedSlot);
    if (slot < 0) {
      if (this.onRefused) this.onRefused('', REFUSAL_MESSAGE_PRIORITY);
      return this.lastPurchase = { id, cost, refused: true };
    }
    if (this.purse) this.purse.add(-cost);
    this.inventory[slot] = id;
    this.#pruneRoster();
    return this.lastPurchase = { id, slot, cost };
  }

  /* Not eligible once its category is locked out for this visit (`DS:0x319`)
   * or its price now exceeds the purse (`FUN_1000_7392` via `CS:0x72c9`).
   * The full original rebuild also re-applies two still-unresolved
   * eligibility gates (`UNKNOWN_shop_eligibility_gates`) — not reproduced
   * here, disclosed rather than guessed at. */
  #isEligible(id) {
    if (id == null) return false;
    const rank = CONSUMABLES.findIndex((c) => c.type === id);
    if (this.purchasedCategories.has(rank >= 0 ? rank : id)) return false;
    const cost = PRICES[id];
    if (cost != null && this.purse && this.purse.total < cost) return false;
    return true;
  }

  /* CS:0x7233/0x7276 rebuild the visible grid after every purchase — a
   * bought-out category or a now-unaffordable item drops out rather than
   * staying selectable. */
  #pruneRoster() {
    for (let i = 0; i < DATA_SLOTS; i++) {
      if (this.roster[i] != null && !this.#isEligible(this.roster[i])) this.roster[i] = null;
    }
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
    if (this.purse) drawText(renderer, glyphs, `$${this.purse.total}`, 16, 8);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const slot = row * GRID_COLS + col;
        if (slot === EXIT_SLOT) continue;
        const id = this.roster[slot];
        if (id == null) continue;
        const rank = CONSUMABLES.findIndex((c) => c.type === id);
        const label = (rank >= 0 ? CONSUMABLES[rank].name : `#${id}`).toUpperCase();
        const marker = slot === this.cursor ? (this.previewId === id ? '>>' : '>') : '  ';
        const price = PRICES[id];
        const priceText = price != null ? ` ${price}` : '';
        drawText(renderer, glyphs, `${marker}${label}${priceText}`, 16, 32 + slot * 12);
      }
    }
    drawCentered(renderer, glyphs, this.cursor === EXIT_SLOT ? '>EXIT<' : 'EXIT', 188);
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
