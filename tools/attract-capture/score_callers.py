#!/usr/bin/env python3
"""score_callers.py — every score add (CS:0x0C80 units byte, CS:0x0C8B the
hundreds byte, DL = the BCD amount) in one live attract demo between two
tape cursors, with its caller and the caller's caller.

DOSBox must be RUNNING the attract cycle; the random table is injected at
`inject` as in sweep.py.

  python3 score_callers.py joyl2 103 1600 1800   # writes joyl2.score_callers.json
"""
import json, sys
from sweep import call, mem, word, wait_stop, DS, CS, SS, POLLER

CYCLER = {'joyl1': 1, 'joyg1': 2, 'joyl2': 3, 'joyg2': 4, 'joyl3': 5, 'joyg3': 0}
ADDS = (0x0C80, 0x0C8B)


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
    call('PUT', f'/memory/{DS}/{0x7E14}', bytes.fromhex(snap[2]), raw=True)
    go([at_cursor(lo)])
    out = []
    watch = [{'type': 'execute', 'segment': CS, 'offset': o} for o in ADDS + (POLLER,)]
    while True:
        st = go(watch)
        r = st['registers']
        c = word(DS, 0x282)
        if c > hi or mem(DS, 0x3E6, 1)[0] != CYCLER[name]:
            break
        if r['eip'] == POLLER:
            continue
        sp = r['esp'] & 0xFFFF
        e = {'c': c, 'at': hex(r['eip']), 'dl': hex(r['edx'] & 0xFF),
             'stack': [hex(word(SS, sp + 2 * k)) for k in range(8)],
             'si': hex(r['esi'] & 0xFFFF), 'di': hex(r['edi'] & 0xFFFF), 'bp': hex(r['ebp'] & 0xFFFF)}
        out.append(e)
        print(e, flush=True)
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump(out, open(f'{here}/{name}.score_callers.json', 'w'), indent=0)


if __name__ == '__main__':
    main()
