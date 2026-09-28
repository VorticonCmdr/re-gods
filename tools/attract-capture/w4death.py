#!/usr/bin/env python3
"""w4death.py — force the live world-4 guardian's death and log the ending.

DOSBox must be PAUSED inside the fight (w4live.py leaves it at CS:0x0154).
The driver's first bytes (CS:0xC978) become `jmp 0xC758` for one tick, so
that call runs the real death path (D923, CC67 un-RET, C64C) and returns.
Then N ticks are logged: DS:0x11E, 0x36A, 0x3D8, 0x362, 0x393, 0x394,
0x250, lives 0x224, 0x34A, 0x3BE, the score, the message buffer and the
object table's live count. Writes w4death.json.

  python3 w4death.py N
"""
import json, sys
from sweep import DS, CS, call, mem, word, wait_stop

n = int(sys.argv[1])
st = call('GET', '/debug/status')
assert st['debugging'], 'pause DOSBox first'
since = st['stop']['stop_id']


def run_to(off):
    global since
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off})
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


def put(seg, off, data):
    call('PUT', f'/memory/{seg}/{off}', bytes(data), raw=True)


orig = mem(CS, 0xC978, 3)
rel = (0xC758 - (0xC978 + 3)) & 0xFFFF
put(CS, 0xC978, [0xE9, rel & 0xFF, rel >> 8])
run_to(0x154)
put(CS, 0xC978, orig)
out = []
for t in range(n):
    out.append({'t': t, 'n11e': word(DS, 0x11E), 'b36a': mem(DS, 0x36A, 1)[0], 'msgs': mem(DS, 0x3D8, 1)[0],
                'b362': mem(DS, 0x362, 1)[0], 'b393': mem(DS, 0x393, 1)[0], 'b394': mem(DS, 0x394, 1)[0],
                'y250': word(DS, 0x250), 'lives': word(DS, 0x224), 'b34a': mem(DS, 0x34A, 1)[0],
                'b3be': mem(DS, 0x3BE, 1)[0], 'score': mem(DS, 0x3B5, 4).hex(), 'd34': mem(DS, 0x34, 1)[0],
                'cc67': mem(CS, 0xCC67, 1).hex(), 'hp': word(DS, 0x28A), 'hero': [word(DS, 0x17A), word(DS, 0x17C)]})
    run_to(0x154)
json.dump(out, open(__file__.rsplit('/', 1)[0] + '/w4death.json', 'w'), indent=0)
call('DELETE', '/debug/breakpoints')
print('logged', len(out))
