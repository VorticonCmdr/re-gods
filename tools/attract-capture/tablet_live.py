#!/usr/bin/env python3
"""tablet_live.py — UNKNOWN_63d5_nomatch_runtime_effect, live in PLEV1B.

Two of PLEV1B's tablets (objects at x = 348 and x = 329) match no key in
PALFILS.0B1, so the hint handler CS:0x63D5 takes its no-match arm
(CS:0x63FC jmp 0x6425: nine POPs after five PUSHes). DOSBox must be PAUSED
at the start of PJOYL1 (armwait.py 1) and run with `switch`: at the poller
stop for cursor `at` it stages the real sublevel A->B switch as item 60 did
(sublevel_live.py: chain DS:0x178 = 0xE6A6, counters 5/5, hero on the
(1440, 944) checkpoint) and waits for CS:0x489C. PJOYG1 (world 1B) is no
use: staged there, the activation box never recomputed (it is the guardian
demo; CS:0x01FC skips the object walk CS:0x0203 when DS:0x34 = 1 outside
world 2, though DS:0x34 was not read). Then
the hero DS:0x17A/0x17C is put at (hx, hy) beside the tablet and the camera
DS:0xA/0xC at (cx, cy) with the activation latch DS:0x379 cleared, so the
next tick's CS:0x1187 recompute activates the tablet and the pickup test
CS:0x177D sees it. The teleport is not an original mechanism; what the
handler does with the touch is.

Logged: the handler entry (registers, 12 stack words), the no-match arm, then
single steps from CS:0x6425 to the RET at CS:0x646E and 24 instructions past
it, and the state of DS/SS/CS and the tape cursor after `after` more ticks
(or where it stopped). DOSBox is left PAUSED for a screen capture.

  python3 tablet_live.py 60 324 864 192 784 20
"""
import json, sys
from sweep import DS, CS, SS, POLLER, call, mem, word, wait_stop

at, hx, hy, cx, cy, after = (int(a) for a in sys.argv[1:7])
here = __file__.rsplit('/', 1)[0]
st = call('GET', '/debug/status')
assert st['debugging'], 'pause DOSBox first'
since = st['stop']['stop_id']


def stop_at(bps, timeout_loops=30):
    global since
    call('DELETE', '/debug/breakpoints')
    for b in bps:
        call('POST', '/debug/breakpoints', b)
    call('POST', '/debug/continue')
    for _ in range(timeout_loops):
        s = call('GET', f'/debug/wait?since_stop_id={since}&timeout_ms=10000')
        if s.get('satisfied'):
            since = s['stop_id']
            return s
    call('POST', '/debug/pause')
    s = call('GET', '/debug/status')
    since = s['stop']['stop_id']
    return None


def put(off, v):
    call('PUT', f'/memory/{DS}/{off}', (v & 0xFFFF).to_bytes(2, 'little'), raw=True)


def poller(c):
    return {'type': 'execute', 'segment': CS, 'offset': POLLER,
            'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': c}}


def snap(s):
    r = s['registers']
    stack = mem(r['ss'], r['esp'] & 0xFFFF, 24)
    return {'cs': hex(r['cs']), 'ip': hex(r['eip']), 'ds': hex(r['ds']), 'es': hex(r['es']), 'ss': hex(r['ss']),
            'sp': hex(r['esp'] & 0xFFFF), 'ax': hex(r['eax'] & 0xFFFF), 'bx': hex(r['ebx'] & 0xFFFF),
            'cx': hex(r['ecx'] & 0xFFFF), 'dx': hex(r['edx'] & 0xFFFF), 'si': hex(r['esi'] & 0xFFFF),
            'di': hex(r['edi'] & 0xFFFF), 'bp': hex(r['ebp'] & 0xFFFF),
            'stack': [hex(int.from_bytes(stack[i:i + 2], 'little')) for i in range(0, 24, 2)]}


