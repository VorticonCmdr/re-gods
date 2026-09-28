#!/usr/bin/env python3
"""brood_live.py — the world-2 nest's brood (DS:0x8014, 16 records of 16
bytes, walked by CS:0x894E) at every tick of a live attract demo, with the
capture's random table injected as sweep.py does.

Each poller stop between `lo` and `hi` records the 16 slots as signed words
{x, y, frame(+4), strength(+6), vx(+8), vy(+A), fall(+C)}, the hero, the
score and the seeds DOS carried in. DOSBox must be RUNNING the attract cycle.

  python3 brood_live.py joyl2 103 1880 1935     # writes joyl2.brood.json
"""
import json, sys
from sweep import call, mem, word, wait_stop, DS, CS, POLLER

CYCLER = {'joyl1': 1, 'joyg1': 2, 'joyl2': 3, 'joyg2': 4, 'joyl3': 5, 'joyg3': 0}


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def main():
    name, inject, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
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
        if mem(DS, 0x3E6, 1)[0] == CYCLER[name]:
            break
    seeds = {'gravity': word(DS, 0x1D4), 'jaw': word(DS, 0x2F0), 'land': mem(DS, 0x357, 1)[0],
             'r_live': word(DS, 0x160), 'r_cap': int(snap[1])}
    call('PUT', f'/memory/{DS}/{0x7E14}', bytes.fromhex(snap[2]), raw=True)
    go([at_cursor(lo)])
    rows = []
    tick = [{'type': 'execute', 'segment': CS, 'offset': POLLER}]
    while True:
        c = word(DS, 0x282)
        if c > hi or mem(DS, 0x3E6, 1)[0] != CYCLER[name]:
            break
        raw = mem(DS, 0x8014, 256)
        slots = []
        for k in range(16):
            b = raw[16 * k:16 * k + 16]
            w = [s16(int.from_bytes(b[i:i + 2], 'little')) for i in range(0, 14, 2)]
            if w[2] >= 0:
                slots.append([k] + w)
        score = int(''.join(f'{b:02x}' for b in reversed(mem(DS, 0x3B5, 4))))
        rows.append({'c': c, 'hero': [word(DS, 0x17A), word(DS, 0x17C)], 'score': score, 'slots': slots})
        print(rows[-1], flush=True)
        go(tick)
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump({'inject': inject, 'seeds': seeds, 'rows': rows}, open(f'{here}/{name}.brood.json', 'w'), indent=0)


if __name__ == '__main__':
    main()
