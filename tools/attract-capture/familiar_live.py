#!/usr/bin/env python3
"""familiar_live.py — summon a familiar live in an attract demo and log it.

No attract demo has a familiar, so this injects one into a demo that
already replays exactly (PJOYL3's world-3 gameplay). DOSBox must be PAUSED
at the start of the demo (armwait.py 5). The script:
  1. records the cross-cycle bytes the port has to be seeded with
     (DS:0x2F0 jaw, DS:0x1D4 starburst gravity phase, DS:0x357 land flag);
  2. runs to tape cursor `inject` and writes the capture's random table and
     cursor there (as sweep.py), so the live run replays the recorded one;
  3. runs to CS:0x0215 (the familiar tick's call) on the first tick with
     tape cursor `at`, and for that one call makes it run the SUMMON:
     the call's target becomes CS:0xC308 (C308 falls into C35E) and C35E's
     RET at CS:0xC43F becomes `jmp 0xC08E`, so the one call is
     summon + slot choice + the tick — the order the port uses;
  4. restores both patches at CS:0x0218, then logs the familiar at every
     CS:0x0218 (right after its tick) until the tape cursor passes `end`.
Writes familiar_live.json.

  python3 armwait.py 5 && python3 familiar_live.py joyl3 92 760 1100
"""
import json, sys
from sweep import DS, CS, POLLER, call, mem, word, wait_stop

FIELDS = {'x': 0x16A, 'y': 0x16C, 'vx': 0x2FC, 'vy': 0x2FE, 'face': 0x300, 'anim': 0x302,
          'dx': 0x308, 'dy': 0x30A, 'spr': 0x30C, 'energy': 0x168, 'power': 0x210,
          'wings': 0x304, 'r': 0x160, 'hx': 0x17A, 'hy': 0x17C, 'camX': 0xA, 'camY': 0xC,
          'cur': 0x282}


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def main():
    name, inject, at, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
    snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
    st = call('GET', '/debug/status')
    assert st['debugging'], 'pause DOSBox first'
    since = st['stop']['stop_id']
    cycler = mem(DS, 0x3E6, 1)[0]
    seeds = {'jaw': word(DS, 0x2F0), 'gravity': word(DS, 0x1D4), 'land': mem(DS, 0x357, 1)[0]}

    def go(bps):
        nonlocal since
        call('DELETE', '/debug/breakpoints')
        for bp in bps:
            call('POST', '/debug/breakpoints', bp)
        call('POST', '/debug/continue')
        s = wait_stop(since)
        since = s['stop_id']
        return s

    at_cursor = lambda off, c: {'type': 'execute', 'segment': CS, 'offset': off,
                                'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': c}}
    go([at_cursor(POLLER, inject)])
    call('PUT', f'/memory/{DS}/{0x7E14}', bytes.fromhex(snap[2]), raw=True)
    call('PUT', f'/memory/{DS}/{0x160}', int(snap[1]).to_bytes(2, 'little'), raw=True)

    go([at_cursor(0x215, at)])
    orig_call, orig_ret = mem(CS, 0x215, 3), mem(CS, 0xC43F, 3)
    rel = (0xC308 - 0x218) & 0xFFFF
    call('PUT', f'/memory/{CS}/{0x215}', bytes([0xE8, rel & 0xFF, rel >> 8]), raw=True)
    rel = (0xC08E - (0xC43F + 3)) & 0xFFFF
    call('PUT', f'/memory/{CS}/{0xC43F}', bytes([0xE9, rel & 0xFF, rel >> 8]), raw=True)
    go([{'type': 'execute', 'segment': CS, 'offset': 0x218}])
    call('PUT', f'/memory/{CS}/{0x215}', orig_call, raw=True)
    call('PUT', f'/memory/{CS}/{0xC43F}', orig_ret, raw=True)

    log = []
    while True:
        row = {k: s16(word(DS, o)) for k, o in FIELDS.items()}
        row['alt'] = mem(DS, 0x33D, 1)[0]
        row['gate'] = mem(DS, 0x343, 1)[0]
        log.append(row)
        if row['cur'] > end or mem(DS, 0x3E6, 1)[0] != cycler:
            break
        go([{'type': 'execute', 'segment': CS, 'offset': 0x218}])
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump({'seeds': seeds, 'inject': inject, 'at': at, 'rows': log},
              open(f'{here}/familiar_live.json', 'w'), indent=0)
    print(len(log), 'rows; seeds', seeds, 'first', log[0], flush=True)


if __name__ == '__main__':
    main()
