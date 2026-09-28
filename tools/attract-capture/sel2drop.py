#!/usr/bin/env python3
"""sel2drop.py — does killing world 1's selector-2 class 30 drop a SPIKE?

PLEV1A/1B event 78 (cell 608,352) arms selector-2 class 30, whose PALFILS
+0x0E reward byte is 61 (0x3D) -> CS:0xC059 `id - 0xB` = object type 50.

DOSBox must be PAUSED. Stage 1 waits for a joyg level load (CS:0x2A37 with
[0x3E7]=1), patches [0x42]=1 (the cycler's 0x2DF1 reload enters 1B), turns
playback off, puts the hero on the event cell and runs to the allocator
CS:0xAD0D and prints the slot. sel2contact.py then does the kill.

  python3 sel2drop.py 1
"""
import sys
from sweep import DS, CS, call, mem, word, wait_stop

st = call('GET', '/debug/status')
assert st['debugging'], 'pause DOSBox first'
since = st['stop']['stop_id']


def run_to(*offs):
    global since
    call('DELETE', '/debug/breakpoints')
    for off in offs:
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off})
    call('POST', '/debug/continue')
    s = wait_stop(since)
    since = s['stop_id']
    return s['stop']['registers'] if 'stop' in s else call('GET', '/debug/status')['stop']['registers']


def put(seg, off, data):
    call('PUT', f'/memory/{seg}/{off}', bytes(data), raw=True)


def w(v):
    return [v & 0xFF, (v >> 8) & 0xFF]


if sys.argv[1] == '1':
    while True:
        run_to(0x2A37)
        if mem(DS, 0x3E7, 1)[0] == 1:
            break
    put(DS, 0x42, [1])
    run_to(0x154)
    print('level', mem(DS, 0x42, 2).hex())
    put(DS, 0x3BD, [0])
    hx, hy = 600, 352
    put(DS, 0x17A, w(hx)); put(DS, 0x17C, w(hy))
    put(DS, 0xA, w(hx - 0x90)); put(DS, 0xC, w(hy - 0x48))
    r = run_to(0xAD0D)
    print('allocator hit, regs', {k: hex(v) for k, v in r.items() if k in ('eax', 'ebx', 'ecx', 'edx', 'esi', 'edi')})
    for _ in range(3):
        run_to(0x154)
    print('slots', mem(DS, 0xAEC0, 0x140).hex())
else:
    print('slots', mem(DS, 0xAEC0, 0x140).hex())
