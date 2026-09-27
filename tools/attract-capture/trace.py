#!/usr/bin/env python3
"""trace.py — log every hit of one code address over a cursor window of a
live attract demo, with the capture's random table injected (as sweep.py).

DOSBox must be PAUSED before `inject` with the demo running (arm.py N).
At each hit it records the tape cursor, DS:0x160, the registers, the
camera, and `DI`-relative words (the entity record for CS:0xF586).

  python3 trace.py joyl2 103 2025 2040 f586
  python3 trace.py joyl2 103 2090 2093 f5c3,f144 2ac:6 s1c70:190
Several addresses may be comma-separated; extra `off:len` ranges (hex,
DS, or SS with a leading `s`) are read at every hit.
Writes NAME.trace.json.
"""
import json, sys
from sweep import DS, CS, SS, POLLER, call, mem, word, wait_stop


def main():
    name, inject, lo, hi, addrs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), [int(a, 16) for a in sys.argv[5].split(',')]
    extra = [(SS if a[0] == 's' else DS, a) + tuple(int(v, 16) for v in a.lstrip('s').split(':'))
             for a in sys.argv[6:]]
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
    snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
    table = bytes.fromhex(snap[2])
    st = call('GET', '/debug/status')
    assert st['debugging'], 'pause DOSBox first'
    since = st['stop']['stop_id']
    cycler = mem(DS, 0x3E6, 1)[0]

    def run_to(cursor):
        nonlocal since
        call('DELETE', '/debug/breakpoints')
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': POLLER,
             'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': cursor}})
        call('POST', '/debug/continue')
        since = wait_stop(since)['stop_id']

    run_to(inject)
    call('PUT', f'/memory/{DS}/{0x7E14}', table, raw=True)
    run_to(lo)
    call('DELETE', '/debug/breakpoints')
    for addr in addrs:
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': addr})
    log = []
    while True:
        call('POST', '/debug/continue')
        s = wait_stop(since); since = s['stop_id']
        reg = s['registers']
        cur = word(DS, 0x282)
        if cur > hi or mem(DS, 0x3E6, 1)[0] != cycler:
            break
        di = reg['edi'] & 0xFFFF
        rec = mem(DS, di, 16)
        log.append({'c': cur, 'at': hex(reg['eip'] & 0xFFFF), 'r': word(DS, 0x160), 'di': hex(di),
                    'ranges': {k: mem(g, o, n).hex() for g, k, o, n in extra}, 'si': hex(reg['esi'] & 0xFFFF),
                    'cam': [word(DS, 0xA), word(DS, 0xC)], 'hero': [word(DS, 0x17A), word(DS, 0x17C)],
                    'rec': [int.from_bytes(rec[i:i + 2], 'little', signed=True) for i in range(0, 16, 2)]})
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump(log, open(f'{here}/{name}.trace.json', 'w'), indent=0)
    print(len(log), 'hits; last cursor', cur)


if __name__ == '__main__':
    main()
