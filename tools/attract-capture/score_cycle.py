#!/usr/bin/env python3
"""score_cycle.py — the BCD score DS:0x3B5-0x3B8 through one whole attract
cycle, every demo, with each capture's random table injected two cursors
after its LAST snapshot (as sweep.py: a joyl demo regenerates its table
when its game starts, so its first snapshot, at cursor 0, is the menu's). Records the cross-cycle seeds DOS
carries into each demo (DS:0x1D4 gravity, 0x2F0 jaw, 0x357 land flag) so
the port can be seeded the same way.

DOSBox must be RUNNING the attract cycle.
  python3 score_cycle.py            # writes score_cycle.json
"""
import json
from sweep import call, mem, word, wait_stop, DS, CS, POLLER

NAMES = {1: 'joyl1', 2: 'joyg1', 3: 'joyl2', 4: 'joyg2', 5: 'joyl3', 0: 'joyg3'}


def main():
    here = __file__.rsplit('/', 1)[0]
    caps = {}
    for n in NAMES.values():
        snaps = [e.split(':') for e in json.load(open(f'{here}/{n}.raw.json'))['output']['rnd'].split(';') if e]
        last = snaps[-1]
        caps[n] = {'inject': int(last[0]) + 2, 'table': bytes.fromhex(last[2]), 'r': int(last[1])}
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

    tick = [{'type': 'execute', 'segment': CS, 'offset': POLLER}]
    out, done, cur = {}, set(), None

    def save():
        json.dump({n: {k: v for k, v in d.items() if k != 'last'} for n, d in out.items() if n in done},
                  open(f'{here}/score_cycle.json', 'w'), indent=1)

    # A demo is logged only from its own inject cursor; one entered later is
    # skipped for this pass and caught on the next cycle. It counts as done
    # once it has been logged and the cycler has moved on.
    while len(done) < len(NAMES):
        go(tick)
        name = NAMES.get(mem(DS, 0x3E6, 1)[0])
        c = word(DS, 0x282)
        if cur is not None and cur != name:
            done.add(cur)
            save()
            print('done', cur, flush=True)
            cur = None
        if name is None or name in done:
            continue
        info = out.get(name)
        if info is None:
            if c != caps[name]['inject']:
                continue
            r_live = word(DS, 0x160)
            call('PUT', f'/memory/{DS}/{0x7E14}', caps[name]['table'], raw=True)
            call('PUT', f'/memory/{DS}/{0x160}', caps[name]['r'].to_bytes(2, 'little'), raw=True)
            info = out[name] = {'inject': c, 'seeds': {'gravity': word(DS, 0x1D4), 'jaw': word(DS, 0x2F0),
                                                        'land': mem(DS, 0x357, 1)[0], 'r_live': r_live},
                                'rows': [], 'last': None}
            print(name, info['seeds'], flush=True)
        cur = name
        score = mem(DS, 0x3B5, 4)
        v = int(''.join(f'{b:02x}' for b in reversed(score)))
        if v != info['last']:
            info['rows'].append(f'{c}:{v}')
            info['last'] = v
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/continue')
    save()


if __name__ == '__main__':
    main()