switch = 'switch' in sys.argv[7:]
out = {'switch': switch}
stop_at([poller(at)])
if switch:
    # item 60's staging (sublevel_live.py): the real sublevel A->B switch
    put(0x178, 0xE6A6)
    call('PUT', f'/memory/{DS}/{0x368}', bytes([5, 5]), raw=True)
    put(0x17A, 1440); put(0x17C, 944)
    stop_at([{'type': 'execute', 'segment': CS, 'offset': 0x489C}], 10)
    stop_at([poller(word(DS, 0x282) + 1)], 3)
    at = word(DS, 0x282)
out['world'], out['sub'], out['at'] = mem(DS, 0x42, 1)[0], mem(DS, 0x43, 1)[0], at
out['l38a'], out['ds34'] = mem(DS, 0x38A, 1)[0], mem(DS, 0x34, 1)[0]
print('staged', out, flush=True)
put(0x17A, hx); put(0x17C, hy); put(0xA, cx); put(0xC, cy)
call('PUT', f'/memory/{DS}/{0x379}', b'\0', raw=True)
import struct


def tablets():
    b = mem(DS, 0x8314, 1600)
    return [(i,) + struct.unpack('<4H', b[i * 8:i * 8 + 8]) for i in range(200)
            if struct.unpack('<4H', b[i * 8:i * 8 + 8])[0] in (hx + 24, 348, 329)
            or struct.unpack('<4H', b[i * 8:i * 8 + 8])[2] == 69]


out['diag'] = []
entry = None
for k in range(1, 9):
    s = stop_at([{'type': 'execute', 'segment': CS, 'offset': 0x63D5}, poller(at + k)], 3)
    if s and s['registers']['eip'] == 0x63D5:
        entry = s
        break
    out['diag'].append({'c': word(DS, 0x282), 'hero': [word(DS, 0x17A), word(DS, 0x17C)],
                        'cam': [word(DS, 0xA), word(DS, 0xC)], 'st': mem(DS, 0x377, 1)[0],
                        'tablets': [t for t in tablets() if 300 <= t[1] <= 400]})
    print(out['diag'][-1], flush=True)
out['entry'] = entry and snap(entry)
out['entry_cursor'] = word(DS, 0x282)
print('entry', out['entry'], flush=True)
if entry:
    arm = stop_at([{'type': 'execute', 'segment': CS, 'offset': 0x6425},
                   {'type': 'execute', 'segment': CS, 'offset': 0x63FE}], 3)
    out['arm'] = arm and snap(arm)
    print('arm', out['arm'], flush=True)
    steps = []
    if arm and arm['registers']['eip'] == 0x6425:
        for i in range(400):
            r = call('POST', '/debug/step', {})
            stp = r.get('stop') or r
            reg = stp['registers']
            steps.append({'cs': hex(reg['cs']), 'ip': hex(reg['eip']), 'ds': hex(reg['ds']), 'sp': hex(reg['esp'] & 0xFFFF)})
            since = stp.get('stop_id', since)
            if reg['cs'] == CS and reg['eip'] == 0x646E:
                ret = snap(stp)
                out['at_ret'] = ret
                print('at_ret', ret, flush=True)
                for k in range(24):
                    r = call('POST', '/debug/step', {})
                    stp = r.get('stop') or r
                    reg = stp['registers']
                    steps.append({'cs': hex(reg['cs']), 'ip': hex(reg['eip']), 'ds': hex(reg['ds']),
                                  'sp': hex(reg['esp'] & 0xFFFF)})
                    since = stp.get('stop_id', since)
                break
    out['steps'] = steps
    later = stop_at([poller(out['entry_cursor'] + after)], 3)
    out['later'] = later and snap(later)
    out['later_cursor'] = word(DS, 0x282) if later else None
    print('later', out['later'], flush=True)
call('DELETE', '/debug/breakpoints')
json.dump(out, open(f'{here}/tablet_live.json', 'w'), indent=0)
