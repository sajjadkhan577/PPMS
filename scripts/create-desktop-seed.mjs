import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { backup, DatabaseSync } from 'node:sqlite'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configuredSource = process.env.PPMS_DB_SOURCE || join(projectRoot, 'data', 'ppms.sqlite')
const sourcePath = isAbsolute(configuredSource) ? configuredSource : resolve(projectRoot, configuredSource)
const seedDirectory = join(projectRoot, 'build-seed')
const seedPath = join(seedDirectory, 'ppms.sqlite')
const requiredTables = ['users', 'register_state', 'audit_log']

if (!existsSync(sourcePath)) {
  throw new Error(`Existing PPMS database not found at ${sourcePath}. Set PPMS_DB_SOURCE to the client's existing SQLite database; packaging will not create an empty seed.`)
}

mkdirSync(seedDirectory, { recursive: true })
rmSync(seedPath, { force: true })
rmSync(`${seedPath}-wal`, { force: true })
rmSync(`${seedPath}-shm`, { force: true })

let source
try {
  source = new DatabaseSync(sourcePath, { readOnly: true })
  const tables = source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  if (requiredTables.some((table) => !tables.includes(table))) throw new Error('The source file is not a complete PPMS database; required tables are missing.')
  const sourceIntegrity = source.prepare('PRAGMA integrity_check').get()?.integrity_check
  if (sourceIntegrity !== 'ok') throw new Error('The existing PPMS database did not pass SQLite integrity_check.')
  const userCount = source.prepare('SELECT count(*) AS count FROM users').get().count
  if (userCount < 1) throw new Error('The existing database has no login accounts; refusing to package an application that cannot authenticate users.')
  await backup(source, seedPath)
} finally {
  source?.close()
}

const snapshot = new DatabaseSync(seedPath, { readOnly: true })
try {
  const integrity = snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check
  const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
  const userCount = snapshot.prepare('SELECT count(*) AS count FROM users').get().count
  const stateCount = snapshot.prepare('SELECT count(*) AS count FROM register_state').get().count
  if (integrity !== 'ok' || requiredTables.some((table) => !tables.includes(table)) || userCount < 1) {
    throw new Error('The packaged PPMS database snapshot failed verification.')
  }
  console.log(`Verified PPMS database snapshot: ${userCount} login accounts, ${stateCount} register-state records. Source database was not modified.`)
} catch (error) {
  rmSync(seedPath, { force: true })
  throw error
} finally {
  snapshot.close()
}