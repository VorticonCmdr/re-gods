#!/usr/bin/env python3
"""peek.py — dump DS memory ranges at every tape cursor in [lo, hi] of one
live attract demo, with the capture's random table injected (as sweep.py).

DOSBox must be PAUSED before the demo's `inject` cursor, with the demo
running. Each stop is at the input poller CS:0x241D, i.e. the state at the
END of the previous tick. Ranges are `off:len` in hex, DS-relative.

  python3 peek.py joyl1 12 103 107 aec0:140 dd10:92
Writes NAME.peek.json: [{c, r, ranges: {off: hex}}].
"""
import json, sys
from sweep import API, DS, CS, POLLER, call, mem, word, wait_stop


def main():
    name, inject, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    ranges = [tuple(int(v, 16) for v in a.split(':')) for a in sys.argv[5:]]
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
    snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
    table = bytes.fromhex(snap[2])
    st = call('GET', '/debug/status')
    assert st['debugging'], 'pause DOSBox first'
    since = st['stop']['stop_id']
    cycler = mem(DS, 0x3E6, 1)[0]

    def run_to(cursor, op='eq'):
        nonlocal since
        call('DELETE', '/debug/breakpoints')
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': POLLER,
             'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': op, 'value': cursor}})
        call('POST', '/debug/continue')
        since = wait_stop(since)['stop_id']

    run_to(inject)
    call('PUT', f'/memory/{DS}/{0x7E14}', table, raw=True)
    out = []
    for c in range(lo, hi + 1):
        run_to(c)
        assert mem(DS, 0x3E6, 1)[0] == cycler
        out.append({'c': c, 'r': word(DS, 0x160),
                    'hero': [word(DS, 0x17A), word(DS, 0x17C)],
                    'ranges': {f'{o:x}': mem(DS, o, n).hex() for o, n in ranges}})
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump(out, open(f'{here}/{name}.peek.json', 'w'), indent=0)
    print('peeked', len(out))


if __name__ == '__main__':
    main()
