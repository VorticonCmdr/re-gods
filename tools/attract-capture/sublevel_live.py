#!/usr/bin/env python3
"""sublevel_live.py — ranked item 60: what the sublevel A->B switch leaves in
the sprite descriptors from 0x1C2 (DS:0x2C10, 8 bytes each), staged live in
PJOYL1 as item 43 did (chain [0x178] = 0xE6A6, counters [0x368]/[0x369] = 5,
the hero on the (1440, 944) checkpoint).

Logs every hit of CS:0x4828 (switch), 0x484E (carry into B), 0x05D7 (the
shopkeeper setup) and 0x2342 (export 22, with the filename at DS:DX), and
snapshots [0x38A], [0x130..0x134] and the 173 descriptors before the stage,
right after 0x484E returns, and `after` ticks later. Leaves DOSBox PAUSED at
the end so the screen can be captured.

  python3 sublevel_live.py 300 40      # writes sublevel_live.json
  python3 sublevel_live.py 300 200 1500   # also: after the switch, put the hero
      # (and the camera) at x=1500 on PLEV1B's first spawn cell (1504, 944:
      # System B group 4, two creatures) and stop at the first CS:0x3569 draw
      # of a sprite in 0x1C2..0x26E, DOSBox paused for a screen capture
"""
import json, sys
from sweep import call, mem, word, wait_stop, DS, CS, SS, POLLER

N_DESC, DESC0 = 173, 0x2C10    # SS: VGA:0x1BDB reads SS:[DS:0xE + id*8]
HITS = (0x4828, 0x484E, 0x05D7, 0x2342, 0x489C)


def s16(v):
    return v - 0x10000 if v & 0x8000 else v


def snap():
    return {'c': word(DS, 0x282), 'l38a': mem(DS, 0x38A, 1)[0], 'l38b': mem(DS, 0x38B, 1)[0],
            'world': mem(DS, 0x42, 1)[0], 'sub': mem(DS, 0x43, 1)[0],
            'arena': [hex(word(DS, o)) for o in (0x130, 0x132, 0x134)],
            'hero': [word(DS, 0x17A), word(DS, 0x17C)],
            'desc': mem(SS, DESC0, 8 * N_DESC).hex()}


def main():
    at, after = int(sys.argv[1]), int(sys.argv[2])
    place = int(sys.argv[3]) if len(sys.argv) > 3 else None
    here = __file__.rsplit('/', 1)[0]
    call('POST', '/debug/pause')
    since = call('GET', '/debug/status')['stop']['stop_id']

    def go(bps):
        nonlocal since
        call('DELETE', '/debug/breakpoints')
        for bp in bps:
            call('POST', '/debug/breakpoints', bp)
        call('POST', '/debug/continue')
        s = wait_stop(since)
        since = s['stop_id']
        return s

    atc = {'type': 'execute', 'segment': CS, 'offset': POLLER,
           'condition': {'segment': DS, 'offset': 0x282, 'width': 2, 'op': 'eq', 'value': at}}
    while True:
        go([atc])
        if mem(DS, 0x3E6, 1)[0] == 1:
            break
    out = {'before': snap(), 'hits': []}
    call('PUT', f'/memory/{DS}/{0x178}', (0xE6A6).to_bytes(2, 'little'), raw=True)
    call('PUT', f'/memory/{DS}/{0x368}', bytes([5, 5]), raw=True)
    call('PUT', f'/memory/{DS}/{0x17A}', (1440).to_bytes(2, 'little'), raw=True)
    call('PUT', f'/memory/{DS}/{0x17C}', (944).to_bytes(2, 'little'), raw=True)
    watch = [{'type': 'execute', 'segment': CS, 'offset': o} for o in HITS + (POLLER,)]
    switched, end_c = False, None
    while True:
        st = go(watch)
        r = st['registers']
        ip, c = r['eip'], word(DS, 0x282)
        if ip == POLLER:
            if end_c is not None and c >= end_c:
                out['later'] = snap()
                break
            if c > at + 400:
                out['timeout'] = c
                break
            continue
        hit = {'at': hex(ip), 'c': c, 'l38a': mem(DS, 0x38A, 1)[0], 'sub': mem(DS, 0x43, 1)[0]}
        if ip == 0x2342:
            dx = r['edx'] & 0xFFFF
            hit['file'] = mem(DS, dx, 16).split(b'\0')[0].decode('latin-1')
            hit['ret'] = hex(word(SS, r['esp'] & 0xFFFF))
        out['hits'].append(hit)
        print(hit, flush=True)
        if ip == 0x489C and not switched:        # 0x484E's RET: the switch is done
            switched = True
            out['switched'] = snap()
            end_c = c + after
            if place is not None:
                call('PUT', f'/memory/{DS}/{0x17A}', place.to_bytes(2, 'little'), raw=True)
                call('PUT', f'/memory/{DS}/{0x17C}', (944).to_bytes(2, 'little'), raw=True)
                call('PUT', f'/memory/{DS}/{0xA}', (place - 0x90).to_bytes(2, 'little'), raw=True)
                call('PUT', f'/memory/{DS}/{0xC}', (944 - 0x48).to_bytes(2, 'little'), raw=True)
                watch = watch + [{'type': 'execute', 'segment': CS, 'offset': 0x3569}]
            continue
        if ip == 0x3569:
            out['hits'].pop()
            sp = word(DS, 0x8)
            if 0x1C2 <= sp < 0x1C2 + N_DESC:
                out['draw'] = {'c': c, 'sprite': hex(sp), 'screen': [s16(word(DS, 0x4)), s16(word(DS, 0x6))],
                               'ret': hex(word(SS, r['esp'] & 0xFFFF)), 'hero': [word(DS, 0x17A), word(DS, 0x17C)],
                               'desc': mem(SS, DESC0 + 8 * (sp - 0x1C2), 8).hex()}
                print('DRAW', out['draw'], flush=True)
                out['later'] = snap()
                break
            continue
    call('DELETE', '/debug/breakpoints')
    # leave DOSBox paused here: the caller captures the screen, then continues
    json.dump(out, open(f'{here}/sublevel_live.json', 'w'), indent=0)
    b, s = out['before'], out.get('switched')
    if s:
        changed = [k for k in range(N_DESC) if b['desc'][16 * k:16 * k + 16] != s['desc'][16 * k:16 * k + 16]]
        print('descriptors changed by the switch:', len(changed), changed[:8], '...', flush=True)
        if 'later' in out:
            back = [k for k in changed if out['later']['desc'][16 * k:16 * k + 16] == b['desc'][16 * k:16 * k + 16]]
            print('restored by', out['later']['c'], ':', len(back), flush=True)
        print({k: s[k] for k in s if k != 'desc'}, flush=True)


if __name__ == '__main__':
    main()
