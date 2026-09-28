#!/usr/bin/env python3
"""w4ending.py N — log the world-4 ending tick by tick (DOSBox paused in it).
Stops early if a tick takes longer than 8 s (something blocking, e.g. a
screen waiting for input). Writes w4ending.json."""
import json, sys
from sweep import DS, CS, call, mem, word

n = int(sys.argv[1])
since = call('GET', '/debug/status')['stop']['stop_id']
call('DELETE', '/debug/breakpoints')
call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': 0x154})
out = []
for t in range(n):
    call('POST', '/debug/continue')
    s = call('GET', f'/debug/wait?since_stop_id={since}&timeout_ms=8000')
    if not s.get('satisfied'):
        print('blocked after', t, 'ticks'); break
    since = s['stop_id']
    out.append({'n11e': word(DS, 0x11E), 'b36a': mem(DS, 0x36A, 1)[0], 'msgs': mem(DS, 0x3D8, 1)[0],
                'b362': mem(DS, 0x362, 1)[0], 'b393': mem(DS, 0x393, 1)[0], 'y250': word(DS, 0x250),
                'lives': word(DS, 0x224), 'b34a': mem(DS, 0x34A, 1)[0], 'msg': mem(DS, 0x212, 2)[::-1].hex(),
                'hero': [word(DS, 0x17A), word(DS, 0x17C)]})
json.dump(out, open(__file__.rsplit('/', 1)[0] + '/w4ending.json', 'w'), indent=0)
print('logged', len(out))
