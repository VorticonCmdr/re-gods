#!/usr/bin/env python3
"""volley_live.py — UNKNOWN_carried_weapon_volley, live in PJOYL3 (world 3).

A weapon carried into a new world keeps its slot while the sublevel-'a'
load (CS:0x35E9) re-pins the weapon record's +0x08 to the EXE image value;
+0x06 (Power) is the new world's. Writing the axe (index 7) straight into
slot A (DS:0xDD10) without the pickup path reproduces exactly that state:
the pickup (CS:0x9115) is what would have set +0x08 := +0x06.

DOSBox must be PAUSED at the start of PJOYL3 (armwait.py 5). At the poller
stop for cursor `at` (world 3 gameplay) the script puts the axe in slot A,
zeroes the slot's 144-byte projectile area (DS:0xDD12) and, at the player
call CS:0x0254 of the next tick, sets the input byte DS:0x382 to FIRE
(0x80) for one tick. It logs the axe record's +6/+8 and every live
projectile record of slot A for `span` ticks. With `pickup`, +0x08 is first
set to +0x06, the state a fresh pickup leaves, as the control.
The slot write and the input override are not original mechanisms; the
volley they trigger is (CS:0x98D1 bp = [si+8] - [si+6] + 1, then CS:0x98EF/0x9905 dec bp / jz).

  python3 armwait.py 5 && python3 volley_live.py 300 12
  python3 volley_live.py 400 12 pickup      # later in the same demo
"""
import json, sys
from sweep import DS, CS, POLLER, call, mem, word, wait_stop

at, span = int(sys.argv[1]), int(sys.argv[2])
pickup = 'pickup' in sys.argv[3:]
here = __file__.rsplit('/', 1)[0]
AXE, REC = 7, 0xE2B6 + 7 * 0x50
SLOT_A, AREA = 0xDD10, 0xDD12
PLAYER_CALL = 0x0254
st = call('GET', '/debug/status')
assert st['debugging'], 'pause DOSBox first'
since = st['stop']['stop_id']


def run_to(off, c, op='eq'):
    global since
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off,
         'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': op, 'value': c}})
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def put(off, data):
    call('PUT', f'/memory/{DS}/{off}', bytes(data), raw=True)


def shots():
    raw = mem(DS, AREA, 144)
    out = []
    for i in range(18):
        t, x, y, d = (int.from_bytes(raw[i * 8 + k:i * 8 + k + 2], 'little') for k in (0, 2, 4, 6))
        if t:
            out.append(f'{i}:t{t} {s16(x)},{s16(y)} d{d}')
    return out


# The player call runs only in gameplay; the poller also runs, many times a
# tick, in the password menu, where a conditional stop per hit is slow.
run_to(PLAYER_CALL, at, 'ge')
at = word(DS, 0x282)
before = {'world': mem(DS, 0x42, 1)[0], 'sub': mem(DS, 0x43, 1)[0], 'slotA': s16(word(DS, SLOT_A)),
          'rec6': word(DS, REC + 6), 'rec8': word(DS, REC + 8), 'maxShots': word(DS, REC + 0x0A)}
print('before', before, flush=True)
put(SLOT_A, AXE.to_bytes(2, 'little'))
put(AREA, bytes(144))
if pickup:
    put(REC + 8, word(DS, REC + 6).to_bytes(2, 'little'))
log = []
for c in range(at + 1, at + span + 1):
    run_to(PLAYER_CALL, c, 'ge')
    if c == at + 1:
        put(0x382, [0x80])
    elif c == at + 2:
        put(0x382, [0])
    run_to(PLAYER_CALL, c + 1, 'ge')
    log.append({'c': c, 'st': mem(DS, 0x377, 1)[0], 'rec8': word(DS, REC + 8), 'shots': shots()})
    print(log[-1], flush=True)
call('DELETE', '/debug/breakpoints')
json.dump({'before': before, 'pickup': pickup, 'log': log},
          open(f'{here}/volley_live{"_pickup" if pickup else ""}.json', 'w'), indent=0)
