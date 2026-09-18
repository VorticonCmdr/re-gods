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
instrument data, not a chip-accurate register dump. Blobs 19/20/40 are the
three non-SMF "type 2" blobs (first byte 'C'/'c') and are NOT extracted
here — they're read through PPLAYER.BIN's indexed byte accessor instead of
a literal SMF walk, a different, not-yet-written parser.

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


def main():
    if len(sys.argv) != 2:
        print(f'usage: {sys.argv[0]} <decompressed PGODS.MUS>', file=sys.stderr)
        sys.exit(1)
    data = open(sys.argv[1], 'rb').read()
    blobs = parse_container(data)
    out = {}
    conforming = 0
    for i, blob in enumerate(blobs):
        inst = extract_instrument(blob)
        if inst:
            conforming += 1
        out[i] = inst
    print(f'{len(blobs)} blobs total, {conforming} conforming SMF instrument records '
          f'({len(blobs) - conforming} non-conforming: {[i for i, v in out.items() if v is None]})',
          file=sys.stderr)
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
