import { createServer } from 'node:http'
import { mkdirSync, existsSync, readFileSync, copyFileSync, readdirSync, statSync, unlinkSync, appendFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'

const port = Number(process.env.PPMS_PORT || 8787)
const host = process.env.PPMS_HOST || '127.0.0.1'
const desktopProduction = process.env.PPMS_DESKTOP === '1'
if (desktopProduction && (!process.env.PPMS_APP_ROOT || !process.env.PPMS_DB_PATH || !process.env.PPMS_BACKUP_DIR || !process.env.PPMS_LOG_DIR)) {
  throw new Error('The packaged PPMS server is missing its application-data paths.')
}
const appRoot = process.env.PPMS_APP_ROOT || process.cwd()
const dbPath = process.env.PPMS_DB_PATH || join(appRoot, 'data', 'ppms.sqlite')
const dataDir = dirname(dbPath)
const backupDir = process.env.PPMS_BACKUP_DIR || join(appRoot, 'backups')
const logDir = process.env.PPMS_LOG_DIR || join(dirname(dataDir), 'logs')
const logPath = join(logDir, 'ppms-server.log')
const dailyBackupDir = join(backupDir, 'Daily')
const monthlyBackupDir = join(backupDir, 'Monthly')
const safetyBackupDir = join(backupDir, 'Safety')
const adminPassword = process.env.PPMS_ADMIN_PASSWORD
const legacyDatabasePaths = String(process.env.PPMS_LEGACY_DB_PATHS || '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
const allowedKeys = new Set(['meters', 'meter-calibrations', 'sales', 'customers', 'udhar-transactions', 'expenses', 'employee-salaries', 'purchases', 'oil-sales', 'commission-records', 'discount-rules', 'payment-fees', 'stock-adjustments', 'stock-openings', 'bank-accounts', 'brs-records', 'family-adjustments', 'fleet-vehicles', 'fleet-allocations'])
const managerAdminKeys = new Set(['commission-records', 'discount-rules', 'payment-fees', 'bank-accounts', 'brs-records', 'family-adjustments', 'stock-openings'])
const adminOnlyKeys = new Set(['employee-salaries'])
const sessions = new Map()
const requiredTables = ['users', 'register_state', 'audit_log']

mkdirSync(dataDir, { recursive: true })
mkdirSync(backupDir, { recursive: true })
mkdirSync(dailyBackupDir, { recursive: true })
mkdirSync(monthlyBackupDir, { recursive: true })
mkdirSync(safetyBackupDir, { recursive: true })
mkdirSync(logDir, { recursive: true })

function writeLog(level, message) {
  try {
    appendFileSync(logPath, `${new Date().toISOString()} ${level} ${message}\n`)
  } catch { /* Logging failure must not hide the original database/server failure. */ }
}

function databaseTables(database) {
  return database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
}

async function migrateLegacyDatabase() {
  if (existsSync(dbPath)) return
  const legacyPath = legacyDatabasePaths.find((candidate) => existsSync(candidate))
  if (!legacyPath) {
    if (desktopProduction) throw new Error(`The PPMS database was not found at ${dbPath}; no existing database was changed.`)
    return
  }

  let source
  try {
    source = new DatabaseSync(legacyPath, { readOnly: true })
    const tables = databaseTables(source)
    if (requiredTables.some((table) => !tables.includes(table))) throw new Error('The existing database is missing required PPMS tables.')
    await backup(source, dbPath)
  } catch (error) {
    writeLog('ERROR', `Database migration from ${legacyPath} failed: ${error instanceof Error ? error.message : String(error)}`)
    throw new Error('PPMS could not safely migrate the existing database. The original data was left untouched.')
  } finally {
    source?.close()
  }

  try {
    verifyDatabase(dbPath)
  } catch (error) {
    try { unlinkSync(dbPath) } catch { /* Keep the original database untouched if cleanup is unavailable. */ }
    writeLog('ERROR', `Migrated database verification failed: ${error instanceof Error ? error.message : String(error)}`)
    throw new Error('The migrated PPMS database did not pass integrity verification. The source database was left untouched.')
  }
  writeLog('INFO', `Migrated existing database from ${legacyPath} to ${dbPath}`)
}

await migrateLegacyDatabase()

let db
try {
  const databaseAlreadyExists = existsSync(dbPath)
  db = new DatabaseSync(dbPath)
  if (databaseAlreadyExists && requiredTables.some((table) => !databaseTables(db).includes(table))) {
    throw new Error('The existing database is missing required PPMS tables.')
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'operator')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS register_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  const registerColumns = db.prepare('PRAGMA table_info(register_state)').all()
  if (!registerColumns.some((column) => column.name === 'version')) {
    db.exec('ALTER TABLE register_state ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
  }
  const integrity = db.prepare('PRAGMA quick_check').get()?.quick_check
  if (integrity !== 'ok') throw new Error('SQLite quick_check failed.')
} catch (error) {
  try { db?.close() } catch { /* Preserve the initialization error for logging. */ }
  writeLog('ERROR', `Database initialization failed at ${dbPath}: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  throw new Error('PPMS could not open or initialize its database. Existing database files were not replaced.')
}

if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  if (adminPassword) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), 'admin', hashPassword(adminPassword), 'admin', new Date().toISOString())
    writeLog('INFO', 'Initial admin account created from PPMS_ADMIN_PASSWORD.')
  } else {
    writeLog('WARN', 'No PPMS users exist. Configure PPMS_ADMIN_PASSWORD or restore an existing PPMS database before login.')
  }
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':')
  const actual = scryptSync(password, salt, 64).toString('hex')
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

function send(request, response, status, body) {
  const origin = request.headers.origin
  const allowedOrigin = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : 'http://localhost:5173'
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': allowedOrigin, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'vary': 'Origin' })
  response.end(JSON.stringify(body))
}

async function body(request) {
  let text = ''
  for await (const chunk of request) text += chunk
  return text ? JSON.parse(text) : {}
}

function session(request) {
  const token = request.headers.authorization?.replace('Bearer ', '')
  const userId = token && sessions.get(token)
  return userId ? db.prepare('SELECT id, username, role, active FROM users WHERE id = ? AND active = 1').get(userId) : null
}

function audit(user, action, key) {
  db.prepare('INSERT INTO audit_log (id, user_id, action, entity_key, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), user.id, action, key, new Date().toISOString())
}

function backupType(name, filePath) {
  if (filePath.startsWith(monthlyBackupDir)) return 'Monthly'
  if (filePath.startsWith(safetyBackupDir)) return 'Safety'
  if (name.startsWith('PPMS_Monthly_Backup_')) return 'Monthly'
  if (name.startsWith('PPMS_PreRestore_')) return 'Safety'
  return 'Daily'
}

function backupFiles() {
  const locations = [dailyBackupDir, monthlyBackupDir, safetyBackupDir, backupDir]
  const files = []
  for (const location of locations) {
    if (!existsSync(location)) continue
    for (const name of readdirSync(location)) {
      const filePath = join(location, name)
      if (!statSync(filePath).isFile() || !/^PPMS_(Daily_Backup|Monthly_Backup|PreRestore|PreReset|PreRegisterRestore)_/i.test(name) && !name.endsWith('.sqlite')) continue
      const stats = statSync(filePath)
      files.push({ name, path: filePath, type: backupType(name, filePath), createdAt: stats.birthtime.toISOString(), modifiedAt: stats.mtime.toISOString(), size: stats.size })
    }
  }
  return files.filter((entry, index, list) => list.findIndex((candidate) => candidate.path === entry.path) === index).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

function verifyDatabase(filePath) {
  if (!existsSync(filePath) || statSync(filePath).size <= 0) throw new Error('Backup verification failed: file is empty or missing.')
  const candidate = new DatabaseSync(filePath)
  try {
    const integrity = candidate.prepare('PRAGMA integrity_check').get()
    if (!integrity || integrity.integrity_check !== 'ok') throw new Error('Backup verification failed: SQLite integrity check did not pass.')
    const tables = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    if (requiredTables.some((table) => !tables.includes(table))) throw new Error('Backup verification failed: required PPMS tables are missing.')
  } finally {
    candidate.close()
  }
}

function checkpointDatabase() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

function copyVerifiedBackup(destination, replace = false) {
  if (existsSync(destination) && !replace) throw new Error('A backup with this name already exists.')
  checkpointDatabase()
  copyFileSync(dbPath, destination)
  try {
    verifyDatabase(destination)
  } catch (error) {
    if (existsSync(destination)) unlinkSync(destination)
    throw error
  }
}

function requireBackupRole(user, destructive = false) {
  if (user.role === 'operator' || destructive && user.role !== 'admin') return false
  return true
}

function roleCanAccessKey(user, key, operation) {
  if (adminOnlyKeys.has(key)) return user.role === 'admin'
  if (managerAdminKeys.has(key)) return user.role === 'admin' || user.role === 'manager'
  return operation === 'delete'
    ? user.role === 'admin' || user.role === 'manager'
    : ['admin', 'manager', 'operator'].includes(user.role)
}

function storedValue(key) {
  const row = db.prepare('SELECT value_json, version FROM register_state WHERE key = ?').get(key)
  return row ? { value: JSON.parse(row.value_json), version: row.version, exists: true } : { value: null, version: 0, exists: false }
}

function identityOf(value) {
  if (value && typeof value === 'object' && 'id' in value) return `id:${String(value.id)}`
  return `value:${JSON.stringify(value)}`
}

function removesRecords(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next)) return false
  const nextIds = new Set(next.map(identityOf))
  return previous.some((item) => !nextIds.has(identityOf(item)))
}

function writeRegister(user, key, value, expectedVersion) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = storedValue(key)
    if (!Number.isInteger(expectedVersion) || expectedVersion !== current.version) {
      db.exec('ROLLBACK')
      return { conflict: true, ...current }
    }
    if (removesRecords(current.value, value)) {
      if (key === 'sales' || key === 'customers') {
        db.exec('ROLLBACK')
        return { guardedDelete: true }
      }
      if (!roleCanAccessKey(user, key, 'delete')) {
        db.exec('ROLLBACK')
        return { forbidden: true }
      }
    }
    const version = current.version + 1
    db.prepare(`INSERT INTO register_state (key, value_json, updated_at, updated_by, version)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at,
      updated_by = excluded.updated_by, version = excluded.version`).run(key, JSON.stringify(value), new Date().toISOString(), user.id, version)
    audit(user, 'write', key)
    db.exec('COMMIT')
    return { version }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* Preserve the original write error. */ }
    throw error
  }
}

function writeRegisterValues(user, values, clearUnknownKeys = false) {
  db.exec('BEGIN IMMEDIATE')
  try {
    if (clearUnknownKeys) {
      const resetKeys = new Set(Object.keys(values))
      const registerKeys = db.prepare('SELECT key FROM register_state').all()
      for (const { key } of registerKeys) {
        if (resetKeys.has(key)) continue
        const version = storedValue(key).version + 1
        db.prepare('UPDATE register_state SET value_json = ?, updated_at = ?, updated_by = ?, version = ? WHERE key = ?')
          .run(JSON.stringify([]), new Date().toISOString(), user.id, version, key)
        audit(user, 'write', key)
      }
    }
    for (const [key, value] of Object.entries(values)) {
      const current = storedValue(key)
      const version = current.version + 1
      db.prepare(`INSERT INTO register_state (key, value_json, updated_at, updated_by, version)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at,
        updated_by = excluded.updated_by, version = excluded.version`).run(key, JSON.stringify(value), new Date().toISOString(), user.id, version)
      audit(user, 'write', key)
    }
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* Preserve the original write error. */ }
    throw error
  }
}

function advanceVersionsAfterRestore(user, previousVersions) {
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const key of allowedKeys) {
      const restored = storedValue(key)
      const version = Math.max(previousVersions.get(key) || 0, restored.version) + 1
      if (!restored.exists) {
        db.prepare('INSERT INTO register_state (key, value_json, updated_at, updated_by, version) VALUES (?, ?, ?, ?, ?)')
          .run(key, JSON.stringify(null), new Date().toISOString(), user.id, version)
      } else {
        db.prepare('UPDATE register_state SET updated_at = ?, updated_by = ?, version = ? WHERE key = ?')
          .run(new Date().toISOString(), user.id, version, key)
      }
    }
    audit(user, 'restore-versions-advanced', 'register_state')
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* Preserve the original version migration error. */ }
    throw error
  }
}

function deleteRegisterRecord(user, key, id) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = storedValue(key)
    if (!Array.isArray(current.value)) {
      db.exec('ROLLBACK')
      return { missing: true }
    }
    const updated = current.value.filter((item) => String(item?.id) !== String(id))
    if (updated.length === current.value.length) {
      db.exec('ROLLBACK')
      return { missing: true }
    }
    const version = current.version + 1
    db.prepare(`UPDATE register_state SET value_json = ?, updated_at = ?, updated_by = ?, version = ? WHERE key = ?`)
      .run(JSON.stringify(updated), new Date().toISOString(), user.id, version, key)
    audit(user, 'delete', `${key}:${id}`)
    db.exec('COMMIT')
    return { version }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* Preserve the original delete error. */ }
    throw error
  }
}

function safeBackupEntry(name) {
  const requested = String(name || '')
  const entryName = basename(requested)
  if (!entryName || entryName !== requested || !/^[A-Za-z0-9_.-]+\.(db|sqlite)$/.test(entryName)) return null
  return backupFiles().find((entry) => entry.name === entryName || decodeURIComponent(entry.name) === entryName) || null
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    if (request.method === 'OPTIONS') return send(request, response, 204, {})
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return send(request, response, 200, {
        service: 'ppms-local-server',
        startupToken: process.env.PPMS_STARTUP_TOKEN || '',
        usersReady: Boolean(db.prepare('SELECT id FROM users LIMIT 1').get()),
      })
    }
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const relativePath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const filePath = join(appRoot, 'dist', relativePath)
      if (existsSync(filePath)) {
        const contentTypes = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
        response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] || 'application/octet-stream' })
        response.end(readFileSync(filePath))
        return
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const input = await body(request)
      const user = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ? AND active = 1').get(String(input.username || ''))
      if (!user || !verifyPassword(String(input.password || ''), user.password_hash)) return send(request, response, 401, { error: 'Invalid username or password.' })
      const token = randomBytes(32).toString('hex')
      sessions.set(token, user.id)
      return send(request, response, 200, { token, user: { id: user.id, username: user.username, role: user.role } })
    }

    const user = session(request)
    if (!user) return send(request, response, 401, { error: 'Authentication required.' })

    if (request.method === 'GET' && url.pathname === '/api/auth/me') return send(request, response, 200, { user })
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      sessions.delete(request.headers.authorization?.replace('Bearer ', ''))
      return send(request, response, 200, { ok: true })
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/change-password') {
      const input = await body(request)
      const oldPassword = String(input.oldPassword || '')
      const newPassword = String(input.newPassword || '')
      const confirmPassword = String(input.confirmPassword || '')
      const currentUser = db.prepare('SELECT id, username, role, password_hash, active FROM users WHERE id = ? AND active = 1').get(user.id)
      try {
        if (!currentUser) return send(request, response, 401, { error: 'Authentication required.' })
        if (!newPassword) return send(request, response, 400, { error: 'Please enter a new password.' })
        if (newPassword.length < 8) return send(request, response, 400, { error: 'Password does not meet the required security requirements.' })
        if (newPassword !== confirmPassword) return send(request, response, 400, { error: 'New passwords do not match.' })
        if (newPassword === oldPassword) return send(request, response, 400, { error: 'New password must be different from the current password.' })
        if (!verifyPassword(oldPassword, currentUser.password_hash)) return send(request, response, 401, { error: 'Current password is incorrect.' })
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), currentUser.id)
        const token = request.headers.authorization?.replace('Bearer ', '')
        if (token) sessions.delete(token)
        audit(currentUser, 'Password Changed', 'auth')
        return send(request, response, 200, { ok: true })
      } catch {
        return send(request, response, 500, { error: 'Unable to change password. Please try again.' })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/change-username') {
      const input = await body(request)
      const currentPassword = String(input.currentPassword || '')
      const username = String(input.username || '').trim()
      const currentUser = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ? AND active = 1').get(user.id)
      if (!currentUser || !verifyPassword(currentPassword, currentUser.password_hash)) return send(request, response, 401, { error: 'Current password is incorrect.' })
      if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) return send(request, response, 400, { error: 'Username must be 3-50 characters and may contain letters, numbers, dots, underscores, or hyphens.' })
      const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(username, user.id)
      if (existing) return send(request, response, 409, { error: `Username "${username}" is already in use. Choose a different username.` })
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, user.id)
      audit(user, 'Username Changed', `${currentUser.username} -> ${username}`)
      return send(request, response, 200, { ok: true, username })
    }

    if (request.method === 'GET' && url.pathname === '/api/system/status') {
      if (!requireBackupRole(user)) return send(request, response, 403, { error: 'Manager or administrator role required.' })
      return send(request, response, 200, { version: process.env.PPMS_VERSION || '0.0.0', databasePath: dbPath, backupDir, databaseExists: existsSync(dbPath) })
    }

    if (request.method === 'GET' && url.pathname === '/api/system/backups') {
      if (!requireBackupRole(user)) return send(request, response, 403, { error: 'Manager or administrator role required.' })
      return send(request, response, 200, { backups: backupFiles().map(({ path, ...entry }) => entry), backupDir, dailyBackupDir, monthlyBackupDir, safetyBackupDir })
    }

    if (request.method === 'POST' && url.pathname === '/api/system/backup') {
      if (!requireBackupRole(user)) return send(request, response, 403, { error: 'Manager or administrator role required.' })
      const date = new Date().toISOString().slice(0, 10)
      const name = `PPMS_Daily_Backup_${date}_${new Date().toISOString().slice(11, 19).replaceAll(':', '-')}.db`
      const destination = join(dailyBackupDir, name)
      copyVerifiedBackup(destination)
      audit(user, 'backup-created', name)
      return send(request, response, 201, { name, type: 'Daily', size: statSync(destination).size, backupDir: dailyBackupDir })
    }

    if (request.method === 'POST' && url.pathname === '/api/system/monthly-backup') {
      if (!requireBackupRole(user, true)) return send(request, response, 403, { error: 'Administrator role required.' })
      const input = await body(request)
      const month = String(input.month || '').match(/^\d{4}-\d{2}$/)?.[0]
      if (!month) return send(request, response, 400, { error: 'A valid backup month is required.' })
      const name = `PPMS_Monthly_Backup_${month}.db`
      const destination = join(monthlyBackupDir, name)
      if (existsSync(destination) && !input.replace) return send(request, response, 409, { error: `A monthly backup for ${month} already exists.`, name })
      copyVerifiedBackup(destination, Boolean(input.replace))
      audit(user, 'monthly-backup-created', name)
      return send(request, response, 201, { name, type: 'Monthly', month, size: statSync(destination).size, backupDir: monthlyBackupDir })
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/system/backups/')) {
      if (!requireBackupRole(user, true)) return send(request, response, 403, { error: 'Administrator role required.' })
      const entry = safeBackupEntry(decodeURIComponent(url.pathname.slice('/api/system/backups/'.length)))
      if (!entry) return send(request, response, 404, { error: 'Backup file not found.' })
      if (entry.type === 'Monthly' && !String(url.searchParams.get('confirmed')).includes('true')) return send(request, response, 409, { error: 'Monthly backup deletion requires explicit confirmation.' })
      try {
        unlinkSync(entry.path)
        audit(user, 'backup-deleted', entry.name)
        return send(request, response, 200, { ok: true, name: entry.name })
      } catch {
        return send(request, response, 500, { error: 'Unable to delete backup. The file may be in use or inaccessible.' })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/system/restore') {
      if (!requireBackupRole(user, true)) return send(request, response, 403, { error: 'Administrator role required.' })
      const input = await body(request)
      const entry = safeBackupEntry(input.name)
      if (!entry) return send(request, response, 404, { error: 'Backup file not found.' })
      const previousVersions = new Map([...allowedKeys].map((key) => [key, storedValue(key).version]))
      const safetyName = `PPMS_PreRestore_${new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')}.db`
      const safetyPath = join(safetyBackupDir, safetyName)
      let safetyBackupCreated = false
      try {
        verifyDatabase(entry.path)
        copyVerifiedBackup(safetyPath)
        safetyBackupCreated = true
        db.close()
        db = null
        copyFileSync(entry.path, dbPath)
        db = new DatabaseSync(dbPath)
        if (!db.prepare('PRAGMA table_info(register_state)').all().some((column) => column.name === 'version')) {
          db.exec('ALTER TABLE register_state ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
        }
        advanceVersionsAfterRestore(user, previousVersions)
        verifyDatabase(dbPath)
        audit(user, 'backup-restored', entry.name)
        return send(request, response, 200, { ok: true, restored: entry.name, safetyBackup: safetyName, restartRequired: true })
      } catch (error) {
        if (safetyBackupCreated) {
          try { db?.close() } catch { /* Continue with the safety restore attempt. */ }
          db = null
          try {
            copyFileSync(safetyPath, dbPath)
            db = new DatabaseSync(dbPath)
            if (!db.prepare('PRAGMA table_info(register_state)').all().some((column) => column.name === 'version')) {
              db.exec('ALTER TABLE register_state ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
            }
            verifyDatabase(dbPath)
          } catch (recoveryError) {
            writeLog('ERROR', `Restore recovery from ${safetyPath} failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
            return send(request, response, 500, { error: `Restore failed and automatic recovery from the safety backup also failed. Safety backup: ${safetyName}.` })
          }
        }
        return send(request, response, 500, { error: error instanceof Error ? error.message : 'Unable to restore backup. The current database was preserved with a safety backup.' })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/system/reset-registers') {
      if (user.role !== 'admin') return send(request, response, 403, { error: 'Administrator role required.' })
      const input = await body(request)
      if (input.confirmation !== 'RESET ALL REGISTER DATA') return send(request, response, 400, { error: 'Type RESET ALL REGISTER DATA to confirm this destructive action.' })
      const safetyName = `PPMS_PreReset_${new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')}.db`
      const safetyPath = join(safetyBackupDir, safetyName)
      try {
        copyVerifiedBackup(safetyPath)
        const resetValues = Object.fromEntries([...allowedKeys].map((key) => [key, key === 'stock-openings' ? { HSD: 0, PMG: 0, XTRON: 0 } : []]))
        writeRegisterValues(user, resetValues, true)
        return send(request, response, 200, { ok: true, safetyBackup: safetyName })
      } catch (error) {
        writeLog('ERROR', `Register reset failed: ${error instanceof Error ? error.message : String(error)}`)
        return send(request, response, 500, { error: error instanceof Error ? error.message : 'Unable to reset register data. No reset was reported as successful.' })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/system/restore-registers') {
      if (user.role !== 'admin') return send(request, response, 403, { error: 'Administrator role required.' })
      const input = await body(request)
      let parsedBackup
      try { parsedBackup = JSON.parse(String(input.backup || '')) } catch {
        return send(request, response, 400, { error: 'Invalid PPMS register backup file.' })
      }
      if (!parsedBackup || typeof parsedBackup !== 'object' || typeof parsedBackup.version !== 'number' ||
        typeof parsedBackup.createdAt !== 'string' || !parsedBackup.data || typeof parsedBackup.data !== 'object' || Array.isArray(parsedBackup.data)) {
        return send(request, response, 400, { error: 'Register backup data is invalid.' })
      }
      const values = Object.entries(parsedBackup.data).filter(([key]) => allowedKeys.has(key))
      const safetyName = `PPMS_PreRegisterRestore_${new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')}.db`
      const safetyPath = join(safetyBackupDir, safetyName)
      try {
        copyVerifiedBackup(safetyPath)
        if (values.length) writeRegisterValues(user, Object.fromEntries(values))
        return send(request, response, 200, { ok: true, safetyBackup: safetyName })
      } catch (error) {
        writeLog('ERROR', `Register backup restore failed: ${error instanceof Error ? error.message : String(error)}`)
        return send(request, response, 500, { error: error instanceof Error ? error.message : 'Unable to restore register backup. The current data was preserved.' })
      }
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/sales/')) {
      if (!requireBackupRole(user)) return send(request, response, 403, { error: 'Manager or administrator role required.' })
      const id = decodeURIComponent(url.pathname.slice('/api/sales/'.length))
      const sales = storedValue('sales').value
      if (!Array.isArray(sales) || !sales.some((sale) => String(sale?.id) === id)) return send(request, response, 404, { error: 'Sale not found.' })
      const linkedTransactions = storedValue('udhar-transactions').value
      if (Array.isArray(linkedTransactions) && linkedTransactions.some((entry) => String(entry?.id) === id)) {
        return send(request, response, 409, { error: 'This sale has linked customer financial history and cannot be deleted.' })
      }
      const result = deleteRegisterRecord(user, 'sales', id)
      if (result.missing) return send(request, response, 404, { error: 'Sale not found.' })
      return send(request, response, 200, { ok: true, version: result.version })
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/api/customers/')) {
      if (!requireBackupRole(user)) return send(request, response, 403, { error: 'Manager or administrator role required.' })
      const id = decodeURIComponent(url.pathname.slice('/api/customers/'.length))
      const customers = storedValue('customers').value
      const customer = Array.isArray(customers) ? customers.find((entry) => String(entry?.id) === id) : null
      if (!customer) return send(request, response, 404, { error: 'Customer not found.' })
      const transactions = storedValue('udhar-transactions').value
      const customerTransactions = Array.isArray(transactions) ? transactions.filter((entry) => String(entry?.customerId) === id) : []
      const transactionBalance = customerTransactions.reduce((sum, entry) => sum + Number(entry?.debit || 0) - Number(entry?.credit || 0), 0)
      const hasOpeningEntry = customerTransactions.some((entry) => entry?.type === 'Opening Balance')
      const outstanding = hasOpeningEntry ? transactionBalance : Number(customer.openingBalance || 0) + transactionBalance
      const linkedKeys = ['sales', 'discount-rules', 'family-adjustments', 'fleet-vehicles', 'fleet-allocations']
      const hasLinkedRecords = linkedKeys.some((key) => {
        const value = storedValue(key).value
        return Array.isArray(value) && value.some((entry) =>
          String(entry?.customerId) === id ||
          String(entry?.companyId) === id ||
          (key === 'sales' && entry?.mode === 'Credit' && entry?.customer === customer.name))
      })
      if (outstanding > 0) return send(request, response, 409, { error: 'Customer has an outstanding balance and cannot be deleted.' })
      if (customerTransactions.length || hasLinkedRecords) {
        return send(request, response, 409, { error: 'Customer has linked financial or historical records and cannot be deleted.' })
      }
      const result = deleteRegisterRecord(user, 'customers', id)
      if (result.missing) return send(request, response, 404, { error: 'Customer not found.' })
      return send(request, response, 200, { ok: true, version: result.version })
    }

    if (url.pathname.startsWith('/api/state/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/state/'.length))
      if (!allowedKeys.has(key)) return send(request, response, 404, { error: 'Unknown register key.' })
      if (request.method === 'GET') {
        if (!roleCanAccessKey(user, key, 'read')) return send(request, response, 403, { error: 'This role cannot read this register.' })
        return send(request, response, 200, storedValue(key))
      }
      if (request.method === 'PUT') {
        if (!roleCanAccessKey(user, key, 'write')) return send(request, response, 403, { error: 'This role cannot modify this register.' })
        const input = await body(request)
        if (!Number.isInteger(input.version)) return send(request, response, 428, { error: 'A register version is required. Reload the register and try again.' })
        const result = writeRegister(user, key, input.value, input.version)
        if (result.conflict) return send(request, response, 409, { error: 'This register changed after it was loaded. Reload it before saving.', value: result.value, version: result.version })
        if (result.guardedDelete) return send(request, response, 403, { error: 'Use the guarded delete operation for sales and customers.' })
        if (result.forbidden) return send(request, response, 403, { error: 'This role cannot delete register records.' })
        return send(request, response, 200, { ok: true, version: result.version })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/users') {
      if (user.role !== 'admin') return send(request, response, 403, { error: 'Administrator role required.' })
      return send(request, response, 200, { users: db.prepare('SELECT id, username, role, active, created_at AS createdAt FROM users ORDER BY username').all() })
    }

    if (request.method === 'POST' && url.pathname === '/api/users') {
      if (user.role !== 'admin') return send(request, response, 403, { error: 'Administrator role required.' })
      const input = await body(request)
      const username = String(input.username || '').trim()
      const password = String(input.password || '')
      const role = String(input.role || 'operator')
      if (!username || password.length < 8 || !['admin', 'manager', 'operator'].includes(role)) return send(request, response, 400, { error: 'Username, eight-character password, and valid role are required.' })
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return send(request, response, 409, { error: `Username "${username}" is already in use. Choose a different username.` })
      try {
        db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), username, hashPassword(password), role, new Date().toISOString())
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed: users.username')) return send(request, response, 409, { error: `Username "${username}" is already in use. Choose a different username.` })
        throw error
      }
      audit(user, 'create-user', username)
      return send(request, response, 201, { ok: true })
    }

    send(request, response, 404, { error: 'Not found.' })
  } catch (error) {
    writeLog('ERROR', `Request ${request.method} failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    send(request, response, 500, { error: 'The request could not be completed. Check the PPMS local diagnostic log.' })
  }
})

server.on('error', (error) => {
  writeLog('ERROR', `Local server failed to listen on ${host}:${port}: ${error.stack || error.message}`)
  process.exitCode = 1
  process.exit()
})

server.listen(port, host, () => writeLog('INFO', `PPMS database server listening on http://${host}:${port}; database=${dbPath}; backups=${backupDir}`))

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  const timeout = setTimeout(() => {
    writeLog('ERROR', 'Graceful server shutdown timed out.')
    process.exit(1)
  }, 4000)
  timeout.unref()
  try {
    server.close(() => {
      clearTimeout(timeout)
      try { db.close() } catch (error) { writeLog('ERROR', `Database close failed: ${error instanceof Error ? error.message : String(error)}`) }
      writeLog('INFO', 'PPMS local server stopped.')
      process.exit(0)
    })
  } catch (error) {
    clearTimeout(timeout)
    writeLog('ERROR', `Server shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
    try { db.close() } catch { /* Continue stopping after a server close failure. */ }
    process.exit(1)
  }
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
