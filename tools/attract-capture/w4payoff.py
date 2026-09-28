#!/usr/bin/env python3
"""w4payoff.py STEP — drive the live game-completion sequence CS:0x037A.
  start : lives := 10 (the gift target), run to CS:0x037A
  page  : run to the next end of a page's wait CS:0x0433; print BIOS ticks
  fire  : run to the fire poll CS:0x0438 and fake fire ([0x382] = 0x80)
  load  : run to the level loader CS:0x2A37 and print the new state
"""
import sys
from sweep import DS, CS, call, mem, word, wait_stop

step = sys.argv[1]
since = call('GET', '/debug/status')['stop']['stop_id']


def run_to(off):
    global since
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off})
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


bios = lambda: int.from_bytes(mem(0x40, 0x6C, 4), 'little')
if step == 'start':
    call('PUT', f'/memory/{DS}/{0x224}', bytes([10, 0]), raw=True)
    run_to(0x37A)
    print('at 0x37A; 365', mem(DS, 0x365, 1).hex(), 'score', mem(DS, 0x3B5, 4).hex(), 'bios', bios())
elif step == 'page':
    run_to(0x433)
    print('page wait; cx', call('GET', '/debug/status')['stop']['registers']['ecx'] & 0xFFFF,
          '39', mem(DS, 0x39, 1)[0], 'bios', bios())
elif step == 'fire':
    run_to(0x438)
    call('PUT', f'/memory/{DS}/{0x382}', bytes([0x80]), raw=True)
    print('fire faked; bios', bios())
elif step == 'load':
    run_to(0x2A37)
    print('loader; 42/43', mem(DS, 0x42, 2).hex(), '365', mem(DS, 0x365, 1).hex(), 'lives', word(DS, 0x224),
          'score', mem(DS, 0x3B5, 4).hex(), '17e..184', mem(DS, 0x17E, 8).hex(), '366', mem(DS, 0x366, 2).hex(),
          '194', mem(DS, 0x194, 4).hex(), 'cc67', mem(CS, 0xCC67, 1).hex())
