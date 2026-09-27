-- One attract demo, per tick. DS = 0x136A (live, 4970). `rows`: the last
-- state seen while the tape cursor DS:0x282 held each value (the settled end
-- of a tick): cursor, heroX 0x17A, heroY 0x17C, state 0x377, camX 0xA,
-- camY 0xC, world 0x42, sublevel 0x43. `ev`: changes of a few extra fields
-- (health 0x192, lives 0x224, death counter 0x24C, script mode 0x34,
-- respawn X 0x16E), as cursor:name=value. Polled every 2 emulator frames
-- (a 15 Hz tick spans ~4.7 frames) to stay inside the Lua step budget.
local S = 0x136A
local rw, rb = dosbox.mem_read_word, dosbox.mem_read_byte
while rb(S, 0x3BD) ~= 0 do dosbox.wait_frames(1) end
while rb(S, 0x3BD) == 0 do dosbox.wait_frames(1) end
dosbox.output['cycler'] = rb(S, 0x3E6)
local rows, ev = {}, {}
local cur = rw(S, 0x282)
local a, b2, c, d, e, f, g = 0, 0, 0, 0, 0, 0, 0
local hp, lv, dt, m34, rx = -1, -1, -1, -1, -1
while rb(S, 0x3BD) ~= 0 do
  local k = rw(S, 0x282)
  if k ~= cur then
    rows[#rows + 1] = cur .. ',' .. a .. ',' .. b2 .. ',' .. c .. ',' .. d .. ',' .. e .. ',' .. f .. ',' .. g
    cur = k
  end
  a, b2, c, d, e = rw(S, 0x17A), rw(S, 0x17C), rb(S, 0x377), rw(S, 0xA), rw(S, 0xC)
  f, g = rb(S, 0x42), rb(S, 0x43)
  local v = rw(S, 0x192); if v ~= hp then hp = v; ev[#ev + 1] = k .. ':hp=' .. v end
  v = rw(S, 0x224); if v ~= lv then lv = v; ev[#ev + 1] = k .. ':lives=' .. v end
  v = rw(S, 0x24C); if v ~= dt then dt = v; ev[#ev + 1] = k .. ':dth=' .. v end
  v = rb(S, 0x34); if v ~= m34 then m34 = v; ev[#ev + 1] = k .. ':d34=' .. v end
  v = rw(S, 0x16E); if v ~= rx then rx = v; ev[#ev + 1] = k .. ':rx=' .. v end
  dosbox.wait_frames(2)
end
rows[#rows + 1] = cur .. ',' .. a .. ',' .. b2 .. ',' .. c .. ',' .. d .. ',' .. e .. ',' .. f .. ',' .. g
dosbox.output['rows'] = table.concat(rows, ';')
dosbox.output['ev'] = table.concat(ev, ';')
dosbox.output['n'] = #rows
