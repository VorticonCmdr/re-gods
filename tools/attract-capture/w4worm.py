#!/usr/bin/env python3
"""w4worm.py — the world-4 worm live, with the hero kept alive (and firing).

w4live.py's 600 ticks never saw a worm hit or escape: the idle hero died
twice, and each respawn (C624) restarts the worm. This keeps him alive by
rewriting the health target/bar DS:0x192/0x19A = 24 at every tick start,
and (mode `fire`) holds FIRE on alternate ticks through the keyboard byte
DS:0x383 (the poller ORs it into DS:0x382; playback is off).

Per tick it logs what w4live.py logs, plus, for w4compare's replay of the
worm's hits: the damage grid DS:0x1666..0x1CA6 at the driver's entry
(CS:0xC978), and every tag -> damage decode the tick made (CS:0xAB41 AL,
then DS:0x1EA after CS:0x9320 returns at CS:0xAB45).

DOSBox may be running anywhere; the script waits for a joyg level load
(CS:0x2A37 with DS:0x3E7 = 1) and turns it into world 4 like w4live.py 3.

  python3 w4worm.py escape 700 w4escape.json
  python3 w4worm.py fire 700 w4fire.json [face]   (face: L or R, one tick first)
  python3 w4worm.py inject 700 w4inject.json 200-400
      (writes tag 0xFC under a live worm segment at CS:0xC978 on ticks 200..399)
"""
import base64, json, sys
from sweep import DS, CS, SS, call, mem, word, wait_stop

mode, n, fname = sys.argv[1], int(sys.argv[2]), sys.argv[3]
face = sys.argv[4] if len(sys.argv) > 4 and mode == 'fire' else None
inj = [int(v) for v in sys.argv[4].split('-')] if mode == 'inject' else None


def poke_worm():
    """Tag 0xFC (a starburst particle: 50 damage while [0x34] != 0) under the
    first stepping worm segment's 0x18 box, as CS:0xAA09's rounding sees it."""
    cam = (word(DS, 0xA), word(DS, 0xC))
    for k in range(8):
        r = mem(DS, 0xCF40 + 14 * k, 14)
        x, y = int.from_bytes(r[0:2], 'little', signed=True), int.from_bytes(r[2:4], 'little', signed=True)
        wait = int.from_bytes(r[4:6], 'little', signed=True)
        if wait >= 0 or int.from_bytes(r[10:12], 'little', signed=True) == -1:
            continue
        sx, sy = ((x - cam[0]) + 4) & ~7, ((y - cam[1]) + 4) & ~7
        di = 0x16CA + (sy >> 3) * 0x30 + (sx >> 3)
        for o in (0x31, 0x32, 0x61, 0x62):       # inside the box, clear of its edges
            if 0x1696 <= di + o < 0x1C42:
                put(DS, di + o, [0xFC])
        return
call('POST', '/debug/pause')
since = call('GET', '/debug/status')['stop']['stop_id']


def go(bps):
    global since
    call('DELETE', '/debug/breakpoints')
    for bp in bps:
        call('POST', '/debug/breakpoints', bp)
    call('POST', '/debug/continue')
    s = wait_stop(since)
    since = s['stop_id']
    return s


def ex(off, cond=None):
    bp = {'type': 'execute', 'segment': CS, 'offset': off}
    if cond:
        bp['condition'] = cond
    return bp


def put(seg, off, data):
    call('PUT', f'/memory/{seg}/{off}', bytes(data), raw=True)


go([ex(0x2A37, {'segment': DS, 'offset': 0x3E7, 'width': 1, 'op': 'eq', 'value': 1})])
put(DS, 0x42, [4])
go([ex(0x154)])
put(DS, 0x3BD, [0])
put(DS, 0x17A, [0x60, 0x0C]); put(DS, 0x17C, [0xC0, 0x00])
go([ex(0xC49C)])
print('selector 11; hero', hex(word(DS, 0x17A)), hex(word(DS, 0x17C)), flush=True)
out = []
go([ex(0x154)])                         # the first tick after the selector-11 tick
for t in range(n):
    rec = {'t': t, 'y250': word(DS, 0x250), 'm32': mem(DS, 0x32, 1)[0], 'd34': mem(DS, 0x34, 1)[0],
           'cam': [word(DS, 0xA), word(DS, 0xC)], 'hp': word(DS, 0x28A), 'thr': word(DS, 0x2E0),
           'boulder': mem(DS, 0xD030, 8).hex(), 'worm': mem(DS, 0xCF40, 8 * 14).hex(),
           'f2f0': word(DS, 0x2F0), 'cur310': word(DS, 0x310), 'rnd': word(DS, 0x160),
           'hero': [word(DS, 0x17A), word(DS, 0x17C)], 'hook': mem(CS, 0xCBC7, 1).hex(),
           'hh': [word(DS, 0x192), word(DS, 0x19A)], 'lives': word(DS, 0x224),
           'wormhp': word(DS, 0x30E), 'acct': mem(DS, 0x3DA, 2).hex(), 'destroyed': mem(DS, 0x3DB, 1)[0],
           'diff': mem(DS, 0x365, 1)[0]}
    put(DS, 0x192, [0x18, 0]); put(DS, 0x19A, [0x18, 0])
    key = 0
    if mode == 'fire':
        if face and t == 0:
            key = 0x04 if face == 'L' else 0x08
        elif t % 2 == 1:
            key = 0x80
    put(DS, 0x383, [key])
    rec['key'] = key
    s = go([ex(0xC978), ex(0x154)])
    if s['registers']['eip'] & 0xFFFF == 0xC978:
        if mode == 'inject' and inj[0] <= t < inj[1]:
            poke_worm()
        rec['grid'] = base64.b64encode(mem(DS, 0x1666, 0x640)).decode()
        rec['rC978'] = word(DS, 0x160)      # the random cursor as the driver starts
        if t == 0:
            rec['table'] = mem(DS, 0x7E14, 0x200).hex()
        decodes = []
        while True:
            s = go([ex(0xAB41), ex(0xAB45), ex(0x154)])
            at = s['registers']['eip'] & 0xFFFF
            if at == 0x154:
                break
            if at == 0xAB41:                 # AB40: the hit cell is [SI]; AL is the row counter
                decodes.append({'tag': mem(DS, s['registers']['esi'] & 0xFFFF, 1)[0]})
            else:
                decodes[-1]['dmg'] = word(DS, 0x1EA)
        rec['decodes'] = decodes
    out.append(rec)                     # now stopped at the next tick's CS:0x0154
    if t % 50 == 0:
        print('t', t, 'wormhp', rec['wormhp'], 'ghp', rec['hp'], 'decodes', len(rec.get('decodes', [])), flush=True)
put(DS, 0x383, [0])                     # release the keys, or FIRE stays held
json.dump(out, open(__file__.rsplit('/', 1)[0] + '/' + fname, 'w'), indent=0)
call('DELETE', '/debug/breakpoints')
call('POST', '/debug/continue')
print('logged', len(out), flush=True)
