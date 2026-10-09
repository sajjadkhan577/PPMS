import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = resolve(import.meta.dirname, '..')
const tempRoot = join(tmpdir(), `ppms-security-api-${process.pid}-${Date.now()}`)
const dataDirectory = join(tempRoot, 'data')
const backupDirectory = join(tempRoot, 'backups')
const databasePath = join(dataDirectory, 'ppms.sqlite')
const startupPassword = 'Temporary-Admin-Password-123!'
let child
let port

async function findPort() {
  const probe = createNetServer()
  await new Promise((resolveListen, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolveListen))
  const address = probe.address()
  await new Promise((resolveClose) => probe.close(resolveClose))
  return address.port
}

async function startServer() {
  port = await findPort()
  child = spawn(process.execPath, [join(projectRoot, 'server.mjs')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PPMS_DESKTOP: '0',
      PPMS_HOST: '127.0.0.1',
      PPMS_PORT: String(port),
      PPMS_DB_PATH: databasePath,
      PPMS_BACKUP_DIR: backupDirectory,
      PPMS_LOG_DIR: join(tempRoot, 'logs'),
      PPMS_LEGACY_DB_PATHS: '',
      PPMS_ADMIN_PASSWORD: startupPassword,
      PPMS_VERSION: 'security-test',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Temporary API server exited: ${stderr}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok && (await response.json()).usersReady) return
    } catch { /* Retry until the temporary server is ready. */ }
    await delay(100)
  }
  throw new Error(`Temporary API server did not become ready: ${stderr}`)
}

async function stopServer() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(5000).then(() => {
      if (child && child.exitCode === null) child.kill('SIGKILL')
    }),
  ])
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json()
  return { status: response.status, payload }
}

async function login(username, password) {
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password } })
  assert.equal(result.status, 200, `Login failed for ${username}: ${JSON.stringify(result.payload)}`)
  return result.payload.token
}

function inspectDatabase(path) {
  const database = new DatabaseSync(path, { readOnly: true })
  try {
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    assert.ok(['users', 'register_state', 'audit_log'].every((table) => tables.includes(table)))
    return {
      users: database.prepare('SELECT count(*) AS count FROM users').get().count,
      sales: database.prepare('SELECT value_json FROM register_state WHERE key = ?').get('sales'),
      legacy: database.prepare('SELECT value_json FROM register_state WHERE key = ?').get('legacy-extra'),
    }
  } finally {
    database.close()
  }
}

