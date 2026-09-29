#!/usr/bin/env python3
"""syslive.py — stage a System A group live and log its leader/follower state.

Ranked item 68 (Gods docs): CS:0xEB37 elects a leader, stage 1 (CS:0xE6F1)
recruits followers into strategy 4 (CS:0xE7DB), and the leader writes a trail
ring at group runtime +0x18 (CS:0xE039). This logs all of it per tick.

DOSBox must be RUNNING the attract cycle. The script pauses, breaks on the
level loader CS:0x2A37 at a joyg load ([0x3E7] = 1), patches [0x42] = WORLD
(the cycler's own 0x2DF1 double-load then enters sublevel B), and on the
first gameplay tick turns playback off ([0x3BD] = 0) and puts the hero on
(HX, HY). Health is re-topped every tick so the hero survives.

Per tick (a stop at CS:0x0154) it records DS:0x160, the hero, and for every
live group runtime (SS:0x3768 + k*0xE4, [+0] != 0) the whole 0xE4-byte
runtime and its ten 0x28-byte entity records (DS:0xE96 + k*0x190).
Also dumps DS:0x40B0 (the runtime-built formation table) once.

  python3 syslive.py 2 160 32 400 sys2b.json
"""
import base64, json, sys
from sweep import DS, CS, SS, call, mem, word, wait_stop

world, hx, hy, n = (int(a) for a in sys.argv[1:5])
fname = sys.argv[5]
here = __file__.rsplit('/', 1)[0]

call('POST', '/debug/pause')
since = call('GET', '/debug/status')['stop']['stop_id']


def run_to(off, cond=None):
    global since
    call('DELETE', '/debug/breakpoints')
    bp = {'type': 'execute', 'segment': CS, 'offset': off}
    if cond: bp['condition'] = cond
    call('POST', '/debug/breakpoints', bp)
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


def put(seg, off, data):
    call('PUT', f'/memory/{seg}/{off}', bytes(data), raw=True)


def le(v):
    return [v & 0xff, (v >> 8) & 0xff]


run_to(0x2A37, {'segment': DS, 'offset': 0x3E7, 'width': 1, 'op': 'eq', 'value': 1})
print('joyg load; world was', mem(DS, 0x42, 2).hex(), flush=True)
put(DS, 0x42, [world])
run_to(0x154)
print('first tick; world/sub', mem(DS, 0x42, 2).hex(), flush=True)
put(DS, 0x3BD, [0])
put(DS, 0x17A, le(hx)); put(DS, 0x17C, le(hy))
table = base64.b64encode(mem(DS, 0x40B0, 0x500)).decode()
out = {'world': world, 'hero': [hx, hy], 'd40b0': table, 'b5': int(sys.argv[6], 16) if len(sys.argv) > 6 else 0, 'ticks': []}
for t in range(n):
    run_to(0x154)
    put(DS, 0x192, le(0x60)); put(DS, 0x19A, le(0x60))
    groups = []
    for k in range(10):
        rt = mem(SS, 0x3768 + k * 0xE4, 0xE4)
        if rt[0] == 0 and rt[1] == 0:
            continue
        ents = mem(DS, 0xE96 + k * 0x190, 0x190)
        groups.append({'k': k, 'rt': rt.hex(), 'ents': ents.hex()})
    out['ticks'].append({'t': t, 'rnd': word(DS, 0x160), 'hero': [word(DS, 0x17A), word(DS, 0x17C)],
                         'cam': [word(DS, 0xA), word(DS, 0xC)], 'groups': groups})
    if t % 50 == 0:
        print('tick', t, 'groups', [(g['k'], g['rt'][:8]) for g in groups], flush=True)
json.dump(out, open(f'{here}/{fname}', 'w'))
call('DELETE', '/debug/breakpoints')
call('POST', '/debug/continue')
print('logged', len(out['ticks']))
