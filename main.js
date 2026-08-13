// DeepSeek Harness 桌面版 —— 主进程
// 职责: 托管官方 dsh Web UI (node 侧车进程), 提供壳层功能(设置/主题/托盘/自启/快捷键/角标)
const { app, BrowserWindow, Tray, Menu, globalShortcut, shell, ipcMain, nativeImage } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')
const http = require('http')

const APP_NAME = 'DeepSeekHarness桌面版'
const APP_VERSION = '0.1.0'
const DSH_VERSION = '0.1.0-rc.6'
const PORT_START = 3080
const PORT_END = 3090

const DEFAULT_CONFIG = {
  theme: 'deepsea',
  badgeUrl: 'https://space.bilibili.com/34234499',
  badgeLabel: '作者 B站频道',
}

const THEMES = {
  deepsea:  { name: '深海蓝',   bg: '#0B1220', panel: '#121B2E', accent: '#4D6BFE', text: '#E6EAF2', dim: '#8A93A6', light: false },
  midnight: { name: '深夜黑',   bg: '#0A0A0A', panel: '#151515', accent: '#9AA0AE', text: '#EDEDED', dim: '#7A7A7A', light: false },
  green:    { name: '护眼墨绿', bg: '#0E1F17', panel: '#15291F', accent: '#3FBF7F', text: '#DCEBE4', dim: '#7FA391', light: false },
  paper:    { name: '暖纸色',   bg: '#F6F0E1', panel: '#FDF8EC', accent: '#D97706', text: '#3B3226', dim: '#8C7F6D', light: true },
}

// ---------- 路径与状态 ----------
const isPackaged = app.isPackaged
const portableBuild = !!process.env.PORTABLE_EXECUTABLE_DIR
const portableFlag = path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')), 'portable.flag')
const portable = (isPackaged && fs.existsSync(portableFlag)) || portableBuild
const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))
const dataDir = portable ? path.join(exeDir, 'data') : app.getPath('userData')
const configPath = path.join(dataDir, 'config.json')
const dshHome = path.join(dataDir, 'dsh-home')
const runtimeDir = isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'runtime-bundle', 'runtime')
const nodeExe = path.join(runtimeDir, 'node.exe')
const dshBin = path.join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

