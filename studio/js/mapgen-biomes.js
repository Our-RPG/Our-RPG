// ===== Our RPG — actual per-biome spawn ranges (6-axis Whittaker model) =====
// Derived by tracing the game's classifier classify(e,hum,temp,f,c,w) in
// js/world/terrain.js (biome ids from js/data.js `B`), with the real constants
// LAND_E = 0.483 (sea level) and ROCK_E = 0.655 (rock line). Each biome's rule
// is expressed as the [min,max] range of the six fields on its primary branch:
//   e = elevation · temp = temperature · hum = humidity · w = weird field
//   f = farm field · c = civ field   (unconstrained axis = [0,1])
// A few biomes also spawn via secondary branches (e.g. Glacier/Snow at several
// altitudes); these ranges capture the main one.
"use strict";

const MAPGEN_ELEV = { LAND_E: 0.483, ROCK_E: 0.655 };
const MAPGEN_BIOME_LEGEND = "Ranges traced from terrain.js classify(). Fields: e=elevation, temp=temperature (latitude+altitude), hum=humidity, w=weird field, f=farm field, c=civ field. Constants: LAND_E=0.483 (sea level), ROCK_E=0.655 (rock line).";

// keep the plain-language summary for each biome's details header
const BIOME_CONDITIONS = {
  "Deep Sea": "elevation < 0.40 (deep ocean)",
  "Sea": "0.40 ≤ elevation < sea level",
  "Coral Reef": "shallow warm water, weird > 0.62",
  "Beach": "sea level ≤ elevation < 0.497",
  "Volcano": "above rock line, weird > 0.74",
  "Glacier": "cold high ground (temp < 0.24, high elevation)",
  "Snowy Peaks": "cold at altitude (temp < 0.42)",
  "Mountains": "above rock line, temperate+",
  "Rockyland": "high ground (elevation > 0.64)",
  "Canyon": "highland, dry & warm",
  "Heather Moor": "highland, humid & cool",
  "Giant Mushroom Forest": "fantasy, humid & warm",
  "Ashen Forest": "fantasy, humid & cold",
  "Dream Forest": "fantasy, humid, temperate",
  "Salt Flats": "fantasy, hot & dry",
  "Crystal Fields": "fantasy, cold",
  "Bone Fields": "fantasy, warm",
  "Labyrinth": "fantasy, temp ≤ 0.55",
  "Wilderness": "very low weird field, cool",
  "Ruins": "very low weird field, warm",
  "Taiga": "boreal, humid",
  "Frozen Wastes": "sub-polar, dry cold",
  "Red Desert": "hot, very dry",
  "Oasis": "hot, dry, high farm field",
  "Desert": "hot, dry",
  "Savanna": "hot, semi-dry",
  "Bamboo Grove": "hot, humid, high farm field",
  "Jungle": "hot, humid",
  "Wetlands": "hot, very humid",
  "Badlands": "warm & dry",
  "Steppe": "temperate, dry",
  "Swamp": "temperate, very humid",
  "Blossom Grove": "temperate, humid, high farm field",
  "Forest": "temperate, humid",
  "Farmland": "temperate, high farm & civ field",
  "Meadow": "temperate, semi-humid",
  "Plains": "temperate lowland — the default",
};

