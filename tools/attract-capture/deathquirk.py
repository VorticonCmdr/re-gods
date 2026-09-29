#!/usr/bin/env python3
"""deathquirk.py — kill a rank-2 System A follower live and read the group.

Ranked item 68: CS:0xE297-0xE2A6 clears bit RANK of [bp+0x14], not the
member's own bit, then CS:0xEBE5 lowers every higher rank still in the mask.
Run with DOSBox RUNNING a live 4-member group in slot 0 (syslive.py 4 ...).
"""
from sweep import DS, CS, SS, call, mem, wait_stop

call('POST', '/debug/pause')
since = call('GET', '/debug/status')['stop']['stop_id']


def run_to(off):
    global since
    call('DELETE', '/debug/breakpoints')
    call('POST', '/debug/breakpoints', {'type': 'execute', 'segment': CS, 'offset': off})
    call('POST', '/debug/continue')
    since = wait_stop(since)['stop_id']


def show(tag):
    rt = mem(SS, 0x3768, 0xE4)
    e = mem(DS, 0xE96, 0x190)
    ents = [(i, int.from_bytes(e[i*0x28+8:i*0x28+10], 'little', signed=True), e[i*0x28+0x19]) for i in range(4)]
    print(tag, 'count', rt[0x12], 'mask', bin(int.from_bytes(rt[0x14:0x16], 'little')), 'ents(i,hp,rank)', ents, flush=True)


run_to(0x154)
show('before')
call('PUT', f'/memory/{DS}/{0xE96 + 0x28 + 8}', bytes([0xFF, 0xFF]), raw=True)
call('PUT', f'/memory/{DS}/{0xE96 + 0x28 + 4}', bytes([0xFF, 0xFF]), raw=True)
for t in range(3):
    run_to(0x154)
    show(f'after{t + 1}')
call('DELETE', '/debug/breakpoints')
call('POST', '/debug/continue')
