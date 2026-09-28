#!/usr/bin/env python3
"""walker_live.py — the shop potion's shopkeeper (CS:0x05BA countdown,
CS:0x06B0 turn, CS:0x071E walker, CS:0x6BED shop entry), staged live in
PJOYL1's world-1 gameplay.

At tape cursor `at` the script pokes [0x363] = 0x41, what the shop potion's
handler (CS:0x61E9) writes. It logs every tick (poller stop): the countdown,
the hero, the walker record DS:0x266-0x26C, cs:[0x71D], [0x35D], [0x38A],
the health, and every sound play with its caller. `walk` ticks after the
walker is switched on, it moves the walker next to the hero (x + `gap`,
same y, walking left) so the contact and the shop entry happen in view.
Stops at CS:0x6BED or `end`.

  python3 walker_live.py 300 40 48 700     # writes walker_live.json
  python3 walker_live.py 300 40 48 840 1580 1 wall   # walker to x=1580 walking
                                           # right (dx=1) at the hero's y;
                                           # writes walker_live_wall.json
"""
import json, sys
from sweep import call, mem, word, wait_stop, DS, CS, SS, POLLER, SFX

SHOP = 0x6BED


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def main():
    at, walk, gap, end = (int(a) for a in sys.argv[1:5])
    movex = int(sys.argv[5]) if len(sys.argv) > 5 else None
    movedx = int(sys.argv[6]) if len(sys.argv) > 6 else -1
    tag = f'_{sys.argv[7]}' if len(sys.argv) > 7 else ''
    inject = 12
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/joyl1.raw.json'))['output']
    snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
    call('POST', '/debug/pause')
    since = call('GET', '/debug/status')['stop']['stop_id']

    def go(bps):
        nonlocal since
        call('DELETE', '/debug/breakpoints')
        for bp in bps:
            call('POST', '/debug/breakpoints', bp)
        call('POST', '/debug/continue')
        s = wait_stop(since)
        since = s['stop_id']
        return s

    def at_cursor(c):
        return {'type': 'execute', 'segment': CS, 'offset': POLLER,
                'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': c}}

    while True:
        go([at_cursor(inject)])
        if mem(DS, 0x3E6, 1)[0] == 1:
            break
    call('PUT', f'/memory/{DS}/{0x7E14}', bytes.fromhex(snap[2]), raw=True)
    call('PUT', f'/memory/{DS}/{0x160}', int(snap[1]).to_bytes(2, 'little'), raw=True)
    go([at_cursor(at)])
    call('PUT', f'/memory/{DS}/{0x363}', bytes([0x41]), raw=True)

    def row():
        return {'c': word(DS, 0x282), 'cd': s16(mem(DS, 0x363, 1)[0] | (0xFF00 if mem(DS, 0x363, 1)[0] & 0x80 else 0)),
                'hx': word(DS, 0x17A), 'hy': word(DS, 0x17C), 'st': mem(DS, 0x377, 1)[0],
                'ph': mem(DS, 0x36B, 1)[0], 'in': mem(DS, 0x382, 1)[0],
                'wx': s16(word(DS, 0x266)), 'wy': s16(word(DS, 0x268)), 'wdx': s16(word(DS, 0x26A)),
                'wph': word(DS, 0x26C), 'on': mem(CS, 0x71D, 1)[0] == 0x90, 'n35d': mem(DS, 0x35D, 1)[0],
                'l38a': mem(DS, 0x38A, 1)[0], 'tgt': s16(word(DS, 0x192)), 'bar': s16(word(DS, 0x19A)),
                'tock': mem(DS, 0x36C, 1)[0], 'cam': [word(DS, 0xA), word(DS, 0xC)], 'sfx': []}

    rows, cur, on_at, moved = [], row(), None, False
    watch = [{'type': 'execute', 'segment': CS, 'offset': o} for o in (POLLER, SFX, SHOP)]
    while True:
        st = go(watch)
        ip, r = st['registers']['eip'], st['registers']
        if ip == SFX:
            cur['sfx'].append(f"{r['eax'] & 0xFFFF:x}@{word(SS, r['esp'] & 0xFFFF):x}")
            continue
        rows.append(cur)
        print(cur, flush=True)
        if ip == SHOP:
            rows.append({'shop': word(DS, 0x282), 'tgt': s16(word(DS, 0x192)), 'on': mem(CS, 0x71D, 1)[0] == 0x90,
                         'ss40a': word(SS, 0x40A)})
            print(rows[-1], flush=True)
            break
        cur = row()
        if cur['on'] and on_at is None:
            on_at = cur['c']
        if on_at is not None and not moved and cur['c'] >= on_at + walk:
            x, y = (movex if movex is not None else cur['hx'] + gap), cur['hy']
            call('PUT', f'/memory/{DS}/{0x266}', (x & 0xFFFF).to_bytes(2, 'little'), raw=True)
            call('PUT', f'/memory/{DS}/{0x268}', (y & 0xFFFF).to_bytes(2, 'little'), raw=True)
            call('PUT', f'/memory/{DS}/{0x26A}', (movedx & 0xFFFF).to_bytes(2, 'little'), raw=True)
            cur.update(moved=[x, y, movedx], wx=x, wy=y, wdx=movedx)
            moved = True
        if cur['c'] > end or mem(DS, 0x3E6, 1)[0] != 1:
            break
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump({'at': at, 'walk': walk, 'gap': gap, 'movex': movex, 'movedx': movedx, 'rows': rows},
              open(f'{here}/walker_live{tag}.json', 'w'), indent=0)


if __name__ == '__main__':
    main()
