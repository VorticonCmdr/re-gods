-- One attract demo, per tick. DS = 0x136A (live, 4970).
-- rows: the last state seen while the tape cursor DS:0x282 held each value
--   (the settled end of a tick): cursor, heroX 0x17A, heroY 0x17C, state
--   0x377, camX 0xA, camY 0xC, random cursor 0x160.
-- ev: changes of a few extra fields (world 0x42, sublevel 0x43, health
--   0x192, lives 0x224, death counter 0x24C, script mode 0x34, respawn X
--   0x16E), as cursor:name=value.
-- rnd: the 512-byte random table DS:0x7E14 (hex) with the tape cursor and
--   DS:0x160 at the moment it was seen — at playback start and again
--   whenever its first word changes (a level load regenerates it).
-- Polled every emulator frame (a 15 Hz tick spans ~4.7 frames); the wait
-- for playback polls every 8 frames to save the Lua step budget.
local S = 0x136A
local rw, rb, rd = dosbox.mem_read_word, dosbox.mem_read_byte, dosbox.mem_read
local HEX = {}
for i = 0, 255 do HEX[i] = string.format('%02x', i) end
local function tablehex()
  local s, out = rd(S, 0x7E14, 512), {}
  for i = 1, 512 do out[i] = HEX[string.byte(s, i)] end
  return table.concat(out)
end
while rb(S, 0x3BD) ~= 0 do dosbox.wait_frames(8) end
while rb(S, 0x3BD) == 0 do dosbox.wait_frames(1) end
dosbox.output['cycler'] = rb(S, 0x3E6)
local rows, ev, rnd = {}, {}, {}
local cur = rw(S, 0x282)
local t0 = rw(S, 0x7E14)
rnd[1] = cur .. ':' .. rw(S, 0x160) .. ':' .. tablehex()
local a, b2, c, d, e, f, g, r = 0, 0, 0, 0, 0, 0, -1, 0
local hp, lv, dt, m34, rx = -1, -1, -1, -1, -1
while rb(S, 0x3BD) ~= 0 do
  local k = rw(S, 0x282)
  if k ~= cur then
    rows[#rows + 1] = cur .. ',' .. a .. ',' .. b2 .. ',' .. c .. ',' .. d .. ',' .. e .. ',' .. r
    cur = k
  end
  a, b2, c, d, e = rw(S, 0x17A), rw(S, 0x17C), rb(S, 0x377), rw(S, 0xA), rw(S, 0xC)
  r = rw(S, 0x160)
  f = rb(S, 0x42) * 16 + rb(S, 0x43); if f ~= g then g = f; ev[#ev + 1] = k .. ':ws=' .. f end
  local v = rw(S, 0x192); if v ~= hp then hp = v; ev[#ev + 1] = k .. ':hp=' .. v end
  v = rw(S, 0x224); if v ~= lv then lv = v; ev[#ev + 1] = k .. ':lives=' .. v end
  v = rw(S, 0x24C); if v ~= dt then dt = v; ev[#ev + 1] = k .. ':dth=' .. v end
  v = rb(S, 0x34); if v ~= m34 then m34 = v; ev[#ev + 1] = k .. ':d34=' .. v end
  v = rw(S, 0x16E); if v ~= rx then rx = v; ev[#ev + 1] = k .. ':rx=' .. v end
  v = rw(S, 0x7E14); if v ~= t0 then t0 = v; rnd[#rnd + 1] = k .. ':' .. r .. ':' .. tablehex() end
  dosbox.wait_frames(1)
end
rows[#rows + 1] = cur .. ',' .. a .. ',' .. b2 .. ',' .. c .. ',' .. d .. ',' .. e .. ',' .. r
dosbox.output['rows'] = table.concat(rows, ';')
dosbox.output['ev'] = table.concat(ev, ';')
dosbox.output['rnd'] = table.concat(rnd, ';')
dosbox.output['n'] = #rows