// [min,max] per axis. F = full range.
const F = [0, 1];
const BIOME_RANGES = {
  "Deep Sea":              { e: [0, 0.40], temp: F, hum: F, w: F, f: F, c: F },
  "Sea":                   { e: [0.40, 0.483], temp: F, hum: F, w: F, f: F, c: F },
  "Coral Reef":            { e: [0.44, 0.483], temp: [0.68, 1], hum: F, w: [0.62, 1], f: F, c: F },
  "Beach":                 { e: [0.483, 0.497], temp: F, hum: F, w: F, f: F, c: F },
  "Volcano":               { e: [0.655, 1], temp: F, hum: F, w: [0.74, 1], f: F, c: F },
  "Glacier":               { e: [0.58, 1], temp: [0, 0.24], hum: F, w: F, f: F, c: F },
  "Snowy Peaks":           { e: [0.497, 1], temp: [0, 0.42], hum: F, w: F, f: F, c: F },
  "Mountains":             { e: [0.655, 1], temp: [0.42, 1], hum: F, w: [0, 0.74], f: F, c: F },
  "Canyon":                { e: [0.615, 0.655], temp: [0.55, 1], hum: [0, 0.32], w: F, f: F, c: F },
  "Heather Moor":          { e: [0.615, 0.655], temp: [0.38, 0.52], hum: [0.58, 1], w: F, f: F, c: F },
  "Rockyland":             { e: [0.64, 0.655], temp: [0.38, 1], hum: F, w: F, f: F, c: F },
  "Giant Mushroom Forest": { e: [0.497, 0.655], temp: [0.55, 1], hum: [0.53, 1], w: [0.76, 1], f: F, c: F },
  "Ashen Forest":          { e: [0.497, 0.655], temp: [0, 0.42], hum: [0.53, 1], w: [0.76, 1], f: F, c: F },
  "Dream Forest":          { e: [0.497, 0.655], temp: [0.42, 0.55], hum: [0.53, 1], w: [0.76, 1], f: F, c: F },
  "Salt Flats":            { e: [0.497, 0.655], temp: [0.64, 1], hum: [0, 0.48], w: [0.76, 1], f: F, c: F },
  "Crystal Fields":        { e: [0.497, 0.655], temp: [0, 0.34], hum: [0, 0.53], w: [0.76, 1], f: F, c: F },
  "Bone Fields":           { e: [0.497, 0.655], temp: [0.55, 1], hum: [0, 0.53], w: [0.76, 1], f: F, c: F },
  "Labyrinth":             { e: [0.497, 0.655], temp: [0.34, 0.55], hum: [0, 0.53], w: [0.76, 1], f: F, c: F },
  "Wilderness":            { e: [0.497, 0.655], temp: [0, 0.50], hum: F, w: [0, 0.24], f: F, c: F },
  "Ruins":                 { e: [0.497, 0.655], temp: [0.50, 1], hum: F, w: [0, 0.24], f: F, c: F },
  "Taiga":                 { e: [0.497, 0.655], temp: [0, 0.42], hum: [0.50, 1], w: [0.24, 0.76], f: F, c: F },
  "Frozen Wastes":         { e: [0.497, 0.655], temp: [0, 0.42], hum: [0.35, 0.55], w: [0.24, 0.76], f: F, c: F },
  "Red Desert":            { e: [0.497, 0.655], temp: [0.65, 1], hum: [0, 0.26], w: [0.24, 0.76], f: F, c: F },
  "Oasis":                 { e: [0.497, 0.655], temp: [0.65, 1], hum: [0.26, 0.44], w: [0.24, 0.76], f: [0.78, 1], c: F },
  "Desert":                { e: [0.497, 0.655], temp: [0.65, 1], hum: [0.26, 0.44], w: [0.24, 0.76], f: [0, 0.78], c: F },
  "Savanna":               { e: [0.497, 0.655], temp: [0.65, 1], hum: [0.44, 0.58], w: [0.24, 0.76], f: F, c: F },
  "Bamboo Grove":          { e: [0.497, 0.655], temp: [0.65, 1], hum: [0.58, 0.70], w: [0.24, 0.76], f: [0.64, 1], c: F },
  "Jungle":                { e: [0.497, 0.655], temp: [0.65, 1], hum: [0.58, 0.70], w: [0.24, 0.76], f: [0, 0.64], c: F },
  "Wetlands":              { e: [0.497, 0.655], temp: [0.65, 1], hum: [0.70, 1], w: [0.24, 0.76], f: F, c: F },
  "Badlands":              { e: [0.497, 0.655], temp: [0.56, 0.65], hum: [0, 0.32], w: [0.24, 0.76], f: F, c: F },
  "Steppe":                { e: [0.497, 0.655], temp: [0.42, 0.56], hum: [0, 0.28], w: [0.24, 0.76], f: F, c: F },
  "Swamp":                 { e: [0.497, 0.655], temp: [0.42, 0.65], hum: [0.72, 1], w: [0.24, 0.76], f: F, c: F },
  "Blossom Grove":         { e: [0.497, 0.655], temp: [0.44, 0.65], hum: [0.55, 0.72], w: [0.24, 0.76], f: [0.70, 1], c: F },
  "Forest":                { e: [0.497, 0.655], temp: [0.42, 0.65], hum: [0.55, 0.72], w: [0.24, 0.76], f: F, c: F },
  "Farmland":              { e: [0.497, 0.655], temp: [0.42, 0.65], hum: [0.28, 0.55], w: [0.24, 0.76], f: [0.62, 1], c: [0.48, 1] },
  "Meadow":                { e: [0.497, 0.655], temp: [0.42, 0.65], hum: [0.46, 0.55], w: [0.24, 0.76], f: F, c: F },
  "Plains":                { e: [0.497, 0.655], temp: [0.42, 0.65], hum: [0.28, 0.46], w: [0.24, 0.76], f: F, c: F },
};

