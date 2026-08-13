const { contextBridge, ipcRenderer } = require('electron')
const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args)
contextBridge.exposeInMainWorld('dshd', {
  getState: invoke('get-state'),
  setConfig: invoke('set-config'),
  setAutostart: invoke('set-autostart'),
  setPortable: invoke('set-portable'),
  relaunchApp: invoke('relaunch-app'),
  openPath: invoke('open-path'),
  openExternal: invoke('open-external'),
  checkUpdate: invoke('check-update'),
  restartHarness: invoke('restart-harness'),
  getLogs: invoke('get-logs'),
})
