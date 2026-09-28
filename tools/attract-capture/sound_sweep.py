#!/usr/bin/env python3
"""sound_sweep.py — log every sound PLAY and STOP of one live attract demo.

Like sweep.py (DOSBox PAUSED before the demo's `inject` cursor, the capture's
random table written there), but breaks on the two sound exports only:
  CS:0x22CA  play (export 3), AX = sfx id
  CS:0x22D6  stop (export 5), AX = the id to stop
logging cursor / kind / id / caller ([SP]), until the tape cursor passes
`end` or the cycler moves on. The existing sweeps logged CS:0x22CA only, so
no stop had ever been seen live. Optional DS pokes at the inject cursor as
sweep.py (`off:hexbytes`). Writes NAME.sound.json.

  python3 armwait.py 1 && python3 sound_sweep.py joyl1 12 900
"""
import json, sys
from sweep import DS, CS, SS, POLLER, call, mem, word, wait_stop

PLAY, STOP = 0x22CA, 0x22D6


def main():
    name, inject, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    pokes = [(int(a.split(':')[0], 16), bytes.fromhex(a.split(':')[1])) for a in sys.argv[4:]]
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
    snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
    st = call('GET', '/debug/status')
    assert st['debugging'], 'pause DOSBox first'
    since = st['stop']['stop_id'] if st.get('stop') else 0
    cycler = mem(DS, 0x3E6, 1)[0]

    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': POLLER,
         'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': inject}})
    call('POST', '/debug/continue')
    s = wait_stop(since); since = s['stop_id']
    assert mem(DS, 0x3E6, 1)[0] == cycler, 'cycler moved before the inject cursor'
    call('PUT', f'/memory/{DS}/{0x7E14}', bytes.fromhex(snap[2]), raw=True)
    call('PUT', f'/memory/{DS}/{0x160}', int(snap[1]).to_bytes(2, 'little'), raw=True)
    for off, data in pokes:
        call('PUT', f'/memory/{DS}/{off}', data, raw=True)

    call('DELETE', '/debug/breakpoints')
    for off in (PLAY, STOP):
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off})
    log = []
    while True:
        call('POST', '/debug/continue')
        s = wait_stop(since); since = s['stop_id']
        reg = s['registers']
        cur = word(DS, 0x282)
        if cur > end or mem(DS, 0x3E6, 1)[0] != cycler:
            break
        log.append({'c': cur, 'k': 'play' if reg['eip'] == PLAY else 'stop',
                    'id': hex(reg['eax'] & 0xFFFF), 'ret': hex(word(SS, reg['esp'] & 0xFFFF))})
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump({'inject': inject, 'end': end, 'log': log}, open(f'{here}/{name}.sound.json', 'w'), indent=0)
    print(len(log), 'events; last cursor', cur)


if __name__ == '__main__':
    main()
