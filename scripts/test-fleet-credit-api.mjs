import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const projectRoot = resolve(import.meta.dirname, '..')
const tempRoot = mkdtempSync(join(tmpdir(), 'ppms-fleet-credit-api-'))
const databasePath = join(tempRoot, 'data', 'ppms.sqlite')
const startupPassword = 'Temporary-Admin-Password-123!'
let child
let childExit
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
      PPMS_APP_ROOT: tempRoot,
      PPMS_DB_PATH: databasePath,
      PPMS_BACKUP_DIR: join(tempRoot, 'backups'),
      PPMS_LOG_DIR: join(tempRoot, 'logs'),
      PPMS_LEGACY_DB_PATHS: '',
      PPMS_ADMIN_PASSWORD: startupPassword,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  childExit = new Promise((resolveExit) => child.once('exit', resolveExit))
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
  if (!child) return
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    const stopped = await Promise.race([childExit.then(() => true), delay(5000).then(() => false)])
    if (!stopped && child.exitCode === null) {
      child.kill('SIGKILL')
      await childExit
    }
  }
  child = null
}

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, payload: await response.json() }
}

async function saveRegister(token, key, value) {
  const current = await request(`/api/state/${key}`, { token })
  assert.equal(current.status, 200)
  return request(`/api/state/${key}`, {
    token,
    method: 'PUT',
    body: { value, version: current.payload.version },
  })
}

async function registerValue(token, key) {
  const result = await request(`/api/state/${key}`, { token })
  assert.equal(result.status, 200)
  return result.payload.value
}

function makePair(id, litres, rate = 300) {
  const amount = litres * rate
  const sale = {
    id, date: '2026-10-05', product: 'HSD', litres, rate, amount,
    mode: 'Credit', customer: 'Fleet Co', customerId: 8, vehicleId: 31, reference: `FLEET-${id}`,
  }
  const transaction = {
    id, date: sale.date, customerId: sale.customerId, type: 'Credit Sale',
    reference: sale.reference, description: `HSD fleet credit ${litres} L`,
    debit: amount, credit: 0, vehicleId: sale.vehicleId, fuelType: sale.product, litres,
  }
  return { sale, transaction }
}

function setFailureTrigger(key) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`CREATE TRIGGER fail_${key.replaceAll('-', '_')} BEFORE UPDATE ON register_state
      WHEN NEW.key = '${key}' BEGIN SELECT RAISE(ABORT, 'forced test write failure'); END`)
  } finally {
    database.close()
  }
}

function clearFailureTrigger(key) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec(`DROP TRIGGER fail_${key.replaceAll('-', '_')}`)
  } finally {
    database.close()
  }
}