try {
  mkdirSync(tempRoot, { recursive: true })
  await startServer()

  const admin = await login('admin', startupPassword)
  assert.equal((await request('/api/state/sales')).status, 401, 'Unauthenticated state access must be rejected.')
  const createdOperator = await request('/api/users', { token: admin, method: 'POST', body: { username: 'operator-test', password: 'Operator-Password-123!', role: 'operator' } })
  const createdManager = await request('/api/users', { token: admin, method: 'POST', body: { username: 'manager-test', password: 'Manager-Password-123!', role: 'manager' } })
  assert.equal(createdOperator.status, 201)
  assert.equal(createdManager.status, 201)
  const operator = await login('operator-test', 'Operator-Password-123!')
  const manager = await login('manager-test', 'Manager-Password-123!')

  assert.equal((await request('/api/state/bank-accounts', { token: operator })).status, 403, 'Operators must not read bank-account details.')
  assert.equal((await request('/api/state/employee-salaries', { token: manager })).status, 403, 'Managers must not read salaries.')
  assert.equal((await request('/api/users', { token: manager })).status, 403, 'User administration must be administrator-only.')
  assert.equal((await request('/api/system/status', { token: operator })).status, 403, 'Operator system-status access must be denied.')
  assert.equal((await request('/api/system/reset-registers', { token: operator, method: 'POST', body: { confirmation: 'RESET ALL REGISTER DATA' } })).status, 403)

  const initialSales = [{ id: 101, date: '2026-10-01', product: 'HSD', litres: 10, rate: 100, amount: 1000, mode: 'Cash', customer: '-' }]
  let saved = await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: initialSales, version: 0 } })
  assert.equal(saved.status, 200, `Admin register save failed: ${JSON.stringify(saved.payload)}`)
  assert.equal(saved.payload.version, 1)
  assert.equal((await request('/api/state/sales', { token: operator, method: 'PUT', body: { value: [], version: 1 } })).status, 403, 'Operators must not delete sales through generic register replacement.')
  assert.equal((await request('/api/sales/101', { token: operator, method: 'DELETE' })).status, 403, 'Operators must not delete a sale directly.')

  const operatorRead = await request('/api/state/sales', { token: operator })
  assert.equal(operatorRead.status, 200)
  const twoSales = [...operatorRead.payload.value, { id: 102, date: '2026-10-02', product: 'PMG', litres: 5, rate: 200, amount: 1000, mode: 'Cash', customer: '-' }]
  saved = await request('/api/state/sales', { token: operator, method: 'PUT', body: { value: twoSales, version: operatorRead.payload.version } })
  assert.equal(saved.status, 200, 'Operators should be able to create normal register records.')
  const clientA = await request('/api/state/sales', { token: operator })
  const clientB = await request('/api/state/sales', { token: manager })
  const clientAValue = clientA.payload.value.map((sale) => sale.id === 101 ? { ...sale, amount: 1100 } : sale)
  const firstConcurrentSave = await request('/api/state/sales', { token: operator, method: 'PUT', body: { value: clientAValue, version: clientA.payload.version } })
  assert.equal(firstConcurrentSave.status, 200)
  const clientBValue = clientB.payload.value.map((sale) => sale.id === 102 ? { ...sale, amount: 1200 } : sale)
  const staleSave = await request('/api/state/sales', { token: manager, method: 'PUT', body: { value: clientBValue, version: clientB.payload.version } })
  assert.equal(staleSave.status, 409, 'A stale client must receive a conflict rather than overwriting newer state.')
  const afterConflict = await request('/api/state/sales', { token: admin })
  assert.equal(afterConflict.payload.value.find((sale) => sale.id === 101).amount, 1100)
  assert.equal(afterConflict.payload.value.find((sale) => sale.id === 102).amount, 1000, 'An unrelated record must survive another record update.')
  assert.equal((await request('/api/state/sales', { token: operator, method: 'PUT', body: { value: [], version: afterConflict.payload.version } })).status, 403, 'Operators must not delete records from an existing register.')
  assert.equal((await request('/api/state/sales', { token: manager, method: 'PUT', body: { value: [], version: afterConflict.payload.version } })).status, 403, 'Generic register replacement must not bypass guarded sale deletion.')
  assert.equal((await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: [], version: afterConflict.payload.version } })).status, 403, 'Administrators must use guarded sale deletion too.')
  assert.equal((await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: [], version: 1 } })).status, 409, 'Stale writes must conflict for administrators too.')

  assert.equal((await request('/api/sales/102', { token: manager, method: 'DELETE' })).status, 200, 'Manager sale deletion should be authorized.')
  assert.deepEqual((await request('/api/state/sales', { token: admin })).payload.value.map((sale) => sale.id), [101])
  const missingVersion = await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: [], version: undefined } })
  assert.equal(missingVersion.status, 428, 'Writes without a read version must not be accepted.')

  const customers = [
    { id: 201, name: 'Debt Customer', phone: '', address: '', openingBalance: 250 },
    { id: 202, name: 'No-History Customer', phone: '', address: '', openingBalance: 0 },
    { id: 203, name: 'Paid History Customer', phone: '', address: '', openingBalance: 0 },
  ]
  assert.equal((await request('/api/state/customers', { token: admin, method: 'PUT', body: { value: customers, version: 0 } })).status, 200)
  assert.equal((await request('/api/state/customers', { token: admin, method: 'PUT', body: { value: [], version: 1 } })).status, 403, 'Generic register replacement must not bypass customer debt/history checks.')
  const transactionHistory = [
    { id: 701, customerId: 203, type: 'Payment Received', debit: 0, credit: 100 },
    { id: 103, customerId: 203, type: 'Credit Sale', debit: 100, credit: 0 },
  ]
  assert.equal((await request('/api/state/udhar-transactions', { token: admin, method: 'PUT', body: { value: transactionHistory, version: 0 } })).status, 200)
  const salesBeforeCreditEntry = await request('/api/state/sales', { token: admin })
  const linkedSale = { id: 103, date: '2026-10-03', product: 'HSD', litres: 1, rate: 100, amount: 100, mode: 'Credit', customer: 'Paid History Customer', customerId: 203 }
  assert.equal((await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: [...salesBeforeCreditEntry.payload.value, linkedSale], version: salesBeforeCreditEntry.payload.version } })).status, 200)
  assert.equal((await request('/api/sales/103', { token: manager, method: 'DELETE' })).status, 409, 'A sale with linked customer receivable history must be retained.')
  assert.equal((await request('/api/customers/201', { token: operator, method: 'DELETE' })).status, 403, 'Operators must not delete customers.')
  const debtDelete = await request('/api/customers/201', { token: admin, method: 'DELETE' })
  assert.equal(debtDelete.status, 409)
  assert.match(debtDelete.payload.error, /outstanding balance/i)
  const historyDelete = await request('/api/customers/203', { token: admin, method: 'DELETE' })
  assert.equal(historyDelete.status, 409, 'Even fully paid historical customer records must be retained.')
  assert.match(historyDelete.payload.error, /historical records/i)
  assert.equal((await request('/api/customers/202', { token: admin, method: 'DELETE' })).status, 200, 'A customer without debt or linked history can be deleted.')

  const managerBackup = await request('/api/system/backup', { token: manager, method: 'POST' })
  assert.equal(managerBackup.status, 201, 'Managers should be able to create daily backups.')
  await delay(1100)
  const adminBackup = await request('/api/system/backup', { token: admin, method: 'POST' })
  assert.equal(adminBackup.status, 201)
  const fixtureDatabase = new DatabaseSync(databasePath)
  try {
    const adminId = fixtureDatabase.prepare('SELECT id FROM users WHERE username = ?').get('admin').id
    fixtureDatabase.prepare('INSERT INTO register_state (key, value_json, updated_at, updated_by, version) VALUES (?, ?, ?, ?, ?)')
      .run('legacy-extra', JSON.stringify([{ retained: true }]), new Date().toISOString(), adminId, 1)
  } finally {
    fixtureDatabase.close()
  }

  const reset = await request('/api/system/reset-registers', { token: admin, method: 'POST', body: { confirmation: 'RESET ALL REGISTER DATA' } })
  assert.equal(reset.status, 200, `Authorized reset failed: ${JSON.stringify(reset.payload)}`)
  const safetyPath = join(backupDirectory, 'Safety', reset.payload.safetyBackup)
  assert.ok(existsSync(safetyPath), 'Reset safety backup must exist.')
  const safetySnapshot = inspectDatabase(safetyPath)
  assert.equal(safetySnapshot.users, 3, 'The safety backup must preserve all users.')
  assert.deepEqual(JSON.parse(safetySnapshot.sales.value_json).map((sale) => sale.id), [101, 103])
  assert.deepEqual(JSON.parse(safetySnapshot.legacy.value_json), [{ retained: true }])
  assert.deepEqual((await request('/api/state/sales', { token: admin })).payload.value, [])
  const resetUsers = new DatabaseSync(databasePath, { readOnly: true })
  try {
    assert.equal(resetUsers.prepare('SELECT count(*) AS count FROM users').get().count, 3)
    assert.deepEqual(JSON.parse(resetUsers.prepare('SELECT value_json FROM register_state WHERE key = ?').get('legacy-extra').value_json), [])
  } finally { resetUsers.close() }

  const postResetRead = await request('/api/state/sales', { token: admin })
  const retainedSale = [{ id: 303, date: '2026-10-03', product: 'HSD', litres: 1, rate: 1, amount: 1, mode: 'Cash', customer: '-' }]
  assert.equal((await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: retainedSale, version: postResetRead.payload.version } })).status, 200)
  const safetyDirectory = join(backupDirectory, 'Safety')
  const time = new Date()
  for (let offset = -5; offset <= 5; offset += 1) {
    const stamp = new Date(time.getTime() + offset * 1000).toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
    writeFileSync(join(safetyDirectory, `PPMS_PreReset_${stamp}.db`), 'occupied backup target')
  }
  const refusedReset = await request('/api/system/reset-registers', { token: admin, method: 'POST', body: { confirmation: 'RESET ALL REGISTER DATA' } })
  assert.equal(refusedReset.status, 500, 'Reset must fail if creation of its safety backup fails.')
  assert.deepEqual((await request('/api/state/sales', { token: admin })).payload.value, retainedSale, 'Failed backup must leave business data untouched.')

  await delay(1100)
  const dailyBackup = await request('/api/system/backup', { token: admin, method: 'POST' })
  assert.equal(dailyBackup.status, 201)
  const liveSales = await request('/api/state/sales', { token: admin })
  const changedSales = liveSales.payload.value.map((sale) => ({ ...sale, amount: 99 }))
  assert.equal((await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: changedSales, version: liveSales.payload.version } })).status, 200)
  const restored = await request('/api/system/restore', { token: admin, method: 'POST', body: { name: dailyBackup.payload.name } })
  assert.equal(restored.status, 200, `Database restore failed: ${JSON.stringify(restored.payload)}`)
  assert.equal((await request('/api/state/sales', { token: admin, method: 'PUT', body: { value: [], version: liveSales.payload.version } })).status, 409, 'Restore must not allow clients to reuse an old register version.')
  assert.deepEqual((await request('/api/state/sales', { token: admin })).payload.value, retainedSale, 'Database restore must restore the verified backup contents.')

  const deniedRegisterRestore = await request('/api/system/restore-registers', { token: manager, method: 'POST', body: { backup: '{}' } })
  assert.equal(deniedRegisterRestore.status, 403)
  const invalidRegisterRestore = await request('/api/system/restore-registers', { token: admin, method: 'POST', body: { backup: '{}' } })
  assert.equal(invalidRegisterRestore.status, 400, 'Register restore must retain backup validation.')
  const registerBackup = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data: { sales: [{ id: 404, date: '2026-10-04', product: 'PMG', litres: 2, rate: 3, amount: 6, mode: 'Cash', customer: '-' }] } })
  const restoredRegisters = await request('/api/system/restore-registers', { token: admin, method: 'POST', body: { backup: registerBackup } })
  assert.equal(restoredRegisters.status, 200)
  assert.deepEqual((await request('/api/state/sales', { token: admin })).payload.value.map((sale) => sale.id), [404])

  const operatorAfterLogout = await request('/api/auth/logout', { token: operator, method: 'POST' })
  assert.equal(operatorAfterLogout.status, 200)
  assert.equal((await request('/api/auth/me', { token: operator })).status, 401, 'Logout must invalidate the session.')
  assert.equal((await request('/api/auth/me', { token: admin })).status, 200, 'Administrator login must remain valid.')

  console.log('Security API regression tests passed: authorization, customer/sale deletion, version conflicts, reset safety, backup failure, restore, login, and logout.')
} finally {
  await stopServer()
  rmSync(tempRoot, { recursive: true, force: true })
}
