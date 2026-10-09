import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const seedDirectory = join(projectRoot, 'build-seed')
const seedPath = join(seedDirectory, 'ppms.sqlite')
const requiredTables = ['users', 'register_state', 'audit_log']
const configuredSource = process.env.PPMS_DB_SOURCE
const sourcePath = configuredSource ? (isAbsolute(configuredSource) ? configuredSource : resolve(projectRoot, configuredSource)) : null
const adminPassword = process.env.PPMS_ADMIN_PASSWORD

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

function createCleanSeed() {
  mkdirSync(seedDirectory, { recursive: true })
  rmSync(seedPath, { force: true })
  rmSync(`${seedPath}-wal`, { force: true })
  rmSync(`${seedPath}-shm`, { force: true })

  const db = new DatabaseSync(seedPath)
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
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

    if (adminPassword) {
      db.prepare('INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), 'admin', hashPassword(adminPassword), 'admin', 1, new Date().toISOString())
      console.log('Created clean PPMS seed with a default admin account (username: admin).')
    } else {
      console.log('Created clean PPMS seed without a bootstrap user. Set PPMS_ADMIN_PASSWORD before packaging or login to create the default admin account.')
    }
  } finally {
    db.close()
  }
}

async function copySourceSeed() {
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error(`The configured source database was not found at ${sourcePath ?? 'unspecified source path'}.`)
  }

  const source = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    if (requiredTables.some((table) => !tables.includes(table))) {
      throw new Error('The configured source database is not a valid PPMS database; required startup tables are missing.')
    }
    const sourceIntegrity = source.prepare('PRAGMA integrity_check').get()?.integrity_check
    if (sourceIntegrity !== 'ok') {
      throw new Error('The configured source database did not pass SQLite integrity_check.')
    }

    mkdirSync(seedDirectory, { recursive: true })
    rmSync(seedPath, { force: true })
    rmSync(`${seedPath}-wal`, { force: true })
    rmSync(`${seedPath}-shm`, { force: true })
    await backup(source, seedPath)
  } finally {
    source.close()
  }
}

async function verifySeed() {
  const snapshot = new DatabaseSync(seedPath, { readOnly: true })
  try {
    const integrity = snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check
    const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    const userCount = snapshot.prepare('SELECT count(*) AS count FROM users').get().count
    const stateCount = snapshot.prepare('SELECT count(*) AS count FROM register_state').get().count

    if (integrity !== 'ok' || requiredTables.some((table) => !tables.includes(table))) {
      throw new Error('The packaged PPMS database failed verification.')
    }

    if (userCount < 0 || userCount > 100000 || stateCount < 0) {
      throw new Error('The packaged PPMS seed has invalid counters.')
    }

    console.log(`Verified PPMS clean seed: ${userCount} login accounts, ${stateCount} register-state records.`)
  } finally {
    snapshot.close()
  }
}

try {
  if (sourcePath) {
    await copySourceSeed()
  } else {
    createCleanSeed()
  }
  await verifySeed()
} catch (error) {
  rmSync(seedPath, { force: true })
  throw error
}