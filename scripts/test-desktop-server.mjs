import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DatabaseSync } from 'node:sqlite'

const projectRoot = resolve(import.meta.dirname, '..')
const appRoot = process.env.PPMS_TEST_APP_ROOT || projectRoot
const serverEntry = process.env.PPMS_TEST_SERVER_ENTRY || join(projectRoot, 'server.mjs')
const workingDirectory = process.env.PPMS_TEST_CWD || projectRoot
const tempRoot = mkdtempSync(join(tmpdir(), 'ppms-desktop-smoke-'))
const dataDir = join(tempRoot, 'data')
const backupDir = join(tempRoot, 'backups')
const logDir = join(tempRoot, 'logs')
let databasePath = join(dataDir, 'ppms.sqlite')
const sourceDatabase = join(tempRoot, 'source', 'ppms.sqlite')
let legacyDatabasePaths = sourceDatabase
let expectedUsersReady = true
let port
const startupToken = 'desktop-smoke-test-token'

function createMigrationFixture() {
  mkdirSync(join(tempRoot, 'source'), { recursive: true })
  const database = new DatabaseSync(sourceDatabase)
  try {
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'operator')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE register_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    database.prepare('INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('migration-fixture-user', 'admin', 'fixture-only', 'admin', 1, new Date().toISOString())
  } finally {
    database.close()
  }
}

async function findPort() {
  const probe = createNetServer()
  await new Promise((resolveListen, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolveListen))
  const address = probe.address()
  await new Promise((resolveClose) => probe.close(resolveClose))
  return address.port
}

let child
let childExit
let stderr = ''

async function startServer() {
  port = await findPort()
  const env = { ...process.env }
  delete env.PPMS_ADMIN_PASSWORD
  Object.assign(env, {
    PPMS_DESKTOP: '1',
    PPMS_STARTUP_TOKEN: startupToken,
    PPMS_HOST: '127.0.0.1',
    PPMS_PORT: String(port),
    PPMS_APP_ROOT: appRoot,
    PPMS_DB_PATH: databasePath,
    PPMS_BACKUP_DIR: backupDir,
    PPMS_LOG_DIR: logDir,
    PPMS_LEGACY_DB_PATHS: legacyDatabasePaths,
    PPMS_VERSION: 'test',
  })
  child = spawn(process.execPath, [serverEntry], { cwd: workingDirectory, env, stdio: ['ignore', 'ignore', 'pipe'] })
  childExit = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })

  let health
  let lastError
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited during startup: ${stderr}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) {
        health = await response.json()
        break
      }
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  if (!health) throw new Error(`Server health check timed out: ${lastError?.message || stderr}`)
  if (health.service !== 'ppms-local-server' || health.startupToken !== startupToken || health.usersReady !== expectedUsersReady) throw new Error('The local health handshake or user-setup state check failed.')
  if (!expectedUsersReady && !health.setupRequired) throw new Error('An empty desktop installation did not request first-run administrator setup.')
  const uiResponse = await fetch(`http://127.0.0.1:${port}/`)
  const uiHtml = await uiResponse.text()
  if (!uiResponse.ok || !uiHtml.includes('Petrol Pump Management System')) throw new Error('The local UI was not served from the configured application root.')
  return port
}

async function stopServer() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exit = await new Promise((resolveExit) => {
    const timeout = setTimeout(() => resolveExit(null), 5000)
    childExit.then((result) => {
      clearTimeout(timeout)
      resolveExit(result)
    })
  })
  if (!exit && child.exitCode === null) {
    child.kill('SIGKILL')
    await childExit
  } else if (exit && exit.code !== 0 && exit.signal !== 'SIGTERM') {
    throw new Error(`Server shutdown failed with exit code ${exit.code} and signal ${exit.signal}.`)
  }
  child = null
}

try {
  createMigrationFixture()
  await startServer()
  const database = new DatabaseSync(databasePath, { readOnly: true })
  const integrity = database.prepare('PRAGMA integrity_check').get()?.integrity_check
  const users = database.prepare('SELECT count(*) AS count FROM users').get().count
  const registerStates = database.prepare('SELECT count(*) AS count FROM register_state').get().count
  database.close()
  if (integrity !== 'ok' || users < 1) throw new Error('The migrated test database failed integrity or user verification.')
  await stopServer()
  await startServer()
  const reopened = new DatabaseSync(databasePath, { readOnly: true })
  const reopenedUsers = reopened.prepare('SELECT count(*) AS count FROM users').get().count
  const reopenedStates = reopened.prepare('SELECT count(*) AS count FROM register_state').get().count
  reopened.close()
  if (reopenedUsers !== users || reopenedStates !== registerStates) throw new Error('Database state changed after server restart.')
  await stopServer()

  databasePath = join(tempRoot, 'fresh-install', 'data', 'ppms.sqlite')
  legacyDatabasePaths = ''
  expectedUsersReady = false
  await startServer()
  const emptyDatabase = new DatabaseSync(databasePath, { readOnly: true })
  try {
    if (emptyDatabase.prepare('SELECT count(*) AS count FROM users').get().count !== 0 ||
      emptyDatabase.prepare('SELECT count(*) AS count FROM register_state').get().count !== 0) {
      throw new Error('A clean desktop installation must not contain seeded users or register data.')
    }
  } finally {
    emptyDatabase.close()
  }
  const invalidSetup = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'first-admin', password: 'short' }),
  })
  if (invalidSetup.status !== 400) throw new Error('First-run setup must reject a weak administrator password.')
  const setupResponse = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'first-admin', password: 'First-Run-Password-123!' }),
  })
  const setupPayload = await setupResponse.json()
  if (setupResponse.status !== 201 || setupPayload.user?.role !== 'admin' || !setupPayload.token) throw new Error(`First-run administrator setup failed: ${JSON.stringify(setupPayload)}`)
  const duplicateSetup = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'second-admin', password: 'Second-Run-Password-123!' }),
  })
  if (duplicateSetup.status !== 409) throw new Error('First-run setup must be disabled after an administrator account is created.')
  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'first-admin', password: 'First-Run-Password-123!' }),
  })
  if (loginResponse.status !== 200) throw new Error('The first administrator could not sign in after setup.')
  await stopServer()
  console.log(`Desktop server smoke test passed: isolated legacy migration, server restart, clean empty-database startup, one-time administrator setup, and login (${users} migration-fixture account).`)
} finally {
  try {
    await stopServer()
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}