'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickMoveDest: () => ipcRenderer.invoke('pick-move-dest'),
  scanFolder: f => ipcRenderer.invoke('scan-folder', f),
  getLibrary: () => ipcRenderer.invoke('get-library'),
  getThumb: p => ipcRenderer.invoke('get-thumb', p),
  readImage: p => ipcRenderer.invoke('read-image', p),
  getDuplicates: () => ipcRenderer.invoke('get-duplicates'),
  updateImage: (p, patch) => ipcRenderer.invoke('update-image', p, patch),
  createAlbum: name => ipcRenderer.invoke('create-album', name),
  deleteAlbum: id => ipcRenderer.invoke('delete-album', id),
  renameAlbum: (id, name) => ipcRenderer.invoke('rename-album', id, name),
  addToAlbum: (id, paths) => ipcRenderer.invoke('add-to-album', id, paths),
  removeFromAlbum: (id, paths) => ipcRenderer.invoke('remove-from-album', id, paths),
  renameFiles: pairs => ipcRenderer.invoke('rename-files', pairs),
  moveFiles: (paths, dest) => ipcRenderer.invoke('move-files', paths, dest),
  trashFiles: paths => ipcRenderer.invoke('trash-files', paths),
  reviveFiles: paths => ipcRenderer.invoke('revive-files', paths),
  removeRecords: paths => ipcRenderer.invoke('remove-records', paths),
  openInFolder: p => ipcRenderer.invoke('open-in-folder', p),
  setFlag: (k, v) => ipcRenderer.invoke('set-flag', k, v),
  aiClassifyAll: opts => ipcRenderer.invoke('ai-classify-all', opts),
  aiStop: () => ipcRenderer.invoke('ai-stop'),
  aiStatus: () => ipcRenderer.invoke('ai-status'),
  on: (ch, cb) => ipcRenderer.on(ch, (e, d) => cb(d))
});
