// ===== Our RPG Workshop — local project library (IndexedDB) =====
// Everything a player generates lives here on their own device: characters &
// objects, each with variant states/costumes, animations and direction sets,
// plus the design metadata the game needs (name, bio, spawning rules,
// animation-event triggers, state-change triggers). Sprites are stored as
// data URLs, so a project row can be fat — hence IndexedDB rather than
// localStorage. Nothing leaves the device until the player submits a costume
// proposal to the workshop (js/taiao.js).
//
// Project shape:
//   { id, kind:"character"|"object", name, prompt, folder, createdAt, updatedAt,
//     gen: { view, size, outline, shading, detail, template, ... },   // controls used
//     base: { dir: dataUrl, ... } | { image: dataUrl },               // the generated art
//     bio, spawn: {biomes, rarity, notes},                            // character design
//     eventTriggers: [{event, action}], stateTriggers: [{when, toState}],
//     states: [{ id, name, slot, item, dirs:{dir:dataUrl}, note }],   // variant costumes/states
//     anims:  [{ id, action, frames:[dataUrl] }],                     // animations
//   }
"use strict";

const Store = (function () {
  const DB_NAME = "pixellab_studio";
  const DB_VER = 1;
  const STORE = "projects";
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("kind", "kind", { unique: false });
          os.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const os = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(os)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  async function all(kind) {
    const rows = await tx("readonly", os => reqP(os.getAll()));
    const list = (rows || []).filter(r => !kind || r.kind === kind);
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list;
  }
  const get = id => tx("readonly", os => reqP(os.get(id)));
  const remove = id => tx("readwrite", os => reqP(os.delete(id)));

  function newProject(kind, name) {
    const now = Date.now();
    return {
      id: rid(), kind, name: name || (kind === "character" ? "New character" : "New object"),
      prompt: "", folder: slug(name), createdAt: now, updatedAt: now,
      gen: {}, base: kind === "character" ? {} : null,
      bio: "", spawn: { biomes: "", rarity: "", notes: "" },
      eventTriggers: [], stateTriggers: [],
      states: [], anims: [],
    };
  }

  async function save(p) {
    p.updatedAt = Date.now();
    if (!p.folder) p.folder = slug(p.name);
    await tx("readwrite", os => reqP(os.put(p)));
    return p;
  }

  // Rough byte weight of the library, for a friendly "storage used" readout.
  async function usage() {
    const rows = await all();
    let bytes = 0;
    for (const r of rows) bytes += JSON.stringify(r).length;
    return { count: rows.length, bytes };
  }

  return { all, get, save, remove, newProject, usage };
})();