try {
  await startServer()
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: startupPassword },
  })
  assert.equal(login.status, 200, `Temporary server login failed: ${JSON.stringify(login.payload)}`)
  const token = login.payload.token
  const operatorCreated = await request('/api/users', {
    token,
    method: 'POST',
    body: { username: 'fleet-operator', password: 'Temporary-Operator-123!', role: 'operator' },
  })
  assert.equal(operatorCreated.status, 201)
  const operatorLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { username: 'fleet-operator', password: 'Temporary-Operator-123!' },
  })
  assert.equal(operatorLogin.status, 200)
  const operatorToken = operatorLogin.payload.token

  for (const [key, value] of [
    ['sales', []],
    ['udhar-transactions', []],
    ['customers', [{ id: 8, name: 'Fleet Co', openingBalance: 0 }]],
    ['fleet-vehicles', [{ id: 31, customerId: 8, vehicleNumber: 'TEST-31', status: 'Active' }]],
    ['fleet-allocations', [{ id: 41, customerId: 8, vehicleId: 31, month: '2026-10', monthlyLitresLimit: 500 }]],
  ]) {
    const saved = await saveRegister(token, key, value)
    assert.equal(saved.status, 200, `Could not seed temporary ${key} register: ${JSON.stringify(saved.payload)}`)
  }

  const original = makePair(1001, 20)
  let result = await request('/api/fleet-credit-transactions', {
    token, method: 'POST', body: { operation: 'create', ...original },
  })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.sales.length, 1)
  assert.equal(result.payload.transactions.length, 1)
  assert.equal(result.payload.versions.sales, 2)
  assert.equal(result.payload.versions['udhar-transactions'], 2)
  assert.equal(result.payload.transactions[0].debit, 6000)

  result = await request('/api/fleet-credit-transactions', {
    token, method: 'POST', body: { operation: 'create', ...original },
  })
  assert.equal(result.status, 200, 'A retried create should be idempotent.')
  assert.equal(result.payload.alreadyApplied, true)
  assert.equal(result.payload.sales.length, 1)
  assert.equal(result.payload.transactions.length, 1)

  const updated = makePair(1001, 30)
  result = await request('/api/fleet-credit-transactions', {
    token, method: 'POST', body: { operation: 'update', ...updated },
  })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.sales.length, 1)
  assert.equal(result.payload.transactions.length, 1)
  assert.equal(result.payload.sales[0].litres, 30)
  assert.equal(result.payload.transactions[0].debit, 9000)
  assert.equal(result.payload.alreadyApplied, false)

  const overLimit = await request('/api/fleet-credit-transactions', {
    token, method: 'POST', body: { operation: 'create', ...makePair(1004, 471) },
  })
  assert.equal(overLimit.status, 400, 'Server-side allowance validation should reject an over-limit transaction.')
  assert.equal((await registerValue(token, 'sales')).length, 1)
  assert.equal((await registerValue(token, 'udhar-transactions')).length, 1)

  const operatorDelete = await request('/api/fleet-credit-transactions/1001', { token: operatorToken, method: 'DELETE' })
  assert.equal(operatorDelete.status, 403, 'Operators must not delete linked fleet credit sales.')

  for (const failingKey of ['sales', 'udhar-transactions']) {
    const beforeSales = await registerValue(token, 'sales')
    const beforeLedger = await registerValue(token, 'udhar-transactions')
    setFailureTrigger(failingKey)
    const failed = await request('/api/fleet-credit-transactions', {
      token, method: 'POST', body: { operation: 'create', ...makePair(1002 + (failingKey === 'sales' ? 0 : 1), 10) },
    })
    clearFailureTrigger(failingKey)
    assert.equal(failed.status, 500, `Injected ${failingKey} write failure should fail the whole operation.`)
    assert.deepEqual(await registerValue(token, 'sales'), beforeSales, `Sales changed after ${failingKey} write failure.`)
    assert.deepEqual(await registerValue(token, 'udhar-transactions'), beforeLedger, `Receivables changed after ${failingKey} write failure.`)
  }

  const withPayment = [...await registerValue(token, 'udhar-transactions'), {
    id: 2001, date: '2026-10-06', customerId: 8, type: 'Payment Received',
    reference: 'RCV-2001', description: 'Fleet payment', debit: 0, credit: 9000,
  }]
  const paymentSaved = await saveRegister(token, 'udhar-transactions', withPayment)
  assert.equal(paymentSaved.status, 200)
  const blockedDelete = await request('/api/fleet-credit-transactions/1001', { token, method: 'DELETE' })
  assert.equal(blockedDelete.status, 409, 'A sale already offset by customer payments must not be deleted.')
  assert.equal((await registerValue(token, 'sales')).length, 1)
  assert.equal((await registerValue(token, 'udhar-transactions')).length, 2)
  const paymentRemoved = await saveRegister(token, 'udhar-transactions', withPayment.filter((entry) => entry.id !== 2001))
  assert.equal(paymentRemoved.status, 200)

  result = await request('/api/fleet-credit-transactions/1001', { token, method: 'DELETE' })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.deepEqual(result.payload.sales, [])
  assert.deepEqual(result.payload.transactions, [])
  const remainingLitres = result.payload.transactions
    .filter((entry) => entry.type === 'Credit Sale' && entry.customerId === 8 && entry.vehicleId === 31 && entry.date.startsWith('2026-10'))
    .reduce((sum, entry) => sum + entry.litres, 0)
  assert.equal(500 - remainingLitres, 500, 'Deleting the linked pair should restore its monthly allowance usage.')

  console.log('Fleet-credit API tests passed: atomic create, rollback of either write, idempotent retry, linked update, and linked delete.')
} finally {
  try {
    await stopServer()
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}
