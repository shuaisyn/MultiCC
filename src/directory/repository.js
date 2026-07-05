'use strict';
// FsDirectoryRepository — the directories.json-backed implementation of
// REPOSITORY_PORT. Loading stays in server.js's loadPersistedState() because
// first-boot migration reads directories.json and sessions.json together; the
// repository wraps the Map that bootstrap produced. The Map reference is also
// shared into src/state.js (mutated, never reassigned), so legacy call sites
// that read `directories` directly keep working while they are migrated over.
const fs = require('fs');

function createFsDirectoryRepository({ file, map, realPathOf }) {
  if (!file) throw new TypeError('[directory] repository needs a file path');
  const dirs = map instanceof Map ? map : new Map();

  function get(id) { return dirs.get(id); }
  function list() { return [...dirs.values()]; }
  function add(dir) { dirs.set(dir.id, dir); return dir; }
  function remove(id) { return dirs.delete(id); }

  // Match by physical path (symlinks resolved) — duplicate registrations of the
  // same real directory are rejected by the service layer.
  function findByPath(resolvedPath, excludeId) {
    const target = realPathOf(resolvedPath);
    for (const d of dirs.values()) {
      if (excludeId && d.id === excludeId) continue;
      if (realPathOf(d.path) === target) return d;
    }
    return null;
  }

  function save() {
    try {
      fs.writeFileSync(file, JSON.stringify([...dirs.values()], null, 2));
    } catch (e) {
      console.error('[multicc] Failed to save directories.json:', e.message);
    }
  }

  // Transitional: expose the backing Map so server.js can keep the shared
  // `directories` reference (state.js) alive for not-yet-migrated domains.
  function mapRef() { return dirs; }

  return { get, list, add, remove, findByPath, save, map: mapRef };
}

module.exports = { createFsDirectoryRepository };
