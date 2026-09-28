-- ===== Taiao — Lua prelude (the authoring API) =====
-- Loaded once at boot, BEFORE any content script. Defines the registration
-- verbs, the persisted `quest` var proxy, and ergonomic wrappers over the
-- injected __host functions (implemented in js/lua/lua-host.js).
--
-- Concurrency: NPC daily routines run as independent wasmoon coroutines that
-- interleave only at `await` points (JS is single-threaded). They share one Lua
-- state, so the "which context is running" marker `_current` is a single global.
-- Every SUSPENDING wrapper therefore saves _current before the yield and
-- restores it after resume, so a routine that wakes up still sees its own NPC.

local H = { npc = {}, loc = {}, role = {}, routine = {}, kill = {}, item = {}, cutscene = {} }
__LUA_H = H

_current = 0   -- ctx id of the actively-running handler

-- ---- registration ----------------------------------------------------------
function on_npc(name, fn)   H.npc[name] = fn;         __register("npc", name) end
function on_loc(key, fn)    H.loc[key] = fn;          __register("loc", key) end
function on_role(role, fn)  H.role[role] = fn;        __register("role", role) end
function routine(name, fn)  H.routine[name] = fn;     __register("routine", name) end
function on_kill(kind, fn)  H.kill[kind] = fn;        __register("kill", kind) end
function on_item(id, fn)    H.item[id] = fn;          __register("item", id) end
function cutscene(name, fn) H.cutscene[name] = fn;    __register("cutscene", name) end

-- ---- dispatch entry (called from JS via doString, on a yieldable thread) ----
function __run(kind, subject, ctxid)
  local h = H[kind] and H[kind][subject]
  if not h then return end
  local prev = _current
  _current = ctxid
  local ok, err = pcall(h)
  _current = prev
  if not ok then __err(subject, tostring(err)) end
end

-- ---- persisted quest-stage store -------------------------------------------
-- `quest.foo` reads/writes player.scriptVars["foo"] as an integer — the SAME
-- store and key names the old QuestScript `quests[...]` table used, so a save
-- mid-quest keeps its stage across the port.
quest = setmetatable({}, {
  __index    = function(_, k) return __get_var(k) end,
  __newindex = function(_, k, v) __set_var(k, tonumber(v) or 0) end,
})

-- ---- speech / messages -----------------------------------------------------
function chatnpc(t) __chatnpc(_current, t) end
function say(t)     __say(_current, t) end
function mes(t)     __mes(t) end

-- ---- choices (suspending) — return a 1-based option index ------------------
-- Injected async JS fns return a wasmoon Promise userdata; :await() yields this
-- coroutine until it resolves (valid here because dispatch runs on a child
-- thread, not the main Lua thread). Every suspending wrapper below does the same.
function choice(...)
  local c = _current
  local r = __choice(...):await()
  _current = c
  return r
end
function dialog(title, body, ...)
  local c = _current
  local r = __dialog(title, body, ...):await()
  _current = c
  return r
end

-- ---- inventory / progression -----------------------------------------------
function add_item(id, n)  return __add_item(id, n or 1) end
function del_item(id, n)  __del_item(id, n or 1) end
function has_item(id)     return __has_item(id) end
function count_item(id)   return __count_item(id) end
function kills(kind)      return __kills(kind) end
function give_xp(skill,n) __give_xp(skill, n) end
function skill_lvl(name)  return __skill_lvl(name) end
function quest_point(n)   __quest_point(n or 1) end
function qp()             return __qp() end
function rand(n)          return __rand(n) end

-- ---- world-object removal (on_loc handlers) --------------------------------
function loc_del(policy)  __loc_del(_current, policy or "default") end

-- ---- time / environment ----------------------------------------------------
function time_hour(x)     return __time_hour(_current, x) end
function is_night()       return __is_night(_current) end
function is_bedtime()     return __is_bedtime(_current) end
function sky()            return __sky(_current) end

-- ---- stink -----------------------------------------------------------------
function stink_total()        return __stink_total() end
function stink_blocks_shops() return __stink_blocks_shops() end
function stink_blocks_gates() return __stink_blocks_gates() end

-- ---- shop / bank (bound NPC = the shopkeeper / banker) ---------------------
function shop_closed()       return __shop_closed(_current) end
function open_shop()         __open_shop(_current) end
function has_account()       return __has_account(_current) end
function open_bank()         __open_bank(_current) end
function bank_open_account() __bank_open_account(_current) end

-- ---- NPC-context readers ---------------------------------------------------
function here_x()      return __here_x(_current) end
function here_y()      return __here_y(_current) end
function here_level()  return __here_level(_current) end
function home_x()      return __home_x(_current) end
function home_y()      return __home_y(_current) end
function home_radius() return __home_radius(_current) end
function bed_x()       return __bed_x(_current) end
function bed_y()       return __bed_y(_current) end
function bed_level()   return __bed_level(_current) end

-- ---- player position (handlers with no bound NPC: on_item / on_kill) -------
function player_x() return __player_x() end
function player_y() return __player_y() end

-- ---- travel / fx / Weaver-position queries ---------------------------------
function teleport(x, y)  __teleport(x, y) end
function sfx(name)       __sfx(name) end
function weaver_tower_x() return __weaver_tower_x() end
function weaver_tower_y() return __weaver_tower_y() end
function at_tower()      return __at_tower() end
function spawn_x()       return __spawn_x() end
function spawn_y()       return __spawn_y() end

-- ---- routine motion (suspending; save/restore _current across the yield) ---
function walk_to(x, y, lv) local c = _current; __walk_to(c, x, y, lv):await(); _current = c end
function walk_home()       local c = _current; __walk_home(c):await();         _current = c end
function go_to_bed()       local c = _current; __go_to_bed(c):await();         _current = c end
function climb_to(lv)      local c = _current; __climb_to(c, lv):await();      _current = c end
function wander(r)         local c = _current; __wander(c, r):await();         _current = c end
function sleep_until(h)    local c = _current; __sleep_until(c, h):await();    _current = c end
function wait(sec)         local c = _current; __wait(c, sec):await();         _current = c end

-- ---- instant routine actions -----------------------------------------------
function open_door(x, y)  __open_door(x, y) end
function close_door(x, y) __close_door(x, y) end
function face(dir)        __face(_current, dir) end

-- ---- lamplighter -----------------------------------------------------------
function lamp_mode()       return __lamp_mode(_current) end
function claim_lamp_spot() return __claim_lamp_spot(_current) end
function lamp_spot_x()     return __lamp_spot_x(_current) end
function lamp_spot_y()     return __lamp_spot_y(_current) end
function light_lamp()      __light_lamp(_current) end

-- ---- scripted encounters (NEW) ---------------------------------------------
function spawn_monster(kind, x, y) return __spawn_monster(kind, x, y) end

-- ---- cutscene primitives (NEW; suspending ones save/restore _current) ------
function fade_out(sec)      local c = _current; __fade(1, sec or 0.6):await(); _current = c end
function fade_in(sec)       local c = _current; __fade(0, sec or 0.6):await(); _current = c end
function scene_text(t, sec) local c = _current; __scene_text(t, sec or 3.0):await(); _current = c end
function cam_zoom(z, sec)   local c = _current; __cam_zoom(z, sec or 1.0):await(); _current = c end
function play_bifrost()     __play_bifrost() end
function play_cutscene(name) __play_cutscene(name) end