let mainWin = null
let settingsWin = null
let tray = null
let sidecar = null
let currentPort = null
let quitting = false
const logs = []

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`
  logs.push(line)
  if (logs.length > 500) logs.shift()
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.appendFileSync(path.join(dataDir, 'app.log'), line + '\n') } catch {}
  console.log(line)
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return { ...DEFAULT_CONFIG, ...raw }
  } catch { return { ...DEFAULT_CONFIG } }
}
function saveConfig(cfg) {
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)) } catch (e) { log('saveConfig failed: ' + e.message) }
}
let config = loadConfig()
const theme = () => THEMES[config.theme] || THEMES.deepsea

// ---------- 端口与侧车进程 ----------
function findFreePort(start, end) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > end) return reject(new Error('no free port in range'))
      const srv = net.createServer()
      srv.once('error', () => tryPort(p + 1))
      srv.once('listening', () => srv.close(() => resolve(p)))
      srv.listen(p, '127.0.0.1')
    }
    tryPort(start)
  })
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 800 }, (res) => { res.resume(); resolve(true) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function startHarness() {
  if (sidecar && !sidecar.killed) return currentPort
  const port = await findFreePort(PORT_START, PORT_END)
  currentPort = port
  log(`starting dsh web @127.0.0.1:${port} (DSH_HOME=${dshHome})`)
  fs.mkdirSync(dshHome, { recursive: true })
  const proc = spawn(nodeExe, [dshBin, 'web', '--port', String(port)], {
    cwd: runtimeDir,
    env: { ...process.env, DSH_HOME: dshHome, NO_COLOR: '1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  sidecar = proc
  let spawnFailed = false
  proc.stdout.on('data', (d) => log('[dsh] ' + String(d).trim()))
  proc.stderr.on('data', (d) => log('[dsh:err] ' + String(d).trim()))
  proc.on('exit', (code) => {
    log('dsh exited with code ' + code)
    if (sidecar === proc) { sidecar = null; currentPort = null }
  })
  proc.on('error', (e) => {
    spawnFailed = true
    log('dsh spawn error: ' + e.message)
    if (sidecar === proc) { sidecar = null; currentPort = null }
  })
  // 首次启动需初始化 profile (~60-90s), 给足 120s
  for (let i = 0; i < 240; i++) {
    if (await ping(port)) { log('harness ready'); return port }
    if (spawnFailed) throw new Error('无法启动 dsh: 运行时可能不完整 (node.exe / node_modules)')
    if (!sidecar) throw new Error('harness process exited during startup')
    if (i % 10 === 0 && mainWin) {
      mainWin.webContents.executeJavaScript(`document.getElementById('status').textContent = '正在启动 Harness…（首次启动约需 1~2 分钟，已等待 ${Math.round(i * 0.5)} 秒）'`).catch(() => {})
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('harness failed to start within 120s (see app.log)')
}

function stopHarness() {
  if (sidecar && !sidecar.killed) { try { sidecar.kill() } catch {} }
  sidecar = null
  currentPort = null
}

// ---------- 主窗口 ----------
function iconPath() {
  const p = path.join(__dirname, 'icon', 'icon.png')
  return fs.existsSync(p) ? p : undefined
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280, height: 820, minWidth: 940, minHeight: 620,
    title: APP_NAME,
    icon: iconPath(),
    show: false,
    backgroundColor: theme().bg,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  })
  mainWin.once('ready-to-show', () => mainWin.show())
  mainWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWin.hide() }
  })
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWin.webContents.on('did-finish-load', () => {
    const u = mainWin.webContents.getURL()
    if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) injectOverlay()
  })
  // webview 控制台 → 主进程日志 (诊断用)
  mainWin.webContents.on('console-message', (e, ...rest) => {
    const msg = (e && typeof e === 'object' && e.message) ? e.message : (rest[1] || '')
    if (String(msg).includes('dsh-desktop')) log('[webview] ' + msg)
  })
  mainWin.loadFile('loading.html')
  // 调试截图: DSH_DESKTOP_DEBUG=1 时启动后 8s 截图
  if (process.env.DSH_DESKTOP_DEBUG) {
    setTimeout(async () => {
      try {
        const img = await mainWin.webContents.capturePage()
        const p = path.join(dataDir, 'debug.png')
        fs.writeFileSync(p, img.toPNG())
        log('[debug] screenshot saved: ' + p)
      } catch (err) { log('[debug] screenshot failed: ' + err.message) }
    }, 8000)
  }
}

function injectOverlay() {
  if (!mainWin) return
  const t = theme()
  const css = `
    ::selection { background: ${t.accent} !important; color: #fff !important; }
    * { scrollbar-color: ${t.accent}88 transparent; }
  `
  mainWin.webContents.insertCSS(css).catch(() => {})
  const js = `
    (function(){
      var old = document.getElementById('dshd-badge');
      if (old) old.remove();
      var url = ${JSON.stringify(config.badgeUrl)};
      if (!url) return;
      var a = document.createElement('a');
      a.id = 'dshd-badge';
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = '▶ ' + ${JSON.stringify(config.badgeLabel || '作者频道')};
      a.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483000;' +
        'padding:7px 14px;border-radius:999px;font-size:12.5px;line-height:1;' +
        'font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif;' +
        'background:${t.accent};color:#fff;text-decoration:none;' +
        'opacity:.92;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;transition:transform .15s ease;';
      a.addEventListener('mouseenter', function(){ this.style.transform='translateY(-2px)'; });
      a.addEventListener('mouseleave', function(){ this.style.transform='none'; });
      (document.body || document.documentElement).appendChild(a);
      console.log('[dsh-desktop] badge injected');
    })();
  `
  mainWin.webContents.executeJavaScript(js).catch(() => {})
}

function showLoadingError(msg) {
  if (!mainWin) return
  mainWin.webContents.executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(msg)}`).catch(() => {})
}

// ---------- 设置窗口 ----------
function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    width: 640, height: 760, minWidth: 640, minHeight: 760,
    title: '设置 —— ' + APP_NAME,
    icon: iconPath(),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: theme().bg,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  settingsWin.once('ready-to-show', () => settingsWin.show())
  settingsWin.on('close', (e) => { if (!quitting) { e.preventDefault(); settingsWin.hide() } })
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' } })
  settingsWin.loadFile('settings.html')
}

