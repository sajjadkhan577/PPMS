import { createServer } from 'node:http'
import { mkdirSync, existsSync, readFileSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const port = Number(process.env.PPMS_PORT || 8787)
const appRoot = process.env.PPMS_APP_ROOT || process.cwd()
const dbPath = process.env.PPMS_DB_PATH || join(appRoot, 'data', 'ppms.sqlite')
const backupDir = process.env.PPMS_BACKUP_DIR || join(process.env.USERPROFILE || process.env.HOME || appRoot, 'Documents', 'PPMS Backups')
const adminPassword = process.env.PPMS_ADMIN_PASSWORD
const allowedKeys = new Set(['meters', 'sales', 'customers', 'udhar-transactions', 'expenses', 'employee-salaries', 'purchases', 'oil-sales', 'commission-records', 'discount-rules', 'payment-fees', 'stock-adjustments', 'stock-openings', 'bank-accounts', 'brs-records', 'family-adjustments'])
const sessions = new Map()

mkdirSync(dirname(dbPath), { recursive: true })
mkdirSync(backupDir, { recursive: true })
let db = new DatabaseSync(dbPath)
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
    updated_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
  if (adminPassword) {
    db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), 'admin', hashPassword(adminPassword), 'admin', new Date().toISOString())
    console.warn('PPMS admin account created from PPMS_ADMIN_PASSWORD.')
  } else {
    console.warn('No PPMS users exist. Set PPMS_ADMIN_PASSWORD for the first admin account.')
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
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': allowedOrigin, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'vary': 'Origin' })
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    if (request.method === 'OPTIONS') return send(request, response, 204, {})
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

    if (request.method === 'GET' && url.pathname === '/api/system/status') {
      return send(request, response, 200, { version: process.env.PPMS_VERSION || '0.0.0', databasePath: dbPath, backupDir, databaseExists: existsSync(dbPath) })
    }

    if (request.method === 'GET' && url.pathname === '/api/system/backups') {
      const backups = readdirSync(backupDir).filter((name) => name.endsWith('.sqlite')).map((name) => {
        const filePath = join(backupDir, name)
        const stats = statSync(filePath)
        return { name, createdAt: stats.birthtime.toISOString(), modifiedAt: stats.mtime.toISOString(), size: stats.size }
      }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      return send(request, response, 200, { backups })
    }

    if (request.method === 'POST' && url.pathname === '/api/system/backup') {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      const name = `ppms-backup-${new Date().toISOString().slice(0, 10)}-${Date.now()}.sqlite`
      copyFileSync(dbPath, join(backupDir, name))
      return send(request, response, 201, { name, backupDir })
    }

    if (request.method === 'POST' && url.pathname === '/api/system/restore') {
      const input = await body(request)
      const name = basename(String(input.name || ''))
      if (!name.endsWith('.sqlite')) return send(request, response, 400, { error: 'Invalid backup file.' })
      const sourcePath = join(backupDir, name)
      if (!existsSync(sourcePath)) return send(request, response, 404, { error: 'Backup file not found.' })
      const validationDb = new DatabaseSync(sourcePath)
      const integrity = validationDb.prepare('PRAGMA integrity_check').get()
      validationDb.close()
      if (!integrity || integrity.integrity_check !== 'ok') return send(request, response, 400, { error: 'Backup database failed integrity validation.' })
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      const safetyName = `ppms-before-restore-${Date.now()}.sqlite`
      copyFileSync(dbPath, join(backupDir, safetyName))
      db.close()
      copyFileSync(sourcePath, dbPath)
      db = new DatabaseSync(dbPath)
      return send(request, response, 200, { ok: true, restored: name, safetyBackup: safetyName })
    }

    if (url.pathname.startsWith('/api/state/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/state/'.length))
      if (!allowedKeys.has(key)) return send(request, response, 404, { error: 'Unknown register key.' })
      if (request.method === 'GET') {
        const record = db.prepare('SELECT value_json FROM register_state WHERE key = ?').get(key)
        return send(request, response, 200, { value: record ? JSON.parse(record.value_json) : null })
      }
      if (request.method === 'PUT') {
        if (user.role === 'operator' && ['bank-accounts', 'brs-records', 'payment-fees', 'commission-records'].includes(key)) return send(request, response, 403, { error: 'This role cannot modify accounting settings.' })
        const input = await body(request)
        db.prepare(`INSERT INTO register_state (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(key, JSON.stringify(input.value), new Date().toISOString(), user.id)
        audit(user, 'write', key)
        return send(request, response, 200, { ok: true })
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
    console.error(error)
    send(request, response, 400, { error: error instanceof Error ? error.message : 'Request failed.' })
  }
})

server.listen(port, () => console.log(`PPMS database server listening on http://localhost:${port}`))
