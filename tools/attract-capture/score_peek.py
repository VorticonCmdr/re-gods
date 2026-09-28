#!/usr/bin/env python3
"""score_peek.py — the BCD score DS:0x3B5-0x3B8 at every tape cursor of one
live attract demo, with the capture's random table injected (as sweep.py).

DOSBox must be RUNNING the attract cycle; the script pauses it, waits for
the demo's inject cursor, then logs the four score bytes (and the money
DS:0x194/0x196) at each poller stop until `end`.

  python3 score_peek.py joyl2 103 1900      # writes joyl2.score.json
"""
import json, sys
from sweep import call, mem, word, wait_stop, DS, CS, POLLER

CYCLER = {'joyl1': 1, 'joyg1': 2, 'joyl2': 3, 'joyg2': 4, 'joyl3': 5, 'joyg3': 0}


def main():
    name, inject, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
    snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
    table = bytes.fromhex(snap[2])
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

    at = {'type': 'execute', 'segment': CS, 'offset': POLLER,
          'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': inject}}
    while True:
        go([at])
        if mem(DS, 0x3E6, 1)[0] == CYCLER[name]:
            break
    r_live = word(DS, 0x160)
    call('PUT', f'/memory/{DS}/{0x7E14}', table, raw=True)
    call('PUT', f'/memory/{DS}/{0x160}', int(snap[1]).to_bytes(2, 'little'), raw=True)   # the random cursor too
    seeds = {'gravity': word(DS, 0x1D4), 'jaw': word(DS, 0x2F0), 'land': mem(DS, 0x357, 1)[0],
             'r_live': r_live, 'r_cap': int(snap[1])}
    print(seeds, flush=True)
    rows, last = [], None
    tick = [{'type': 'execute', 'segment': CS, 'offset': POLLER}]
    while True:
        c = word(DS, 0x282)
        if c > end or mem(DS, 0x3E6, 1)[0] != CYCLER[name]:
            break
        score = mem(DS, 0x3B5, 4).hex()
        money = word(DS, 0x194) | (word(DS, 0x196) << 16)
        if (score, money) != last:
            rows.append({'c': c, 'score': score, 'money': money})
            print(rows[-1], flush=True)
            last = (score, money)
        go(tick)
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump({'inject': inject, 'seeds': seeds, 'rows': rows}, open(f'{here}/{name}.score.json', 'w'), indent=0)


if __name__ == '__main__':
    main()