// The world-gen PRIMITIVES — the seed, noise generators and global constants
// every field is built from (traced from js/world/terrain.js + js/world.js).
// Every value except the seed is a votable tuning knob.
const MAPGEN_PRIMITIVES = [
  { key: "seed",        name: "WORLD_SEED",         eq: "1337", floats: [] },
  { key: "fbm",         name: "FBM",                eq: "Σᵢ noise·ampᵢ / Σampᵢ,   amp ×= 0.5,   coords ×= 2",
    floats: [{ label: "gain (persistence)", value: "0.5", field: "fbm.gain" }, { label: "lacunarity", value: "2", field: "fbm.lacunarity" }] },
  { key: "value_noise", name: "VALUE_NOISE",        eq: "t²·(3 − 2·t)   (smoothstep)",
    floats: [{ label: "smoothstep a", value: "3", field: "value_noise.a" }, { label: "smoothstep b", value: "2", field: "value_noise.b" }] },
  { key: "ridge_noise", name: "RIDGE_NOISE",        eq: "1 − |2·noise − 1|,   amp ×= 0.5",
    floats: [{ label: "outer offset (1 − …)", value: "1", field: "ridge_noise.outer" }, { label: "fold multiplier (2·noise)", value: "2", field: "ridge_noise.fold" }, { label: "inner offset (… − 1)", value: "1", field: "ridge_noise.inner" }, { label: "amplitude (gain)", value: "0.5", field: "ridge_noise.gain" }] },
  { key: "rotation",    name: "ROTATION_CONSTANTS", eq: "(x·cos 0.6 − y·sin 0.6)·2,   (x·sin 0.6 + y·cos 0.6)·2",
    floats: [{ label: "θ (radians)", value: "0.6", field: "rotation.theta" }, { label: "lacunarity", value: "2", field: "rotation.lacunarity" }] },
  { key: "lat_period",  name: "LAT_PERIOD",         eq: "7500 map units / pole cycle",
    floats: [{ label: "map units / pole cycle", value: "7500", field: "lat_period" }] },
  { key: "land_e",      name: "LAND_E",             eq: "0.483   (sea level)",
    floats: [{ label: "sea level", value: "0.483", field: "land_e" }] },
  { key: "rock_e",      name: "ROCK_E",             eq: "0.655   (rock line)",
    floats: [{ label: "rock line", value: "0.655", field: "rock_e" }] },
];

