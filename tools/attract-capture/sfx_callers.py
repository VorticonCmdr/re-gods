#!/usr/bin/env python3
"""sfx_callers.py NAME INJECT END ID — log every CS:0x22CA play of sound ID
(AX) with its tape cursor and return address, after injecting the capture's
random table at INJECT (as sweep.py). DOSBox paused at the demo's start.
Writes NAME.sfxcallers.json."""
import json, sys
from sweep import DS, CS, SS, POLLER, SFX, call, mem, word, wait_stop
name, inject, end, want = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4], 16)
here = __file__.rsplit('/', 1)[0]
cap = json.load(open(f'{here}/{name}.raw.json'))['output']
snap = [s for s in (e.split(':') for e in cap['rnd'].split(';') if e) if int(s[0]) <= inject][-1]
st = call('GET', '/debug/status'); assert st['debugging']; since = st['stop']['stop_id']
cycler = mem(DS, 0x3E6, 1)[0]
def go(bps):
    global since
    call('DELETE', '/debug/breakpoints')
    for bp in bps: call('POST', '/debug/breakpoints', bp)
    call('POST', '/debug/continue'); s = wait_stop(since); since = s['stop_id']; return s
go([{'type': 'execute', 'segment': CS, 'offset': POLLER, 'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': inject}}])
call('PUT', f'/memory/{DS}/{0x7E14}', bytes.fromhex(snap[2]), raw=True)
call('PUT', f'/memory/{DS}/{0x160}', int(snap[1]).to_bytes(2, 'little'), raw=True)
log = []
while True:
    s = go([{'type': 'execute', 'segment': CS, 'offset': SFX}])
    cur = word(DS, 0x282)
    if cur > end or mem(DS, 0x3E6, 1)[0] != cycler: break
    reg = s['registers']
    if reg['eax'] & 0xFFFF == want:
        log.append({'c': cur, 'ret': hex(word(SS, reg['esp'] & 0xFFFF))})
call('DELETE', '/debug/breakpoints'); call('POST', '/debug/continue')
json.dump(log, open(f'{here}/{name}.sfxcallers.json', 'w'), indent=0)
from collections import Counter
print(len(log), Counter(e['ret'] for e in log))
