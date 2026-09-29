#!/usr/bin/env python3
"""mask63_live.py — Gods ranked item 63, the objects load mask, live.

Reach world W through a joyg attract load (sublevel B; with `A`, both loader
stops are forced to sublevel A), stop the tape, teleport the hero, and read
the sprite descriptors (SS:0x1E00 + id*8: -(w-1), h-1, offset, segment).
  mask63_live.py load W [A]    DOSBox running in the attract cycle (ESC from
                               gameplay returns to it)
  mask63_live.py hero X Y N    paused at CS:0x154; N ticks after the move
  mask63_live.py desc id...    paused
Then let it run until the camera arrives, pause and screen_capture. The
captures and arena dumps in mask63/ came from this; object-mask-compare.mjs
diffs them against the port.
"""
import sys, time
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from sweep import DS, CS, SS, call, mem, word, wait_stop

def since():
    return call('GET', '/debug/status')['stop']['stop_id'] if call('GET','/debug/status').get('stop') else 0

def run_to(off, cond=None):
    st = call('GET', '/debug/status')
    if not st['debugging']:
        call('POST', '/debug/pause'); st = call('GET', '/debug/status')
    s = st['stop']['stop_id']
    call('DELETE', '/debug/breakpoints')
    bp = {'type': 'execute', 'segment': CS, 'offset': off}
    if cond: bp['condition'] = cond
    call('POST', '/debug/breakpoints', bp)
    call('POST', '/debug/continue')
    return wait_stop(s)

def put(seg, off, data):
    call('PUT', f'/memory/{seg}/{off}', bytes(data), raw=True)

cmd = sys.argv[1]
if cmd == 'load':
    w = int(sys.argv[2]); subA = len(sys.argv) > 3
    run_to(0x2A37, {'segment': DS, 'offset': 0x3E7, 'width': 1, 'op': 'eq', 'value': 1})
    print('loader; 42/43', mem(DS, 0x42, 2).hex())
    if subA:
        put(DS, 0x42, [w, 0])
        run_to(0x2A37)                         # the 0x2DF1 reload -> force A again
        print('reload; 42/43', mem(DS, 0x42, 2).hex())
        put(DS, 0x42, [w, 0])
    else:
        put(DS, 0x42, [w])
    run_to(0x154)
    put(DS, 0x3BD, [0])
    print('tick; world/sub', mem(DS, 0x42, 2).hex(), 'hero', word(DS,0x17A), word(DS,0x17C))
elif cmd == 'hero':
    x, y, n = map(int, sys.argv[2:5])
    put(DS, 0x17A, x.to_bytes(2,'little')); put(DS, 0x17C, y.to_bytes(2,'little'))
    for _ in range(n): run_to(0x154)
    print('hero', word(DS,0x17A), word(DS,0x17C), 'cam', word(DS,0xA), word(DS,0xC), 'world/sub', mem(DS,0x42,2).hex())
elif cmd == 'desc':
    base = word(DS, 0xE)
    for i in sys.argv[2:]:
        i = int(i)
        print(i, mem(SS, base + i*8, 8).hex())
call('DELETE', '/debug/breakpoints')