// Parameters of the INDEPENDENT fields (Elevation, Civilisation, Weirdness,
// Fertility) — the ones built straight from primitives, before Temperature and
// Humidity derive from Elevation. Most are fBm noise fields (freq + octaves);
// a few are plain scalars (mix ratios, strengths, blend targets) shown as
// `extra` with no freq/octaves. Every present value is votable.
const MAPGEN_FIELD_PARAMS = [
  { key: "continent_scale", name: "CONTINENT_SCALE", eq: "fBm(x·0.0028, 4 oct)",
    floats: [{ label: "frequency", value: "0.0028", field: "continent.freq" }, { label: "octaves", value: "4", field: "continent.oct" }] },
  { key: "detail_scale", name: "DETAIL_SCALE", eq: "fBm(x·0.02, 4 oct)",
    floats: [{ label: "frequency", value: "0.02", field: "detail.freq" }, { label: "octaves", value: "4", field: "detail.oct" }] },
  { key: "mountain_ridge_strength", name: "MOUNTAIN-RIDGE_STRENGTH", eq: "ridge(x·0.006, 4 oct) · max(0, cont − 0.50) · 0.40",
    floats: [{ label: "frequency", value: "0.006", field: "ridge.freq" }, { label: "octaves", value: "4", field: "ridge.oct" }, { label: "high-ground gate", value: "0.50", field: "ridge.gate" }, { label: "strength", value: "0.40", field: "ridge.strength" }] },
  { key: "island_bump", name: "ISLAND_BUMP", eq: "(fBm(x·0.016, 3 oct) − 0.60) · 0.55   if > 0.60",
    floats: [{ label: "frequency", value: "0.016", field: "island.freq" }, { label: "octaves", value: "3", field: "island.oct" }, { label: "threshold", value: "0.60", field: "island.threshold" }, { label: "strength", value: "0.55", field: "island.strength" }] },
  { key: "domain_warp_wobble", name: "DOMAIN-WARP_WOBBLE", eq: "(fBm(x·0.008, 2 oct) − 0.5) · 90",
    floats: [{ label: "frequency", value: "0.008", field: "warp.freq" }, { label: "octaves", value: "2", field: "warp.oct" }, { label: "amplitude (units)", value: "90", field: "warp.amp" }] },
  { key: "civilisation_scale", name: "CIVILISATION_SCALE", eq: "fBm(x·0.0012, 2 oct)",
    floats: [{ label: "frequency", value: "0.0012", field: "civ.freq" }, { label: "octaves", value: "2", field: "civ.oct" }] },
  { key: "weirdness_scale", name: "WEIRDNESS_SCALE", eq: "fBm(x·0.002, 2 oct)",
    floats: [{ label: "frequency", value: "0.002", field: "weird.freq" }, { label: "octaves", value: "2", field: "weird.oct" }] },
  { key: "fertility_scale", name: "FERTILITY_SCALE", eq: "fBm(x·0.025, 3 oct)",
    floats: [{ label: "frequency", value: "0.025", field: "farm.freq" }, { label: "octaves", value: "3", field: "farm.oct" }] },
];

// Scalar knobs — plain tuning values, not noise fields: field weightings,
// origin-blend targets, and the time-of-day / weather dials. `field` preserves
// the day/night & weather rules' original vote identity.
const MAPGEN_SCALARS = [
  { key: "continent_detail_mix", name: "CONTINENT_DETAIL_MIX", eq: "CONTINENT_SCALE·0.72 + DETAIL_SCALE·0.28",
    floats: [{ label: "continent weight", value: "0.72", field: "mix.cont" }, { label: "detail weight", value: "0.28", field: "mix.detail" }] },
  { key: "civilisation_blend_target", name: "CIVILISATION_BLEND_TARGET", eq: "CIVILISATION_SCALE → 0.72 near origin",
    floats: [{ label: "origin target", value: "0.72", field: "civ.blend" }] },
  { key: "weirdness_blend_target", name: "WEIRDNESS_BLEND_TARGET", eq: "WEIRDNESS_SCALE → 0.5 near origin",
    floats: [{ label: "origin target", value: "0.5", field: "weird.blend" }] },
];

// Game knobs — time-of-day & weather dials, independent of the terrain fields.
const MAPGEN_GAME = [
  { key: "daynight_length", name: "DAY/NIGHT_LENGTH", eq: "64 real minutes / game day",
    floats: [{ label: "real minutes / day", value: "64", field: "daynight_length" }] },
  { key: "night_darkness", name: "NIGHT_DARKNESS", eq: "min(1 − daylight, 0.99);   towns cap 0.9",
    floats: [{ label: "max darkness", value: "0.99", field: "night_darkness" }, { label: "town cap", value: "0.9", field: "night_darkness.town" }] },
  { key: "weather_frequency", name: "WEATHER_FREQUENCY", eq: "anomaly blows west at 0.4 tiles/s → front ≈ 58 min",
    floats: [{ label: "prevailing wind (tiles/s)", value: "0.4", field: "weather_frequency.wind" }] },
  { key: "weather_intensity", name: "WEATHER_INTENSITY", eq: "clamp((p − 0.38) / 0.55);   anomaly ×3.7",
    floats: [{ label: "anomaly amplitude", value: "3.7", field: "weather_intensity.amp" }, { label: "precip threshold", value: "0.38", field: "weather_intensity.thr" }, { label: "precip range", value: "0.55", field: "weather_intensity.range" }] },
];

