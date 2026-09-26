'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let data = null;
const index = new Map();
let saveTimer = null;

function file() { return path.join(app.getPath('userData'), 'library.json'); }

function load() {
  if (data) return data;
  try { data = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch {
    data = { flags: {}, folders: [], images: [], albums: [] };
  }
  data.images = data.images || [];
  data.albums = data.albums || [];
  data.folders = data.folders || [];
  data.flags = data.flags || {};
  index.clear();
  for (const im of data.images) index.set(im.path, im);
  return data;
}

function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSync, 800); }

function flushSync() {
  if (!data) return;
  clearTimeout(saveTimer); saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(data));
  } catch (e) { console.error('db flush failed:', e); }
}

module.exports = {
  load,
  flushSync,
  getFlags: () => load().flags,
  setFlag(k, v) { load(); data.flags[k] = v; save(); },
  getFolders: () => load().folders,
  addFolder(f) {
    load();
    if (!data.folders.includes(f)) { data.folders.push(f); save(); }
  },
  getImages: () => load().images,
  getImage: p => index.get(p) || null,
  upsertImage(rec) {
    load();
    const ex = index.get(rec.path);
    if (ex) Object.assign(ex, rec);
    else { data.images.push(rec); index.set(rec.path, rec); }
    save();
  },
  updateImage(p, patch) {
    const im = index.get(p);
    if (im) { Object.assign(im, patch); save(); }
  },
  revive(p) {
    const im = index.get(p);
    if (im) { im.trashed = false; im.missing = false; save(); }
  },
  markTrashed(p) {
    const im = index.get(p);
    if (im) { im.trashed = true; save(); }
  },
  removeImages(paths) {
    load();
    const s = new Set(paths);
    data.images = data.images.filter(i => !s.has(i.path));
    for (const p of s) index.delete(p);
    for (const a of data.albums) a.paths = (a.paths || []).filter(p => !s.has(p));
    save();
  },
  updatePath(oldP, newP) {
    const im = index.get(oldP);
    if (!im) return;
    index.delete(oldP);
    im.path = newP;
    try { im.mtime = fs.statSync(newP).mtimeMs; } catch { /* ignore */ }
    index.set(newP, im);
    for (const a of data.albums) {
      const i = (a.paths || []).indexOf(oldP);
      if (i >= 0) a.paths[i] = newP;
    }
    save();
  },
  getAlbums: () => load().albums,
  createAlbum(name) {
    load();
    const a = { id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6), name, paths: [], createdAt: Date.now() };
    data.albums.push(a);
    save();
    return a;
  },
  deleteAlbum(id) { load(); data.albums = data.albums.filter(a => a.id !== id); save(); },
  renameAlbum(id, name) {
    const a = load().albums.find(x => x.id === id);
    if (a) { a.name = name; save(); }
  },
  addToAlbum(id, paths) {
    const a = load().albums.find(x => x.id === id);
    if (!a) return;
    const s = new Set(a.paths || []);
    for (const p of paths) s.add(p);
    a.paths = [...s];
    save();
  },
  removeFromAlbum(id, paths) {
    const a = load().albums.find(x => x.id === id);
    if (!a) return;
    const s = new Set(paths);
    a.paths = (a.paths || []).filter(p => !s.has(p));
    save();
  }
};
