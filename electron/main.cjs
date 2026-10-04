const { app, BrowserWindow, dialog, utilityProcess, Menu } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { resolveRuntimePaths } = require('./runtime-paths.cjs')

app.setName('PPMS')
const legacyUserDataPath = app.getPath('userData')
const paths = resolveRuntimePaths({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
  legacyUserDataPath,
  localAppData: process.env.LOCALAPPDATA,
})

if (app.isPackaged) app.setPath('userData', paths.dataRoot)
fs.mkdirSync(paths.logDir, { recursive: true })

const port = 8787
const startupToken = crypto.randomUUID()
const logPath = path.join(paths.logDir, 'ppms.log')
let serverProcess
let serverExited = false
let quittingForServer = false
let mainWindow

function log(message) {
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Diagnostics must not prevent the app from showing its startup error.
  }
}

function startServer() {
  const serverPath = path.join(paths.appRoot, 'server.mjs')
  fs.mkdirSync(paths.databaseDir, { recursive: true })
  fs.mkdirSync(paths.backupDir, { recursive: true })
  fs.mkdirSync(paths.logDir, { recursive: true })
  log(`starting local server at ${serverPath}`)
  serverProcess = utilityProcess.fork(serverPath, [], {
    cwd: paths.appRoot,
    env: {
      ...process.env,
      PPMS_DESKTOP: app.isPackaged ? '1' : '0',
      PPMS_STARTUP_TOKEN: startupToken,
      PPMS_HOST: '127.0.0.1',
      PPMS_PORT: String(port),
      PPMS_APP_ROOT: paths.appRoot,
      PPMS_DB_PATH: paths.databasePath,
      PPMS_BACKUP_DIR: paths.backupDir,
      PPMS_LOG_DIR: paths.logDir,
      PPMS_LEGACY_DB_PATHS: paths.legacyDatabasePaths.join(path.delimiter),
      PPMS_VERSION: app.getVersion(),
    },
    stdio: 'pipe',
  })
  serverProcess.stdout?.on('data', (chunk) => log(`[server] ${String(chunk).trimEnd()}`))
  serverProcess.stderr?.on('data', (chunk) => log(`[server] ${String(chunk).trimEnd()}`))
  serverProcess.on('error', (error) => log(`server process error: ${error.message}`))
  serverProcess.on('exit', (code, signal) => {
    serverExited = true
    log(`server exit code=${code} signal=${signal}`)
  })
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverExited) throw new Error('server-exited')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) {
        const health = await response.json()
        if (health.service !== 'ppms-local-server' || health.startupToken !== startupToken) continue
        if (app.isPackaged && !health.usersReady) throw new Error('no-users')
        return
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'no-users') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('server-timeout')
}

function startupMessage(error) {
  if (error.message === 'no-users') return 'No PPMS login accounts were found in the production database. The database was not replaced. Restore the existing database backup or configure PPMS_ADMIN_PASSWORD and restart.'
  if (error.message === 'server-exited' || error.message === 'server-timeout') return `The PPMS local service could not start on 127.0.0.1:${port}. Confirm that the port is available and review the local diagnostic log.`
  return 'PPMS could not open its database or start the local service. Existing database files were not replaced. Review the local diagnostic log.'
}

async function createWindow() {
  log(`starting PPMS; packaged=${app.isPackaged} database=${paths.databasePath}`)
  try {
    startServer()
    await waitForServer()
    if (app.isPackaged) Menu.setApplicationMenu(null)
    mainWindow = new BrowserWindow({
      title: 'PPMS',
      width: 1440,
      height: 920,
      minWidth: 1024,
      minHeight: 700,
      resizable: true,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f3f6fa',
      icon: path.join(paths.appRoot, 'electron', 'ppms-icon.ico'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(paths.appRoot, 'electron', 'preload.cjs'),
      },
    })
    mainWindow.setMenuBarVisibility(false)
    mainWindow.webContents.on('render-process-gone', (_event, details) => log(`renderer exited: ${details.reason} code=${details.exitCode}`))
    if (app.isPackaged) mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || input.control && input.shift && input.key.toLowerCase() === 'i')) event.preventDefault()
    })
    mainWindow.once('ready-to-show', () => mainWindow.show())
    await mainWindow.loadURL(`http://127.0.0.1:${port}/`)
    log('window loaded')
  } catch (error) {
    log(`startup failure: ${error.stack || error}`)
    const message = startupMessage(error instanceof Error ? error : new Error('startup-failed'))
    await dialog.showMessageBox({ type: 'error', title: 'PPMS startup failed', message, detail: `Diagnostic log: ${logPath}` })
    app.quit()
  }
}

const hasSingleInstance = app.requestSingleInstanceLock()
if (!hasSingleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(createWindow).catch(async (error) => {
    log(`unhandled startup failure: ${error.stack || error}`)
    await dialog.showMessageBox({ type: 'error', title: 'PPMS startup failed', message: 'PPMS could not start. Existing database files were not replaced.', detail: `Diagnostic log: ${logPath}` })
    app.quit()
  })
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (!serverProcess || serverExited || quittingForServer) return
  event.preventDefault()
  quittingForServer = true
  serverProcess.kill()
  const timeout = setTimeout(() => {
    log('server shutdown timed out; forcing app exit')
    app.exit(0)
  }, 5000)
  timeout.unref()
  serverProcess.once('exit', () => {
    clearTimeout(timeout)
    app.quit()
  })
})
