#!/usr/bin/env python3
"""armwait.py N — arm.py N, then block until DOSBox is actually stopped at
the start of demo N (cycler DS:0x3E6 == N). Waits for the run to resume
first, so arm.py's own brief pause is not mistaken for the breakpoint.
Retries arming while demo N is already playing.

  python3 armwait.py 5 && python3 sweep.py joyl3 92 1000
"""
import subprocess, sys, time
from sweep import call, mem, DS

n = int(sys.argv[1])
here = __file__.rsplit('/', 1)[0]
while subprocess.run([sys.executable, f'{here}/arm.py', str(n)]).returncode != 0:
    time.sleep(20)
while call('GET', '/debug/status').get('debugging'):
    time.sleep(0.5)
while True:
    try:
        if call('GET', '/debug/status').get('debugging') and mem(DS, 0x3E6, 1)[0] == n:
            break
    except Exception as e:
        print('retry', e, flush=True)
    time.sleep(2)
print('stopped at demo', n, flush=True)
