#!/usr/bin/env python3
"""rol_trace.py — trace ROL.EXE's sound-effect path live (GODS.INI = Roland).

DOSBox must be PAUSED at the start of demo NAME (armwait.py N), with GAME
running under ROL.EXE. Like sweep.py it writes the capture's random table
at tape cursor `inject`, then logs until the cursor passes `end`:
  - every GAME random read (CS:0x3836): cursor, DS:0x160, caller;
  - every ROL export-3 call: at ROL:0x376 the id (AL), ROL's own random
    state [cs:0x632] and GAME's DS:0x160; at ROL:0x3D4 the blob after the
    remap and variant (DL) and ROL's state again.
Writes NAME.rol.json.

  python3 armwait.py 2 && python3 rol_trace.py joyg1 1 400
"""
import json, sys
from sweep import DS, CS, SS, POLLER, RND, call, mem, word, wait_stop

ROL = 0x339E                     # sound driver segment (raw + GAME's 0x36D)


def main():
    name, inject, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
    snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
    st = call('GET', '/debug/status')
    assert st['debugging'], 'pause DOSBox first'
    assert mem(ROL, 0x376, 2) == bytes([0x3C, 0x28]), 'ROL.EXE is not at %04X' % ROL
    since = st['stop']['stop_id']
    cycler = mem(DS, 0x3E6, 1)[0]

    def go(bps):
        nonlocal since
        call('DELETE', '/debug/breakpoints')
        for bp in bps:
            call('POST', '/debug/breakpoints', bp)
        call('POST', '/debug/continue')
        s = wait_stop(since)
        since = s['stop_id']
        return s

    go([{'type': 'execute', 'segment': CS, 'offset': POLLER,
         'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': inject}}])
    call('PUT', f'/memory/{DS}/{0x7E14}', bytes.fromhex(snap[2]), raw=True)
    call('PUT', f'/memory/{DS}/{0x160}', int(snap[1]).to_bytes(2, 'little'), raw=True)
    bps = [{'type': 'execute', 'segment': CS, 'offset': RND},
           {'type': 'execute', 'segment': ROL, 'offset': 0x376},
           {'type': 'execute', 'segment': ROL, 'offset': 0x3D4}]
    log = []
    while True:
        s = go(bps)
        reg = s['registers']
        cur = word(DS, 0x282)
        if cur > end or mem(DS, 0x3E6, 1)[0] != cycler:
            break
        cs_, ip = reg['cs'], reg['eip'] & 0xFFFF
        rolst = int.from_bytes(mem(ROL, 0x632, 2), 'little')
        if cs_ == ROL and ip == 0x376:
            log.append({'c': cur, 'ev': 'play', 'id': reg['eax'] & 0xFFFF, 'rol': rolst, 'r': word(DS, 0x160)})
        elif cs_ == ROL:
            log.append({'c': cur, 'ev': 'blob', 'dl': reg['edx'] & 0xFF, 'rol': rolst, 'r': word(DS, 0x160)})
        else:
            log.append({'c': cur, 'ev': 'rnd', 'r': word(DS, 0x160),
                        'ret': hex(word(SS, reg['esp'] & 0xFFFF)), 'seg': hex(word(SS, (reg['esp'] + 2) & 0xFFFF))})
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump({'inject': inject, 'log': log}, open(f'{here}/{name}.rol.json', 'w'), indent=0)
    print(len(log), 'events; last cursor', cur, flush=True)


if __name__ == '__main__':
    main()
