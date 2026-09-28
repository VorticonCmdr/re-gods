#!/usr/bin/env python3
"""forcedeath.py — make a live guardian die on a chosen tick, then dump.

DOSBox must be PAUSED before `inject` with the demo running (armwait.py N).
At the poller stop for cursor `at` it patches the guardian driver's first
bytes to `jmp 0xD923` (so the next driver call runs the shared death and
returns), restores them one tick later, and peeks DS ranges at cursors
at+1 .. at+span.

  python3 forcedeath.py joyg1 2 60 d866 6 8cfa:1e0 b654:64 3be:1 34:1 160:2
Writes NAME.death.json.
"""
import json, struct, sys
from sweep import DS, CS, POLLER, call, mem, word, wait_stop

name, inject, at, span = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[5])
# `drv` or `drv>target`: patch drv's first bytes to jmp target (default the shared death 0xD923)
drv, _, tgt = sys.argv[4].partition('>')
drv, tgt = int(drv, 16), int(tgt or 'd923', 16)
ranges = [tuple(int(v, 16) for v in a.split(':')) for a in sys.argv[6:]]
here = __file__.rsplit('/', 1)[0]
cap = json.load(open(f'{here}/{name}.raw.json'))['output']
snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
table = bytes.fromhex(snap[2])
st = call('GET', '/debug/status')
assert st['debugging'], 'pause DOSBox first'
since = st['stop']['stop_id']


def run_to(c):
    global since
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': POLLER,
         'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': c}})
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


run_to(inject)
call('PUT', f'/memory/{DS}/{0x7E14}', table, raw=True)
run_to(at)
orig = mem(CS, drv, 3)
rel = (tgt - (drv + 3)) & 0xFFFF
call('PUT', f'/memory/{CS}/{drv}', bytes([0xE9, rel & 0xFF, rel >> 8]), raw=True)
out = []
for c in range(at + 1, at + span + 1):
    run_to(c)
    if c == at + 1:
        call('PUT', f'/memory/{CS}/{drv}', orig, raw=True)
    out.append({'c': c, 'r': word(DS, 0x160), 'score': mem(DS, 0x3B5, 4).hex(),
                'ranges': {f'{o:x}': mem(DS, o, n).hex() for o, n in ranges}})
call('DELETE', '/debug/breakpoints')
call('POST', '/debug/continue')
json.dump(out, open(f'{here}/{name}.death.json', 'w'), indent=0)
print('dumped', len(out))
