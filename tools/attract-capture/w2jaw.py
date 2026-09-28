#!/usr/bin/env python3
"""w2jaw.py — end the current game, wait for the joyg2 demo, and read the
world-2 guardian's first driver call: [0x2F0], [0x36D], and REC4 (the jaw's
hit box, SS:0x4860) once CS:0xCF52's draw has built it (at CS:0xCD9D)."""
from sweep import DS, CS, SS, call, mem, word, wait_stop

call('POST', '/debug/pause')
since = call('GET', '/debug/status')['stop']['stop_id']
put = lambda off, data: call('PUT', f'/memory/{DS}/{off}', bytes(data), raw=True)
put(0x224, [0, 0]); put(0x3B5, [0, 0, 0, 0]); put(0x192, [0, 0]); put(0x19A, [0, 0])


def run_to(off, cond=None):
    global since
    call('DELETE', '/debug/breakpoints')
    bp = {'type': 'execute', 'segment': CS, 'offset': off}
    if cond: bp['condition'] = cond
    call('POST', '/debug/breakpoints', bp)
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


run_to(0x2A37, {'segment': DS, 'offset': 0x3E6, 'width': 1, 'op': 'eq', 'value': 4})
print('joyg2 load: 2f0', hex(word(DS, 0x2F0)), '42', mem(DS, 0x42, 2).hex(), flush=True)
run_to(0xCD7B)
print('first w2 driver call: 2f0', hex(word(DS, 0x2F0)), '36d', mem(DS, 0x36D, 1)[0],
      'x/y', hex(word(DS, 0x28C)), hex(word(DS, 0x28E)), 'cam', hex(word(DS, 0xA)), hex(word(DS, 0xC)), flush=True)
run_to(0xCD9D)
r = mem(SS, 0x4860, 8)
print('REC4', [int.from_bytes(r[i:i + 2], 'little', signed=True) for i in range(0, 8, 2)],
      '2f0', hex(word(DS, 0x2F0)), 'hx/hy', word(DS, 0x2D8), word(DS, 0x2DA), flush=True)
run_to(0xCD7B)
run_to(0xCD9D)
r = mem(SS, 0x4860, 8)
print('next call REC4', [int.from_bytes(r[i:i + 2], 'little', signed=True) for i in range(0, 8, 2)],
      '2f0', hex(word(DS, 0x2F0)), '36d', mem(DS, 0x36D, 1)[0], flush=True)
call('DELETE', '/debug/breakpoints')
