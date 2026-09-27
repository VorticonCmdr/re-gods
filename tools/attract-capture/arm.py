#!/usr/bin/env python3
"""arm.py N — pause DOSBox and break at the input poller once the attract
cycler DS:0x3E6 becomes N (the start of that demo). Refuses while N is
already playing, since the trap would then fire mid-demo."""
import sys
from sweep import call, mem, DS, CS, POLLER
n = int(sys.argv[1])
call('POST', '/debug/pause')
call('DELETE', '/debug/breakpoints')
if mem(DS, 0x3E6, 1)[0] == n:
    call('POST', '/debug/continue')
    sys.exit(f'demo {n} is playing now; arm again later')
call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': POLLER,
     'condition': {'segment': DS, 'offset': 0x3E6, 'width': 1, 'op': 'eq', 'value': n}})
call('POST', '/debug/continue')
print('armed for', n)
