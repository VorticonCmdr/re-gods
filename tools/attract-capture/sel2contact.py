#!/usr/bin/env python3
"""sel2contact.py — re-seed the class-30 selector-2 slot (DS:0xAEC0) and its
entity (DS:0xB000) to the bytes captured right after a fresh allocation by
sel2drop.py, put the hero on the entity so the shared contact test
(CS:0xAC59) kills it, then log the toss (CS:0xBF5F) / landing (CS:0xC041)
registers and the resulting object's y for 30 ticks."""
from sweep import DS, CS, SS, call, mem, word, wait_stop

SLOT = bytes.fromhex('00b0000001000300c002700100050000010e000801000eb7200020003cb03d00')
ENT = bytes.fromhex('c00270010000fcff0e00000020007000000307000000000000001800')
st = call('GET', '/debug/status')
since = st['stop']['stop_id']


def put(off, data):
    call('PUT', f'/memory/{DS}/{off}', bytes(data), raw=True)


def run_to(*offs):
    global since
    call('DELETE', '/debug/breakpoints')
    for off in offs:
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off})
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']
    return call('GET', '/debug/status')['stop']['registers']


run_to(0x154)
put(0xAEC0, SLOT); put(0xB000, ENT)
put(0x17A, (0x2C0).to_bytes(2, 'little')); put(0x17C, (352).to_bytes(2, 'little'))
put(0x192, (40).to_bytes(2, 'little'))       # health target, so the touch can't kill the hero
r = run_to(0xBF5F)
print('toss', {k: hex(v) for k, v in r.items() if k in ('eax', 'ebx', 'ecx')}, 'cam', word(DS, 0xA), word(DS, 0xC))
r = run_to(0xC041)
print('land', {k: hex(v) for k, v in r.items() if k in ('eax', 'ebx', 'ecx')})
put(0x17A, (560).to_bytes(2, 'little'))      # step clear of the spike
for t in range(30):
    run_to(0x154)
    objs = mem(DS, 0x8314, 200 * 8)
    rows = []
    for i in range(200):
        x, y, ty = (int.from_bytes(objs[i * 8 + k:i * 8 + k + 2], 'little', signed=True) for k in (0, 2, 4))
        if ty == 50 and 600 < x < 800:
            rows.append((i, x, y, objs[i * 8 + 6], mem(SS, 0x438 + i, 1)[0]))   # dirty: [bp] -> SS
    print(t, rows)
call('DELETE', '/debug/breakpoints')
