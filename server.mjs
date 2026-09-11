import { createServer } from 'node:http'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const port = Number(process.env.PPMS_PORT || 8787)
const dbPath = process.env.PPMS_DB_PATH || join(process.cwd(), 'data', 'ppms.sqlite')
const adminPassword = process.env.PPMS_ADMIN_PASSWORD || 'change-me-now'
const allowedKeys = new Set(['meters', 'sales', 'customers', 'udhar-transactions', 'expenses', 'employee-salaries', 'purchases', 'oil-sales', 'discount-rules', 'payment-fees', 'stock-adjustments', 'stock-openings', 'bank-accounts', 'brs-records', 'family-adjustments'])
const sessions = new Map()

mkdirSync(dirname(dbPath), { recursive: true })
const db = new DatabaseSync(dbPath)
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

if (!db.prepare('SELECT id FROM users WHERE username = ?').get('admin')) {
  db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), 'admin', hashPassword(adminPassword), 'admin', new Date().toISOString())
  console.warn('PPMS admin account created. Set PPMS_ADMIN_PASSWORD before production use.')
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':')
  const actual = scryptSync(password, salt, 64).toString('hex')
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': 'http://localhost:5173', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' })
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
    if (request.method === 'OPTIONS') return send(response, 204, {})
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const input = await body(request)
      const user = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ? AND active = 1').get(String(input.username || ''))
      if (!user || !verifyPassword(String(input.password || ''), user.password_hash)) return send(response, 401, { error: 'Invalid username or password.' })
      const token = randomBytes(32).toString('hex')
      sessions.set(token, user.id)
      return send(response, 200, { token, user: { id: user.id, username: user.username, role: user.role } })
    }

    const user = session(request)
    if (!user) return send(response, 401, { error: 'Authentication required.' })

    if (request.method === 'GET' && url.pathname === '/api/auth/me') return send(response, 200, { user })
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      sessions.delete(request.headers.authorization?.replace('Bearer ', ''))
      return send(response, 200, { ok: true })
    }

    if (url.pathname.startsWith('/api/state/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/state/'.length))
      if (!allowedKeys.has(key)) return send(response, 404, { error: 'Unknown register key.' })
      if (request.method === 'GET') {
        const record = db.prepare('SELECT value_json FROM register_state WHERE key = ?').get(key)
        return send(response, 200, { value: record ? JSON.parse(record.value_json) : null })
      }
      if (request.method === 'PUT') {
        if (user.role === 'operator' && ['bank-accounts', 'brs-records', 'payment-fees'].includes(key)) return send(response, 403, { error: 'This role cannot modify accounting settings.' })
        const input = await body(request)
        db.prepare(`INSERT INTO register_state (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).run(key, JSON.stringify(input.value), new Date().toISOString(), user.id)
        audit(user, 'write', key)
        return send(response, 200, { ok: true })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/users') {
      if (user.role !== 'admin') return send(response, 403, { error: 'Administrator role required.' })
      return send(response, 200, { users: db.prepare('SELECT id, username, role, active, created_at AS createdAt FROM users ORDER BY username').all() })
    }

    if (request.method === 'POST' && url.pathname === '/api/users') {
      if (user.role !== 'admin') return send(response, 403, { error: 'Administrator role required.' })
      const input = await body(request)
      const username = String(input.username || '').trim()
      const password = String(input.password || '')
      const role = String(input.role || 'operator')
      if (!username || password.length < 8 || !['admin', 'manager', 'operator'].includes(role)) return send(response, 400, { error: 'Username, eight-character password, and valid role are required.' })
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return send(response, 409, { error: `Username "${username}" is already in use. Choose a different username.` })
      try {
        db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), username, hashPassword(password), role, new Date().toISOString())
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed: users.username')) return send(response, 409, { error: `Username "${username}" is already in use. Choose a different username.` })
        throw error
      }
      audit(user, 'create-user', username)
      return send(response, 201, { ok: true })
    }

    send(response, 404, { error: 'Not found.' })
  } catch (error) {
    console.error(error)
    send(response, 400, { error: error instanceof Error ? error.message : 'Request failed.' })
  }
})

server.listen(port, () => console.log(`PPMS database server listening on http://localhost:${port}`))
