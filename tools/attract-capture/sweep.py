#!/usr/bin/env python3
"""sweep.py — log every sound play and random draw of one live attract demo.

DOSBox must be PAUSED somewhere before the demo's `inject` cursor, with the
demo already running (the cycler DS:0x3E6 already holding its value). The
script then:
  1. runs to the input poller CS:0x241D at tape cursor `inject`, and writes
     the capture's DS:0x7E14 random table there, so the live run replays
     the recorded one (the table is BIOS-seeded per boot);
  2. breaks on CS:0x22CA (sound dispatch: AX = sfx id, [SP] = caller) and on
     CS:0x3836 (the random reader: [SP] = caller, 0x2A00 = the ADL callback),
     logging cursor / DS:0x160 / id / caller at each stop, until the tape
     cursor passes `end` or the cycler moves on.
Writes NAME.sweep.json next to the capture.

  python3 sweep.py joyl1 12 900
"""
import json, sys, urllib.request

API = 'http://localhost:8386/api/v1'
DS, CS, SS = 0x136A, 0x36D, 0x22AA
POLLER, SFX, RND = 0x241D, 0x22CA, 0x3836


def call(method, path, body=None, raw=False):
    data = None if body is None else (body if raw else json.dumps(body).encode())
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={'Content-Type': 'application/octet-stream' if raw else 'application/json'})
    out = urllib.request.urlopen(req).read()
    return out if method == 'GET' and path.startswith('/memory') else (json.loads(out) if out else None)


def mem(seg, off, n):
    return call('GET', f'/memory/{seg}/{off}/{n}')


def word(seg, off):
    return int.from_bytes(mem(seg, off, 2), 'little')


def wait_stop(since):
    while True:
        s = call('GET', f'/debug/wait?since_stop_id={since}&timeout_ms=10000')
        if s.get('satisfied'):
            return s


def main():
    name, inject, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    # optional DS pokes at the inject cursor: `off:hexbytes` (e.g. 1d4:0100
    # seeds the starburst gravity phase, a value DOS carries across cycles)
    pokes = [(int(a.split(':')[0], 16), bytes.fromhex(a.split(':')[1])) for a in sys.argv[4:]]
    here = __file__.rsplit('/', 1)[0]
    cap = json.load(open(f'{here}/{name}.raw.json'))['output']
    snaps = [e.split(':') for e in cap['rnd'].split(';') if e]
    snap = [s for s in snaps if int(s[0]) <= inject][-1]
    table = bytes.fromhex(snap[2])
    cycler = mem(DS, 0x3E6, 1)[0]

    st = call('GET', '/debug/status')
    assert st['debugging'], 'pause DOSBox first'
    since = st['stop']['stop_id'] if st.get('stop') else 0
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': POLLER,
         'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': inject}})
    call('POST', '/debug/continue')
    s = wait_stop(since); since = s['stop_id']
    assert mem(DS, 0x3E6, 1)[0] == cycler, 'cycler moved before the inject cursor'
    call('PUT', f'/memory/{DS}/{0x7E14}', table, raw=True)
    assert mem(DS, 0x7E14, 512) == table
    for off, data in pokes:
        call('PUT', f'/memory/{DS}/{off}', data, raw=True)
    log = [{'inject': inject, 'snap': int(snap[0]), 'r_live': word(DS, 0x160), 'r_cap': int(snap[1])}]

    call('DELETE', '/debug/breakpoints')
    for off in (SFX, RND):
        call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off})
    while True:
        call('POST', '/debug/continue')
        s = wait_stop(since); since = s['stop_id']
        reg = s['registers']
        cur = word(DS, 0x282)
        if cur > end or mem(DS, 0x3E6, 1)[0] != cycler:
            break
        ret = word(SS, reg['esp'] & 0xFFFF)
        kind = 'sfx' if reg['eip'] == SFX else 'rnd'
        e = {'c': cur, 'k': kind, 'r': word(DS, 0x160), 'ret': hex(ret)}
        if kind == 'sfx':
            e['id'] = hex(reg['eax'] & 0xFFFF)
        log.append(e)
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    json.dump(log, open(f'{here}/{name}.sweep.json', 'w'), indent=0)
    print(len(log), 'events; last cursor', cur)


if __name__ == '__main__':
    main()
