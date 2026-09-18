#!/usr/bin/env python3
"""extract_sfx_instruments.py — pulls all 73 SFX instrument parameter blocks
out of a decompressed PGODS.MUS.

Background: PPLAYER.BIN's OPL2 SFX handler (FUN_0000_1321, disassembled in
Ghidra) selects a PGODS.MUS blob by DIRECT INDEX (the id value it receives,
AND 0x7f, is PGODS.MUS's own blob index — same container format this
project's other tooling already reads: u16 blob count, then that many u32
LE absolute offsets, then the concatenated blobs). Each blob's `FF 7F`
sequencer-specific meta at a byte-identical, header-length-independent
offset (46) opens with a 6-byte micro-record (`.. .. 3F 00 01 00` — the
0x3F at +2 is the same validator this project's PLAYER.BIN parser work
already documented) whose TAG (01) selects the instrument body: 28 raw
bytes starting at blob offset 52, split by PPLAYER.BIN's own FUN_0000_1bd5
into a 13-byte operator-1 block, a 13-byte operator-2 block, and 2 trailing
wave-select bytes.

This layout is `[PROVEN]` live in DOSBox, not inferred: breakpointed
PPLAYER.BIN's FUN_0000_1bd5 (the function that consumes this exact 28-byte
block) at its own live-located address and dumped its populated 0xb1a
scratch buffer for two different, independently-triggered SFX ids (title-
menu cursor-move events) in a fresh session each time. Both captures matched
this script's own extraction BYTE-FOR-BYTE (28/28), at the SAME blob-
relative offset 52, for blob indices 4 and (separately) 49 — see
Gods/docs/drivers-and-memory.md's `UNKNOWN_sfx_instrument_source` entry for
the full trace and citations.

NOT yet closed by this script: the 8 functions (FUN_0000_1e9a/1e86/1640/
1848/1807/17c6/176f/172f) that turn these 13-byte-per-operator PARAMETER
blocks into actual 0x388/0x389 OPL2 REGISTER bytes via runtime volume-
scaling lookup tables — this script extracts the game's own stored
instrument data, not a chip-accurate register dump.

Blobs 19/20/40 are the three non-SMF "type 2" blobs (first byte 'C'/'c',
voice-count 9 in ADL.EXE's own SFX table) and use a GENUINELY DIFFERENT
shape, not the op1/op2/wave one above: PPLAYER.BIN reads their event stream
through an INDEXED byte accessor (FUN_0000_12d0/12e8's "flag clear" mode)
that maps a cursor position to table1[cursor>>1] on even cursor values and
a forced 0 on odd ones — table1 being the already-`[PROVEN]` 22-byte
mini-header + 9×19-byte per-channel table at blob offset 0x201 (513), one
19-byte record per OPL2 channel (this doc's own `UNKNOWN_mus_type2`
section). This script extracts that raw 9×19 table verbatim for these
three blobs, labeled distinctly (`type2_channel_table`) — it does NOT
attempt to walk the indexed event stream to find where inside it a TAG=1
instrument event would land relative to table1, so it makes no claim these
9 channel records line up with the op1/op2/wave shape the same way the 70
SMF blobs do. That mapping is still open (see this doc's own disclosure).

Usage:
    BLAST_OUT=/tmp/sfxwork python3 blast.py PGODS.MUS
    python3 extract_sfx_instruments.py /tmp/sfxwork/out_PGODS.MUS
"""
import struct
import sys
import json


def parse_container(data):
    count = struct.unpack_from('<H', data, 0)[0]
    offsets = [struct.unpack_from('<I', data, 2 + i * 4)[0] for i in range(count)]
    blobs = []
    for i in range(count):
        start = offsets[i]
        end = offsets[i + 1] if i + 1 < count else len(data)
        blobs.append(data[start:end])
    return blobs


def extract_instrument(blob):
    """Returns {op1, op2, waves} hex strings, or None if blob doesn't conform
    to the plain-SMF TAG=1 layout (the three non-SMF blobs, or anything too
    short)."""
    if blob[:4] != b'MThd' or len(blob) < 80:
        return None
    header6 = blob[46:52]
    if len(header6) < 3 or header6[2] != 0x3F:
        return None
    payload = blob[52:80]
    return {
        'op1': payload[0:13].hex(),
        'op2': payload[13:26].hex(),
        'waves': payload[26:28].hex(),
    }


def extract_type2_channel_table(blob):
    """The three non-SMF 'type 2' blobs' own already-documented raw 9x19
    per-channel table at blob offset 0x201 (513) — NOT the same shape as
    extract_instrument()'s op1/op2/wave, see module docstring."""
    if blob[:1] not in (b'C', b'c'):
        return None
    table1 = blob[0x201:0x201 + 22 + 9 * 19]
    if len(table1) < 22 + 9 * 19:
        return None
    header22 = table1[:22]
    channels = [table1[22 + ch * 19:22 + (ch + 1) * 19].hex() for ch in range(9)]
    return {'header22': header22.hex(), 'channels': channels}


def main():
    if len(sys.argv) != 2:
        print(f'usage: {sys.argv[0]} <decompressed PGODS.MUS>', file=sys.stderr)
        sys.exit(1)
    data = open(sys.argv[1], 'rb').read()
    blobs = parse_container(data)
    out = {}
    conforming = 0
    type2 = 0
    for i, blob in enumerate(blobs):
        inst = extract_instrument(blob)
        if inst:
            conforming += 1
            out[i] = {'kind': 'op1_op2_wave', **inst}
            continue
        t2 = extract_type2_channel_table(blob)
        if t2:
            type2 += 1
            out[i] = {'kind': 'type2_channel_table', **t2}
            continue
        out[i] = None
    print(f'{len(blobs)} blobs total, {conforming} op1/op2/wave SMF instrument records, '
          f'{type2} type2 channel tables '
          f'({len(blobs) - conforming - type2} unaccounted for: {[i for i, v in out.items() if v is None]})',
          file=sys.stderr)
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