// Derived fields & downstream systems — Temperature & Humidity derive from
// Elevation + Latitude (Humidity also sums the components below); rivers/roads/
// settlements/vegetation are stamped per chunk. Traced from terrain.js +
// features.js + chunks.js. Constants are votable.
const MAPGEN_DERIVED = [
  { key: "temperature", name: "TEMPERATURE", eq: "clamp(1 − warmCurve(lat) − 0.55·(e − LAND_E)/(1 − LAND_E) + noise);   → 0.52 origin",
    floats: [{ label: "warm-curve knee (latitude)", value: "0.75", field: "temperature.warm_knee" }, { label: "warm-curve knee (value)", value: "0.44", field: "temperature.warm_val" }, { label: "altitude lapse", value: "0.55", field: "temperature.lapse" }, { label: "noise amplitude", value: "0.18", field: "temperature.noise_amp" }, { label: "noise frequency", value: "0.003", field: "temperature.noise_freq" }, { label: "origin blend target", value: "0.52", field: "temperature.blend" }] },
  { key: "humidity", name: "HUMIDITY", eq: "clamp(latHum + 0.25·concavity + BASIN_FLOW + COASTAL_BAND − RAIN_SHADOW + noise);   → 0.45 origin",
    floats: [{ label: "equatorial wetness", value: "0.55", field: "humidity.equatorial" }, { label: "subtropical bump", value: "0.18", field: "humidity.sinterm" }, { label: "valley-concavity weight", value: "0.25", field: "humidity.concavity" }, { label: "noise base amplitude", value: "0.28", field: "humidity.noise_base" }, { label: "noise variance", value: "1.6", field: "humidity.noise_var" }, { label: "origin blend target", value: "0.45", field: "humidity.blend" }] },
  { key: "basin_flow", name: "BASIN_FLOW", eq: "max(0, 0.5 − fBm(x·0.0018, 2 oct)) · 0.32 · (1 − e)",
    floats: [{ label: "midpoint", value: "0.5", field: "basin_flow.mid" }, { label: "frequency", value: "0.0018", field: "basin_flow.freq" }, { label: "octaves", value: "2", field: "basin_flow.oct" }, { label: "strength", value: "0.32", field: "basin_flow.strength" }] },
  { key: "coastal_band", name: "COASTAL_BAND", eq: "(1 − (e − LAND_E)/0.06) · 0.08   if LAND_E ≤ e < LAND_E + 0.06",
    floats: [{ label: "band width", value: "0.06", field: "coastal_band.width" }, { label: "strength", value: "0.08", field: "coastal_band.strength" }] },
  { key: "rain_shadow", name: "RAIN_SHADOW", eq: "max(0, (e − 0.57) · 2.8)",
    floats: [{ label: "elevation threshold", value: "0.57", field: "rain_shadow.threshold" }, { label: "strength", value: "2.8", field: "rain_shadow.strength" }] },
  { key: "rivers", name: "RIVERS", eq: "source grid RIVCELL 192;   reach ≤ 1200 tiles",
    floats: [{ label: "source-cell size", value: "192", field: "rivers.cell" }, { label: "reach (tiles)", value: "1200", field: "rivers.reach" }] },
  { key: "roads", name: "ROADS", eq: "A* on step 6;   width 1.4;   max 520 tiles;   water cost ×8",
    floats: [{ label: "path step", value: "6", field: "roads.step" }, { label: "width", value: "1.4", field: "roads.width" }, { label: "max length (tiles)", value: "520", field: "roads.max" }, { label: "water cost ×", value: "8", field: "roads.water_cost" }] },
  { key: "settlements", name: "SETTLEMENTS", eq: "village grid VCELL 144;   POIs 30;   icons 44;   cities link ≤ 14 cells",
    floats: [{ label: "village cell", value: "144", field: "settlements.vcell" }, { label: "POI cell", value: "30", field: "settlements.pcell" }, { label: "icon cell", value: "44", field: "settlements.icell" }, { label: "city link cells", value: "14", field: "settlements.link" }] },
  { key: "ground_vegetation", name: "GROUND/VEGETATION", eq: "per chunk (32² = 1024 tiles):  count ≈ BIOME_VEG density · 1024 · 1.0",
    floats: [{ label: "global density ×", value: "1.0", field: "ground_vegetation.density_mult" }, { label: "chunk side (tiles)", value: "32", field: "ground_vegetation.chunk" }] },
];

