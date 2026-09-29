#!/usr/bin/env python3
"""nest_live.py — the world-2 nest pool DS:0xcfcc across a real respawn.

UNKNOWN_cfcc_dormant_seed_observable / UNKNOWN_cfcc_pool_full_in_play.
DOSBox must be PAUSED at the start of the named demo (DS:0x3E6: 3 PJOYL2, 4 PJOYG2). At the poller
stop for cursor `at` the respawn point DS:0x16E/0x170 becomes (rx, ry) and
the health DS:0x192/0x19A is zeroed, so the game's own death and respawn
(FUN_1000_0845, the forced activation recompute CS:0x08EB) put the camera
there. The pool (10 records x 10 bytes: x, y, state, hp, timer) and the
object records of every type-115 nest are logged at each cursor after.
With `full`, the ten slots are first filled with inert far-away records
(x = 0x7000, state -4) so the respawn's activation meets a full pool.
The health poke and the pre-fill are not original mechanisms; what they
measure is.

  python3 armwait.py 3 && python3 nest_live.py joyl2 2 1000 2816 576 60      # PJOYL2, world 2A
  python3 armwait.py 3 && python3 nest_live.py joyl2 2 1000 2816 576 60 full
The respawn re-inits the camera only when DS:0x32 == 0 (CS:0x08C5); PJOYG2
runs world 2B's scripted camera (DS:0x32 = 4), so it cannot show a cut.
"""
import json, struct, sys
from sweep import DS, CS, POLLER, call, mem, word, wait_stop

demo = sys.argv[1]
inject, at, rx, ry, span = (int(a) for a in sys.argv[2:7])
full = 'full' in sys.argv[7:]
here = __file__.rsplit('/', 1)[0]
cap = json.load(open(f'{here}/{demo}.raw.json'))['output']
snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
table = bytes.fromhex(snap[2])
st = call('GET', '/debug/status')
assert st['debugging'], 'pause DOSBox first'
since = st['stop']['stop_id']
POOL, OBJS = 0xCFCC, 0x2A4E - 0x2A4E   # objects: see below


def run_to(c):
    global since
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': POLLER,
         'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': c}})
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def pool():
    raw = mem(DS, POOL, 100)
    out = []
    for i in range(10):
        x, y, stt, hp, t = struct.unpack('<5H', raw[i * 10:i * 10 + 10])
        if not x & 0x8000:
            out.append(f'{i}:{x},{y}:{s16(stt)}/{hp}/t{s16(t)}')
    return out


def poke(off, data):
    call('PUT', f'/memory/{DS}/{off}', data, raw=True)


run_to(inject)
poke(0x7E14, table)
run_to(at)
if full:
    poke(POOL, b''.join(struct.pack('<5H', 0x7000, 0x0100, 0xFFFC, 60, 39) for _ in range(10)))
poke(0x16E, struct.pack('<HH', rx, ry))
poke(0x192, b'\0\0'); poke(0x19A, b'\0\0')
log = []
for c in range(at + 1, at + span + 1):
    run_to(c)
    log.append({'c': c, 'hero': [s16(word(DS, 0x17A)), s16(word(DS, 0x17C))],
                'cam': [s16(word(DS, 0xA)), s16(word(DS, 0xC))], 'pool': pool()})
    print(log[-1], flush=True)
call('DELETE', '/debug/breakpoints')
call('POST', '/debug/pause')
json.dump(log, open(f'{here}/nest_live_{demo}{"_full" if full else ""}.json', 'w'), indent=0)
