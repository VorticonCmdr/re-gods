#!/usr/bin/env python3
"""barrier_live.py — arm line barriers live and log them, tick by tick.

No attract demo moves a barrier on screen, so this puts the hero where one
is armed. DOSBox must be PAUSED at the start of a demo whose level has one
(armwait.py 4 = PJOYG2, world 2B). Each STEP is `cursor:hx:hy:cx:cy`: at the
first rescan of tape cursor >= `cursor` the hero DS:0x17A/0x17C becomes
(hx, hy), so that tick's plane-B probe (CS:0x5FAB: column (X+16)>>5, rows
Y>>4 .. +2) dispatches the barrier's event by the game's own path; and from
then on the camera DS:0xA/0xC is written as (cx, cy) at every rescan (cx < 0
leaves it alone), which is where CS:0x7720 reads it.
Logged, for `ticks` rescans:
  CS:0x01F2 / 0x09C7 / 0x9260  (entering the rescan FUN_1000_767A: the main
                      loop, the death driver, the respawn tick) camera,
                      DS:0x364, DS:0x395, slots
  CS:0x01F5 / 0x09CA / 0x9263  (after it) every armed slot, DS:0x395
  CS:0x22CA / 0x22D6  sound play / stop: id, caller
The teleport and the camera pin are not original mechanisms; what they
measure is. Writes barrier_live.json (or `--out FILE`).

  python3 armwait.py 4 && python3 barrier_live.py 300 60:800:64:640:0
  python3 armwait.py 4 && python3 barrier_live.py 400 60:480:96:320:0 140:800:64:640:0 --out barrier_live2.json
"""
import json, sys
from sweep import DS, CS, SS, call, mem, word, wait_stop

SLOTS, STRIDE = 0x1CA6, 0x18
PRE, POST = (0x01F2, 0x09C7, 0x9260), (0x01F5, 0x09CA, 0x9263)


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def slots():
    raw = mem(DS, SLOTS, STRIDE * 25)
    out = {}
    for i in range(25):
        b = raw[i * STRIDE:(i + 1) * STRIDE]
        if (b[4] & 0x80) == 0:                        # +4 sign bit clear = armed
            out[i] = {'x': s16(int.from_bytes(b[0:2], 'little')), 'y': s16(int.from_bytes(b[2:4], 'little')),
                      'd4': b[4], 'd5': b[5], 'raw': b.hex()}
    return out


def poke(off, v):
    call('PUT', f'/memory/{DS}/{off}', (v & 0xFFFF).to_bytes(2, 'little'), raw=True)


def main():
    args = sys.argv[1:]
    out = 'barrier_live.json'
    if '--out' in args:
        i = args.index('--out'); out = args[i + 1]; del args[i:i + 2]
    ticks = int(args[0])
    steps = [dict(zip(('c', 'hx', 'hy', 'cx', 'cy'), (int(v) for v in a.split(':')))) for a in args[1:]]
    here = __file__.rsplit('/', 1)[0]
    st = call('GET', '/debug/status')
    assert st['debugging'], 'pause DOSBox first'
    since = st['stop']['stop_id']
    cycler = mem(DS, 0x3E6, 1)[0]
    world = (mem(DS, 0x42, 1)[0], mem(DS, 0x43, 1)[0])

    call('DELETE', '/debug/breakpoints')
    for o in PRE + POST + (0x22CA, 0x22D6):
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': o})
    log, n, pin, pending = [], 0, None, list(steps)
    while n < ticks:
        call('POST', '/debug/continue')
        s = wait_stop(since); since = s['stop_id']
        reg = s['registers']
        ip = reg['eip'] & 0xFFFF
        cur = word(DS, 0x282)
        if mem(DS, 0x3E6, 1)[0] != cycler:
            break
        if ip in PRE:
            if pending and cur >= pending[0]['c']:
                p = pending.pop(0)
                poke(0x17A, p['hx']); poke(0x17C, p['hy'])
                pin = p if p['cx'] >= 0 else None
                log.append({'c': cur, 'ev': 'teleport', **p})
            if pin:
                poke(0xA, pin['cx']); poke(0xC, pin['cy'])
            log.append({'c': cur, 'ev': 'pre', 'death': ip == 0x09C7, 'respawn': ip == 0x9260, 'camX': s16(word(DS, 0xA)),
                        'camY': s16(word(DS, 0xC)), 'n364': mem(DS, 0x364, 1)[0], 'b395': mem(DS, 0x395, 1)[0],
                        'hx': s16(word(DS, 0x17A)), 'hy': s16(word(DS, 0x17C)), 'slots': slots()})
        elif ip in POST:
            log.append({'c': cur, 'ev': 'post', 'b395': mem(DS, 0x395, 1)[0],
                        'n364': mem(DS, 0x364, 1)[0], 'slots': slots()})
            n += 1
        else:
            log.append({'c': cur, 'ev': 'play' if ip == 0x22CA else 'stop',
                        'id': hex(reg['eax'] & 0xFFFF), 'ret': hex(word(SS, reg['esp'] & 0xFFFF))})
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump({'steps': steps, 'world': world, 'cycler': cycler, 'roland': mem(DS, 0x85, 1)[0] == 2, 'log': log},
              open(f'{here}/{out}', 'w'), indent=0)
    print(len(log), 'events; world', world, 'rescans', n, flush=True)


if __name__ == '__main__':
    main()