// ---------- 托盘 ----------
function createTray() {
  let img = nativeImage.createEmpty()
  const p = iconPath()
  if (p) { const ni = nativeImage.createFromPath(p); if (!ni.isEmpty()) img = ni.resize({ width: 16, height: 16 }) }
  tray = new Tray(img)
  tray.setToolTip(APP_NAME)
  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { mainWin && (mainWin.isVisible() ? mainWin.hide() : mainWin.show(), mainWin.isVisible() && mainWin.focus()) } },
      { label: '设置', click: () => createSettingsWindow() },
      { type: 'separator' },
      { label: '打开数据目录', click: () => shell.openPath(dataDir) },
      { label: config.badgeLabel || '作者频道', click: () => config.badgeUrl && shell.openExternal(config.badgeUrl) },
      { label: 'DeepSeek Harness 仓库', click: () => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness') },
      { type: 'separator' },
      { label: '重启 Harness', click: async () => { stopHarness(); try { await startHarness(); mainWin && mainWin.loadURL(`http://127.0.0.1:${currentPort}`) } catch (e) { log('restart failed: ' + e.message) } } },
      { label: '退出', click: () => { quitting = true; app.quit() } },
    ])
    tray.setContextMenu(menu)
  }
  rebuildMenu()
  tray.on('click', () => { if (mainWin) { mainWin.isVisible() ? mainWin.hide() : mainWin.show(); if (mainWin.isVisible()) mainWin.focus() } })
}

// ---------- 启动流程 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus() } })

  app.whenReady().then(async () => {
    try {
      createMainWindow()
      const port = await startHarness()
      mainWin.loadURL(`http://127.0.0.1:${port}`)
      createTray()
      globalShortcut.register('CommandOrControl+Shift+Space', () => {
        if (mainWin) { mainWin.isVisible() ? mainWin.hide() : mainWin.show(); if (mainWin.isVisible()) mainWin.focus() }
      })
    } catch (e) {
      log('startup failed: ' + e.message)
      stopHarness()
      showLoadingError('Harness 启动失败: ' + e.message + '（查看 设置 → 日志 了解更多）')
    }
  })

  app.on('before-quit', () => { quitting = true; stopHarness() })
  app.on('will-quit', () => { globalShortcut.unregisterAll() })
  app.on('window-all-closed', () => { /* 托盘常驻, 不退出 */ })
}

// ---------- IPC ----------
ipcMain.handle('get-state', () => ({
  appName: APP_NAME, appVersion: APP_VERSION, dshVersion: DSH_VERSION,
  config, themes: THEMES, portable, installed: isPackaged, dataDir, dshHome,
  port: currentPort, running: !!(sidecar && !sidecar.killed),
}))

ipcMain.handle('set-config', (e, patch) => {
  if (patch && patch.badgeUrl != null) {
    patch.badgeUrl = String(patch.badgeUrl).trim()
    if (patch.badgeUrl && !/^https?:\/\//i.test(patch.badgeUrl)) patch.badgeUrl = ''
  }
  config = { ...config, ...patch }
  saveConfig(config)
  injectOverlay()
  return config
})

ipcMain.handle('set-autostart', (e, on) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath })
    return { ok: true, value: app.getLoginItemSettings().openAtLogin }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('set-portable', (e, on) => {
  if (!isPackaged) return { ok: false, error: '开发模式下不可用' }
  try {
    if (on) fs.writeFileSync(portableFlag, 'portable data next to exe')
    else if (fs.existsSync(portableFlag)) fs.unlinkSync(portableFlag)
    return { ok: true, changed: true }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('relaunch-app', () => {
  quitting = true
  stopHarness()
  setTimeout(() => { app.relaunch(); app.exit(0) }, 400)
})

ipcMain.handle('open-path', (e, p) => shell.openPath(p))
ipcMain.handle('open-external', (e, u) => { if (/^https?:/i.test(u)) shell.openExternal(u) })

ipcMain.handle('check-update', async () => {
  try {
    const res = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh/latest', { signal: AbortSignal.timeout(8000) })
    const data = await res.json()
    const latest = data.version || null
    return { ok: true, bundled: DSH_VERSION, latest, newer: latest && latest !== DSH_VERSION ? latest : null }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('restart-harness', async () => {
  stopHarness()
  await new Promise((r) => setTimeout(r, 600))
  try {
    const port = await startHarness()
    if (mainWin) mainWin.loadURL(`http://127.0.0.1:${port}`)
    return { ok: true, port }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('get-logs', () => logs.slice(-200).join('\n'))
