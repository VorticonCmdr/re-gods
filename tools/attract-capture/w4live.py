#!/usr/bin/env python3
"""w4live.py — reach the world-4 guardian live and log the fight's first ticks.

DOSBox must be PAUSED at the level loader CS:0x2A37 (a breakpoint there).
  stage 1: patch [0x42]=4, [0x43]=0  -> 4A loads PGOD04.PAT into SS:0x500
  stage 2 (next loader stop): [0x42]=4, [0x43]=1 -> 4B keeps 4A's pattern
Then on the first gameplay tick: playback off ([0x3BD]=0), hero onto the
selector-11 cell (0xC60, 0xC0), and log from the selector-11 tick on.

  python3 w4live.py 1        (at the first loader stop)
  python3 w4live.py 2 N      (at the second; logs N ticks to w4live.json)
"""
import json, sys
from sweep import DS, CS, SS, call, mem, word, wait_stop

stage = int(sys.argv[1])
st = call('GET', '/debug/status')
assert st['debugging'], 'pause DOSBox first'
since = st['stop']['stop_id']


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


if stage == 1:
    put(DS, 0x42, [4, 0])
    run_to(0x2A37)                      # wait for the next level load
    print('at loader again, 42/43', mem(DS, 0x42, 2).hex(), 'SS:500', mem(SS, 0x500, 16).hex())
    sys.exit()

n = int(sys.argv[2])
put(DS, 0x42, [4, 1])
run_to(0x154)                           # first gameplay tick of 4B
print('4B running; SS:500', mem(SS, 0x500, 8).hex(), 'SS:4F20', mem(SS, 0x4F20, 8).hex())
put(DS, 0x3BD, [0])
put(DS, 0x17A, [0x60, 0x0C]); put(DS, 0x17C, [0xC0, 0x00])
run_to(0xC49C)                          # selector 11
print('selector 11 fired; hero', hex(word(DS, 0x17A)), hex(word(DS, 0x17C)))
out = []
for t in range(n):
    run_to(0x154)
    rec = {'t': t, 'y250': word(DS, 0x250), 'm32': mem(DS, 0x32, 1)[0], 'd34': mem(DS, 0x34, 1)[0],
           'cam': [word(DS, 0xA), word(DS, 0xC)], 'hp': word(DS, 0x28A), 'thr': word(DS, 0x2E0),
           'boulder': mem(DS, 0xD030, 8).hex(), 'worm': mem(DS, 0xCF40, 8 * 14).hex(),
           'f2f0': word(DS, 0x2F0), 'cur310': word(DS, 0x310), 'rnd': word(DS, 0x160),
           'hero': [word(DS, 0x17A), word(DS, 0x17C)], 'hook': mem(CS, 0xCBC7, 1).hex()}
    out.append(rec)
if n:
    rec['ss500'] = mem(SS, 0x500, 0xB8).hex()
    rec['pat'] = mem(SS, 0xE30, 0x1D2).hex()
    rec['bum'] = mem(SS, 0x4F20, 256).hex()
json.dump(out, open(__file__.rsplit('/', 1)[0] + '/w4live.json', 'w'), indent=0)
call('DELETE', '/debug/breakpoints')
print('logged', len(out))
