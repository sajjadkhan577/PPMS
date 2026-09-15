const { app, BrowserWindow, dialog, utilityProcess } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const port = Number(process.env.PPMS_PORT || 8787)
let serverProcess
const logPath = path.join(app.getPath('userData'), 'ppms-startup.log')
const log = (message) => fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`)

function startServer() {
  const serverPath = path.join(app.getAppPath(), 'server.mjs')
  const dataDir = path.join(app.getPath('userData'), 'data')
  const productionDb = path.join(dataDir, 'ppms.sqlite')
  const bundledDb = path.join(app.getAppPath(), 'data', 'ppms.sqlite')
  fs.mkdirSync(dataDir, { recursive: true })
  if (!fs.existsSync(productionDb) && fs.existsSync(bundledDb)) fs.copyFileSync(bundledDb, productionDb)
  log(`starting server ${serverPath}`)
  serverProcess = utilityProcess.fork(serverPath, [], {
    cwd: app.getAppPath(),
    env: { ...process.env, PPMS_PORT: String(port), PPMS_APP_ROOT: app.getAppPath(), PPMS_DB_PATH: productionDb, PPMS_BACKUP_DIR: path.join(app.getPath('documents'), 'PPMS Backups'), PPMS_VERSION: app.getVersion() },
    stdio: 'ignore',
  })
  serverProcess.on('error', (error) => log(`server error ${error.stack || error}`))
  serverProcess.on('exit', (code, signal) => log(`server exit code=${code} signal=${signal}`))
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(`http://localhost:${port}/`)
      return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  return false
}

async function createWindow() {
  log('creating window')
  startServer()
  if (!await waitForServer()) {
    log('server wait timed out')
    await dialog.showMessageBox({ type: 'error', title: 'PPMS startup failed', message: 'The PPMS local server could not be started.' })
    app.quit()
    return
  }

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: path.join(app.getAppPath(), 'electron', 'ppms-icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(app.getAppPath(), 'electron', 'preload.cjs') },
  })
  window.once('ready-to-show', () => window.show())
  await window.loadURL(`http://localhost:${port}/`)
  log('window loaded')
}

app.whenReady().then(createWindow).catch((error) => { log(`startup error ${error.stack || error}`); app.quit() })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill()
})
