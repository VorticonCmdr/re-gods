#!/usr/bin/env python3
"""peek.py — dump DS memory ranges at every tape cursor in [lo, hi] of one
live attract demo, with the capture's random table injected (as sweep.py).

DOSBox must be PAUSED before the demo's `inject` cursor, with the demo
running. Each stop is at the input poller CS:0x241D, i.e. the state at the
END of the previous tick. Ranges are `off:len` in hex, DS-relative;
a leading `s` (`s4840:78`) reads SS instead.

  python3 peek.py joyl1 12 103 107 aec0:140 dd10:92
  python3 peek.py joyl2 103 100-106,1417-1419 0 36c:1      (`lo` may be a list)
Writes NAME.peek.json: [{c, r, ranges: {off: hex}}].
"""
import json, sys
from sweep import API, DS, CS, SS, POLLER, call, mem, word, wait_stop


def main():
    name, inject = sys.argv[1], int(sys.argv[2])
    first = 4 if '-' in sys.argv[3] else 5          # the list form has no `hi`
    if '-' in sys.argv[3]:
        cursors = [c for part in sys.argv[3].split(',')
                   for a, b in [map(int, part.split('-'))] for c in range(a, b + 1)]
    else:
        cursors = list(range(int(sys.argv[3]), int(sys.argv[4]) + 1))
    ranges = [(SS if a[0] == 's' else DS,) + tuple(int(v, 16) for v in a.lstrip('s').split(':'))
              for a in sys.argv[first:]]
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

    out = []
    for c in sorted(set(cursors) | {inject}):
        run_to(c)
        assert mem(DS, 0x3E6, 1)[0] == cycler
        if c == inject:
            call('PUT', f'/memory/{DS}/{0x7E14}', table, raw=True)
        if c not in cursors:
            continue
        out.append({'c': c, 'r': word(DS, 0x160),
                    'hero': [word(DS, 0x17A), word(DS, 0x17C)],
                    'ranges': {('s' if g == SS else '') + f'{o:x}': mem(g, o, n).hex() for g, o, n in ranges}})
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump(out, open(f'{here}/{name}.peek.json', 'w'), indent=0)
    print('peeked', len(out))


if __name__ == '__main__':
    main()