// All remaining procgen systems, grouped into titled sections. Traced from
// erosion.js / chunks.js / features.js / quests.js / bestiary-drops.js /
// daynight.js / birdflight.js / content.js. Every constant is votable.
const MAPGEN_SYSTEMS = (() => {
  const f = (label, value, field) => ({ label, value, field });
  return [
  { title: "Erosion", note: "Hydraulic droplet walk (SimpleHydrology) that carves each chunk's heightfield.", rows: [
    { name: "EROSION_DROPLET", eq: "erode/deposit dep·Δcapacity;  vel = (vel + grav·grad)·0.85;  vol ×= (1 − evap)",
      floats: [f("droplets", "120", "erosion.droplets"), f("evaporation", "0.001", "erosion.evap"), f("deposition rate", "0.08", "erosion.dep"), f("gravity", "0.12", "erosion.grav"), f("entrainment", "6.0", "erosion.entr"), f("min volume", "0.01", "erosion.minv"), f("max age", "350", "erosion.maxage"), f("spawn gate (elev)", "0.46", "erosion.spawn_gate"), f("momentum damping", "0.85", "erosion.damping")] },
    { name: "EROSION_HUMIDITY", eq: "disHum = min(0.30, discharge / 120 · 0.35)",
      floats: [f("cap", "0.30", "erosion.hum_cap"), f("divisor", "120", "erosion.hum_div"), f("scale", "0.35", "erosion.hum_scale")] },
    { name: "TERRAIN_FLAVOUR", eq: "fBm(x·0.014, 2 oct)", floats: [f("frequency", "0.014", "erosion.tf_freq"), f("octaves", "2", "erosion.tf_oct")] },
  ] },
  { title: "Ore, gems & tier progression", note: "Resource-node tiers, vein rolls and the shared level→value/xp/respawn curves.", rows: [
    { name: "GEM_VEIN_CHANCE", eq: "rng < 0.12  → gem vein (else metal rock)", floats: [f("chance", "0.12", "ore.gem_chance")] },
    { name: "GEM_TIER_BIAS", eq: "tier = ⌊r³ · N⌋   (cubic, low-tier biased)", floats: [f("exponent", "3", "ore.gem_tier_exp")] },
    { name: "GEM_ROLL_BIAS", eq: "⌊r² · n⌋   (quadratic)", floats: [f("exponent", "2", "ore.gem_roll_exp")] },
    { name: "ROLL_TIER", eq: "⌊r^2.3 · (cap + 1)⌋", floats: [f("exponent", "2.3", "ore.rolltier_exp")] },
    { name: "LOCAL_TIER_CAP", eq: "2 + dist·1.2 + (fBm(x·0.012, 2 oct) − 0.5)·8;   hotspot rand < 0.10 → +(6 + r·12)",
      floats: [f("base", "2", "ore.cap_base"), f("dist scale", "1.2", "ore.cap_dist"), f("frequency", "0.012", "ore.cap_freq"), f("noise amplitude", "8", "ore.cap_noise"), f("hotspot chance", "0.10", "ore.cap_hot_ch"), f("hotspot base", "6", "ore.cap_hot_base"), f("hotspot range", "12", "ore.cap_hot_range")] },
    { name: "TIER_VALUE", eq: "max(1, round(4 · 1.16^tier))", floats: [f("base", "4", "tier.value_base"), f("growth", "1.16", "tier.value_growth")] },
    { name: "TIER_XP", eq: "round(base · (1 + tier·0.55))", floats: [f("growth", "0.55", "tier.xp_growth")] },
    { name: "RESPAWN_CURVE", eq: "piecewise: L1→7s, L8→30s, L16→60s, L24→120s, L32→300s",
      floats: [f("L1 (s)", "7", "tier.respawn_1"), f("L8 (s)", "30", "tier.respawn_8"), f("L16 (s)", "60", "tier.respawn_16"), f("L24 (s)", "120", "tier.respawn_24"), f("L32 (s)", "300", "tier.respawn_32")] },
    { name: "FISH_BAND_DECAY", eq: "geometric weighting DECAY 0.6 across a band's fish", floats: [f("decay", "0.6", "tier.fish_decay")] },
  ] },
  { title: "Monster spawns", note: "Spawn level scales with distance from origin; pack/herd sizes.", rows: [
    { name: "SPAWN_LEVEL_CAP", eq: "hiCap = (5 + dist·6) · LEVEL_SCALE", floats: [f("base", "5", "spawn.cap_base"), f("dist scale", "6", "spawn.cap_dist")] },
    { name: "SPAWN_LEVEL_TARGET", eq: "1 + r^1.8 · (hiCap − 1)", floats: [f("exponent", "1.8", "spawn.target_exp")] },
    { name: "SPAWN_BAND", eq: "target ± 6 · LEVEL_SCALE", floats: [f("band", "6", "spawn.band")] },
    { name: "PACK_SIZE", eq: "3 + ⌊r·3⌋   (3–5)", floats: [f("base", "3", "spawn.pack_base"), f("range", "3", "spawn.pack_range")] },
    { name: "LEVEL_SCALE", eq: "MAX_LEVEL / 99 = 32 / 99 ≈ 0.323", floats: [f("max level", "32", "spawn.max_level"), f("divisor", "99", "spawn.scale_div")] },
    { name: "HERD_SIZE", eq: "2 + ⌊r·4⌋  (2–5);   elite if r < 1/6", floats: [f("base", "2", "spawn.herd_base"), f("range", "4", "spawn.herd_range"), f("elite chance", "0.167", "spawn.elite_ch")] },
    { name: "CAMP_GARRISON", eq: "band (8 + dist·7)·LEVEL_SCALE;   pack 3 + ⌊r·3⌋", floats: [f("base", "8", "spawn.camp_base"), f("dist scale", "7", "spawn.camp_dist")] },
  ] },
  { title: "POIs & wilderness features", note: "Existence gates and grid cells for points-of-interest, portals, icons & chests.", rows: [
    { name: "POI_EXISTENCE", eq: "rand < 0.30 + civ·0.30", floats: [f("base", "0.30", "poi.base"), f("civ scale", "0.30", "poi.civ")] },
    { name: "POI_GRID", eq: "PCELL 30 tiles", floats: [f("cell", "30", "poi.cell")] },
    { name: "PORTAL", eq: "PORTAL_CELL 100 map units;   min spacing 200 tiles", floats: [f("cell", "100", "poi.portal_cell"), f("min spacing", "100", "poi.portal_min")] },
    { name: "WILD_ICON", eq: "rand < 0.2 + civ·0.6;   ICELL 44", floats: [f("base", "0.2", "poi.wild_base"), f("civ scale", "0.6", "poi.wild_civ"), f("cell", "44", "poi.wild_cell")] },
    { name: "WAYSIDE_CHEST", eq: "192×192 lattice;   rand < 0.3", floats: [f("lattice", "192", "poi.chest_lattice"), f("chance", "0.3", "poi.chest_ch")] },
  ] },
  { title: "Settlement layout", note: "Where villages/cities exist and how their streets & buildings are placed.", rows: [
    { name: "VILLAGE_EXISTENCE", eq: "e ∈ [0.51, 0.70] ∧ temp ≥ 0.28 ∧ weird ∈ (0.28, 0.72)",
      floats: [f("elev min", "0.51", "settle.e_min"), f("elev max", "0.70", "settle.e_max"), f("temp min", "0.28", "settle.t_min"), f("weird min", "0.28", "settle.w_min"), f("weird max", "0.72", "settle.w_max")] },
    { name: "CITY_VS_VILLAGE", eq: "civ = max(0, civField − 0.40);   r < civ·0.7 → city, < civ·2.0 → village", floats: [f("civ floor", "0.40", "settle.civ_floor"), f("city factor", "0.7", "settle.city_f"), f("village factor", "2.0", "settle.village_f")] },
    { name: "CITY_RADIUS", eq: "19 + hash%6   (origin 34)", floats: [f("base", "19", "settle.city_r_base"), f("range", "6", "settle.city_r_range"), f("origin", "34", "settle.city_r_origin")] },
    { name: "CITY_BLOCKS", eq: "street step 8;   density inner 0.95 / mid 0.78 / outer 0.52", floats: [f("street step", "8", "settle.street"), f("inner", "0.95", "settle.d_inner"), f("mid", "0.78", "settle.d_mid"), f("outer", "0.52", "settle.d_outer")] },
    { name: "WALL_KEEP_WELL", eq: "wall rand < 0.62;   keep rand < 0.32;   village well rand < 0.75", floats: [f("wall chance", "0.62", "settle.wall_ch"), f("keep chance", "0.32", "settle.keep_ch"), f("well chance", "0.75", "settle.well_ch")] },
    { name: "STONE_BIAS", eq: "0.25 + rand·0.55   (desert +0.35, forest −0.20, cold +0.10)", floats: [f("base", "0.25", "settle.stone_base"), f("rand", "0.55", "settle.stone_rand")] },
  ] },
  { title: "Ground variants & grid cells", note: "Regional tile-variant and personality fields laid over the biomes.", rows: [
    { name: "ATLAS_VARIANT", eq: "RCELL 300;   4-corner hash%4 smoothstep blend", floats: [f("cell", "300", "variant.rcell")] },
    { name: "PERSONALITY", eq: "PERCELL 700;   4-corner hash%6 smoothstep blend", floats: [f("cell", "700", "variant.percell")] },
  ] },
  { title: "Celestial (moon & aurora)", note: "Night-time light sources layered over the darkness field.", rows: [
    { name: "MOON_CYCLE", eq: "8 days;   illum = ½·(1 − cos(2π·age))", floats: [f("cycle (days)", "8", "sky.moon_cycle")] },
    { name: "MOONLIGHT", eq: "illum · min(1, elev/0.035);   dark ×= 1 − 0.12·moon", floats: [f("elevation norm", "0.035", "sky.moon_elev"), f("darkness relief", "0.12", "sky.moon_dark")] },
    { name: "AURORA", eq: "20-min slots;   active if hash ≤ 0.30;   peak 0.55 + 0.45·hash", floats: [f("slot (min)", "20", "sky.aurora_slot"), f("active chance", "0.30", "sky.aurora_ch"), f("peak base", "0.55", "sky.aurora_base"), f("peak range", "0.45", "sky.aurora_range")] },
  ] },
  { title: "Dream world", note: "The off-grid dream dimension's layout (DREAM_WORLD).", rows: [
    { name: "DREAM_LAYOUT", eq: "column x = −3800;   Y0 2300;   ΔY 500;   5 levels", floats: [f("column x", "-3800", "dream.cx"), f("Y0", "2300", "dream.y0"), f("ΔY", "500", "dream.dy")] },
    { name: "DREAM_DISC", eq: "sep D = 55·(i+1);   R = D/2 + 65;   glade 26", floats: [f("separation", "55", "dream.sep"), f("R offset", "65", "dream.r_off"), f("glade radius", "26", "dream.glade")] },
    { name: "DREAM_LUSH", eq: "vegetation ×2.6 in dream chunks", floats: [f("lushness", "2.6", "dream.lush")] },
  ] },
  { title: "Fauna (bird flight)", note: "Deterministic-ish flight/perch/roost behaviour for birds.", rows: [
    { name: "BIRD_STEERING", eq: "turn 2.4 rad/s;   jink sin(t)·1.6;   boost ×1.35;   climb 2.2 + sp·0.25", floats: [f("turn rate", "2.4", "bird.turn"), f("jink", "1.6", "bird.jink"), f("boost ×", "1.35", "bird.boost"), f("climb base", "2.2", "bird.climb_base"), f("climb scale", "0.25", "bird.climb_scale")] },
    { name: "BIRD_PERCH", eq: "60 candidates;   radius (ground?4:7) + r·(10|20);   flight ≤ 40s", floats: [f("candidates", "60", "bird.cands"), f("ground radius", "4", "bird.r_ground"), f("air radius", "7", "bird.r_air"), f("flight deadline (ms)", "40000", "bird.deadline")] },
    { name: "BIRD_ROOST", eq: "roost 60–180s;   perch 9–31s;   escort within 14 tiles", floats: [f("roost base (ms)", "60000", "bird.roost_base"), f("roost range (ms)", "120000", "bird.roost_range"), f("escort radius", "14", "bird.escort")] },
  ] },
  ];
})();
