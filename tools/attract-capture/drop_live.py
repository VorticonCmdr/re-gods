#!/usr/bin/env python3
"""drop_live.py — the crouch drop (CS:0x61A1) and the selected-slot key
pickup (CS:0x6100), driven live in PJOYL1's crouch (cursors 801-843).

The demo's inventory is empty and its crouch never reaches the drop, so the
script stages it: at the crouch handlers CS:0x4AE0/0x4B55 it fills the four slots
(DS:0x17E) and overrides the input byte DS:0x382 / the flags per cursor:
  812  [0x355] = 1, FIRE off        -> 4B31 drops slot [0x367] (1)
  814  slot 3 selected, [0x354] = 0, a key in the hot-point box, FIRE on
                                    -> 6100 writes the key into slot 3
  816  slot 2 selected, DOWN off    -> 4AE7 drops slot 2, then the count
  817  DOWN off                     -> stand up
With `natural` (python3 drop_live.py natural), 814 also clears [0x355] as a
fresh crouch does, so 815 takes the FIRE-tap path and 816's release shows
what standing up after a key pickup does. Writes drop_live[_natural].json.
Every CS:0x61A1 entry and CS:0xBF5F call is logged with its registers.

DOSBox must be RUNNING the attract cycle; the script pauses it itself.
  python3 drop_live.py            # writes drop_live.json
"""
import json, sys
from sweep import call, mem, word, wait_stop, DS, CS, POLLER

HANDLERS, DROP, POPUP = (0x4AE0, 0x4B55), 0x61A1, 0xBF5F  # crouch right / left


def put(off, data):
    call('PUT', f'/memory/{DS}/{off}', bytes(data), raw=True)


def putw(off, v):
    put(off, (v & 0xFFFF).to_bytes(2, 'little'))


def main():
    natural = 'natural' in sys.argv[1:]
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

    at805 = [{'type': 'execute', 'segment': CS, 'offset': h,
              'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': 805}}
             for h in HANDLERS]
    while True:
        go(at805)
        if mem(DS, 0x3E6, 1)[0] == 1:
            break
    cats = mem(DS, 0xEF78, 0xC0)
    keys = [t for t in range(0xC0) if cats[t] == 2]
    fill = (keys + [t for t in range(1, 0xC0) if t not in keys])[:5]
    inv = fill[:4]
    for i, t in enumerate(inv):
        putw(0x17E + 2 * i, t)
    log = {'keys': keys, 'inv0': inv, 'events': [], 'ticks': []}
    print('keys', keys, 'inv', inv, flush=True)

    def state():
        return {'c': word(DS, 0x282), 'inv': [word(DS, 0x17E + 2 * i) for i in range(4)],
                'sel': list(mem(DS, 0x366, 2)), 'f341': mem(DS, 0x341, 1)[0],
                'f354': list(mem(DS, 0x354, 2)), 'hero': [word(DS, 0x17A), word(DS, 0x17C)],
                'popup': word(DS, 0x1A0)}

    watch = [{'type': 'execute', 'segment': CS, 'offset': o} for o in (*HANDLERS, DROP, POPUP, POLLER)]
    placed = None
    while True:
        st = go(watch)
        ip, r = st['registers']['eip'], st['registers']
        c = word(DS, 0x282)
        if mem(DS, 0x3E6, 1)[0] != 1 or c > 822:
            break
        if ip in (DROP, POPUP):
            ev = {'at': hex(ip), 'c': c, 'ax': r['eax'] & 0xFFFF, 'bx': r['ebx'] & 0xFFFF,
                  'cx': r['ecx'] & 0xFFFF, 'ret': hex(word(r['ss'], r['esp'] & 0xFFFF)), **state()}
            log['events'].append(ev)
            print(ev, flush=True)
            continue
        if ip == POLLER:
            continue
        inp = mem(DS, 0x382, 1)[0]
        if c == 812:
            put(0x355, [1])
            inp &= ~0x80
        elif c == 814:
            put(0x366, [3, 3])
            put(0x354, [0])
            if natural:
                put(0x355, [0])
            hx, hy = word(DS, 0x17A), word(DS, 0x17C)
            for i in range(200):
                o = 0x8314 + 8 * i
                if word(DS, o + 4) & 0x8000:
                    placed = {'slot': i, 'type': fill[4], 'x': hx + 0x10, 'y': hy + 0x28}
                    putw(o, hx + 0x10); putw(o + 2, hy + 0x28); putw(o + 4, fill[4]); putw(o + 6, 1)
                    break
            log['placed'] = placed
            inp |= 0x80
        elif c == 816:
            put(0x366, [2, 2])
            inp &= ~0x02
        elif c == 817:
            inp &= ~0x02
        put(0x382, [inp])
        row = {'c': c, 'in': inp, **state()}
        if placed:
            row['obj'] = [word(DS, 0x8314 + 8 * placed['slot'] + k) for k in (0, 2, 4, 6)]
        log['ticks'].append(row)
        print(row, flush=True)
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump(log, open(__file__.rsplit('/', 1)[0] + f"/drop_live{'_natural' if natural else ''}.json", 'w'), indent=1)


if __name__ == '__main__':
    main()
