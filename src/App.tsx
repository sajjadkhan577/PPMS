import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import { calculateCommissionAmount, calculateCompanyFleetSummary, calculateDiscountAmount, calculateFuelStockSummary, calculateMeterPeriodSummary, calculateMeterTotal, calculatePaymentFee, calculateVehicleUsageSummary, findPreviousMeterReading, getCommissionTotal, getDashboardDateRange, getDashboardSummary, getMeterTestsForReading, normalizeLocalCalendarDate, recalculateMeterReadingChain, type MeterTestEntry } from './lib/ppms'
import { createBackup, parseBackup, readStored, restoreBackup, writeStored } from './lib/storage'

type Product = 'HSD' | 'PMG' | 'XTRON'
type DiscountType = 'percent' | 'fixed'
type PaymentMethod = 'Cash' | 'Card' | 'Credit Card' | 'Debit Card' | 'Bank Transfer' | 'Online Payment' | 'Other'

type MeterReading = { id: number; date: string; shift: string; nozzle: string; product: Product; previous: number; present: number; litres: number; rate?: number; amount?: number }
type Sale = {
  id: number
  date: string
  product: Product
  litres: number
  rate: number
  amount: number
  discount?: number
  discountAmount?: number
  netAmount?: number
  paymentMethod?: PaymentMethod
  paymentFee?: number
  totalCharged?: number
  mode: string
  customer: string
  customerId?: number
  vehicleId?: number
  reference?: string
}
type Customer = { id: number; name: string; phone: string; address: string; openingBalance: number }
type FleetVehicle = { id: number; customerId: number; vehicleNumber: string; vehicleName: string; driverName: string; fuelType: string; status: 'Active' | 'Inactive'; notes: string; createdAt: string; updatedAt: string }
type FleetAllocation = { id: number; customerId: number; vehicleId: number; month: string; monthlyLitresLimit: number; createdAt: string; updatedAt: string }
type UdharTransaction = { id: number; date: string; customerId: number; type: 'Opening Balance' | 'Credit Sale' | 'Payment Received' | 'Adjustment'; reference: string; description: string; debit: number; credit: number; paymentMethod?: string; vehicleId?: number; fuelType?: string; litres?: number }
type Expense = { id: number; date: string; category: string; description: string; amount: number; paidBy: string }
type EmployeeSalary = { id: number; date: string; period: string; employee: string; gross: number; deductions: number; net: number; paidBy: string; status: 'Paid' | 'Pending'; notes: string }
type Purchase = { id: number; date: string; product: Product; litres: number; rate: number; supplier: string; amount: number }
type OilSale = { id: number; date: string; item: string; quantity: number; rate: number; amount: number }
type CommissionRecord = { id: number; date: string; product: Product; eligibleLitres: number; commissionableLitres: number; rate: number; amount: number; reference: string; notes: string }
type DiscountRule = {
  id: number
  customerId?: number
  product?: Product
  discountType: DiscountType
  discountValue: number
  effectiveDate: string
  status: 'Active' | 'Inactive'
  description: string
}
type PaymentFeeSetting = {
  id: number
  method: PaymentMethod
  feePercent: number
  effectiveDate: string
  status: 'Active' | 'Inactive'
  absorbedByBusiness: boolean
}
type StockAdjustment = {
  id: number
  date: string
  product: Product
  tank: string
  transactionType: 'Opening Stock' | 'Fuel Purchase' | 'Fuel Sale' | 'Stock Adjustment' | 'Transfer' | 'Correction' | 'Return'
  reference: string
  quantity: number
  user: string
  reason: string
  notes: string
}
type BankAccount = {
  id: number
  bankName: string
  accountName: string
  accountNumber: string
  openingBalance: number
  currentBookBalance: number
  active?: boolean
}
type BRSRecord = {
  id: number
  bankAccountId: number
  legacyBankName?: string
  date: string
  description: string
  type: 'Deposit' | 'Withdrawal'
  amount: number
  status: 'Matched' | 'Unmatched' | 'Pending' | 'Book Only' | 'Bank Only'
  reference: string
  bankAmount?: number
  adjustment?: number
  difference?: number
}
type FamilyAdjustment = {
  id: number
  date: string
  customerId?: number
  amount: number
  adjustmentType: 'Increase' | 'Decrease'
  status: 'Active' | 'Inactive'
  description: string
  notes: string
}
type SessionUser = { id: string; username: string; role: 'admin' | 'manager' | 'operator' }
type PrintDocumentRequest = { title: string; period: string }
type SystemStatus = { version: string; databasePath: string; backupDir: string; databaseExists: boolean }
type BackupInfo = { name: string; type: 'Daily' | 'Monthly' | 'Safety'; createdAt: string; modifiedAt: string; size: number }

function clearLaunchSession() {
  localStorage.removeItem('ppms-session-token')
  localStorage.removeItem('ppms-session-user')
}

const navigationGroups = [
  { label: 'Overview', tabs: ['Dashboard'] },
  { label: 'Operations', tabs: ['Daily Operations', 'Meter Reading', 'Sales', 'Fuel Management', 'Safety Duty', 'Mobile Oil'] },
  { label: 'Customers', tabs: ['Customers'] },
  { label: 'Finance', tabs: ['Expenses', 'Commission', 'Accounting'] },
  { label: 'Reports', tabs: ['Reports'] },
  { label: 'System', tabs: ['Settings'] },
]
const products: Product[] = ['HSD', 'PMG', 'XTRON']
const productNozzles: Record<Product, string[]> = { HSD: ['HSD-1', 'HSD-2', 'HSD-3', 'HSD-4'], PMG: ['PMG-1', 'PMG-2', 'PMG-3', 'PMG-4'], XTRON: ['XTRON-1', 'XTRON-2', 'XTRON-3'] }
const DEFAULT_STOCK: Record<Product, number> = { HSD: 20000, PMG: 15000, XTRON: 5000 }

function getSystemDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const today = getSystemDate()

function displayDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
}

const initialMeters: MeterReading[] = []
const initialSales: Sale[] = []
const initialCustomers: Customer[] = [
  { id: 1, name: 'Al-Rehman Transport', phone: '0300-1234567', address: '', openingBalance: 120000 },
  { id: 2, name: 'Khan Traders', phone: '0321-5550199', address: '', openingBalance: 45000 },
]
const initialFleetVehicles: FleetVehicle[] = []
const initialFleetAllocations: FleetAllocation[] = []
const initialUdhar: UdharTransaction[] = [
  { id: 1, date: '2026-09-01', customerId: 1, type: 'Opening Balance', reference: 'OB-001', description: 'Opening balance', debit: 120000, credit: 0 },
  { id: 4, date: '2026-09-01', customerId: 2, type: 'Opening Balance', reference: 'OB-002', description: 'Opening balance', debit: 45000, credit: 0 },
]

const defaultDiscountRules: DiscountRule[] = [
  { id: 1, customerId: 1, product: 'HSD', discountType: 'percent', discountValue: 2, effectiveDate: today, status: 'Active', description: 'ABC Transport HSD discount' },
  { id: 2, customerId: 2, product: 'PMG', discountType: 'fixed', discountValue: 5, effectiveDate: today, status: 'Active', description: 'PMG fixed discount' },
]
const defaultPaymentFees: PaymentFeeSetting[] = [
  { id: 1, method: 'Card', feePercent: 2, effectiveDate: today, status: 'Active', absorbedByBusiness: false },
  { id: 2, method: 'Online Payment', feePercent: 2.5, effectiveDate: today, status: 'Active', absorbedByBusiness: true },
]
const defaultBankAccounts: BankAccount[] = [
  { id: 1, bankName: 'HBL', accountName: 'EKHWAN-1 Depot', accountNumber: 'PK-001-454', openingBalance: 1200000, currentBookBalance: 1250000, active: true },
]
const defaultBRS: BRSRecord[] = [
  { id: 1, bankAccountId: 1, date: today, description: 'Bank deposit', type: 'Deposit', amount: 250000, status: 'Matched', reference: 'DEP-001' },
  { id: 2, bankAccountId: 1, date: today, description: 'Fuel sale settlement', type: 'Withdrawal', amount: 98000, status: 'Pending', reference: 'WDL-001' },
]
const defaultFamilyAdjustments: FamilyAdjustment[] = []
const defaultStockOpenings: Record<Product, number> = { ...DEFAULT_STOCK }

const STORAGE_KEYS = [
  'ppms-meters',
  'ppms-meter-calibrations',
  'ppms-sales',
  'ppms-customers',
  'ppms-udhar-transactions',
  'ppms-expenses',
  'ppms-purchases',
  'ppms-oil-sales',
  'ppms-discount-rules',
  'ppms-payment-fees',
  'ppms-stock-adjustments',
  'ppms-bank-accounts',
  'ppms-brs-records',
  'ppms-family-adjustments',
  'ppms-employee-salaries',
  'ppms-commission-records',
  'ppms-stock-openings',
  'ppms-fleet-vehicles',
  'ppms-fleet-allocations',
]

const API_URL = 'http://127.0.0.1:8787'

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('ppms-session-token')
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed.') as Error & { status: number }
    error.status = response.status
    throw error
  }
  return payload
}

function useStored<T>(key: string, initial: T, normalize: (value: unknown) => T = (value) => value as T) {
  const remoteToken = localStorage.getItem('ppms-session-token')
  const storedUser = (() => {
    try { return JSON.parse(localStorage.getItem('ppms-session-user') || '{}') as { role?: string } } catch { return {} }
  })()
  const restrictedKeys = ['commission-records', 'discount-rules', 'payment-fees', 'bank-accounts', 'brs-records', 'family-adjustments', 'stock-openings']
  const canRead = key === 'employee-salaries' ? storedUser.role === 'admin'
    : restrictedKeys.includes(key) ? storedUser.role === 'admin' || storedUser.role === 'manager'
      : true
  const [remoteReady, setRemoteReady] = useState(!remoteToken)
  const [value, setValue] = useState<T>(() => {
    return canRead ? readStored(localStorage, `ppms-${key}`, initial, normalize) : initial
  })
  const version = useRef<number | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!remoteToken || !canRead) {
      if (remoteToken && !canRead) {
        version.current = null
        setValue(initial)
      }
      setRemoteReady(true)
      return
    }
    apiRequest<{ value: unknown; version: number }>(`/api/state/${key}`).then((payload) => {
      version.current = payload.version
      if (payload.value !== null) setValue(normalize(payload.value))
    }).catch((error: Error) => {
      window.dispatchEvent(new CustomEvent('ppms-request-error', { detail: error.message }))
    }).finally(() => setRemoteReady(true))
  }, [canRead, key, remoteToken])
  useEffect(() => {
    if (!remoteReady) return
    if (remoteToken && (!canRead || version.current === null)) return
    writeStored(localStorage, `ppms-${key}`, value)
    window.dispatchEvent(new Event(`ppms-${key}-updated`))
    if (remoteToken) {
      saveQueue.current = saveQueue.current.then(async () => {
        const payload = await apiRequest<{ version: number }>(`/api/state/${key}`, { method: 'PUT', body: JSON.stringify({ value, version: version.current }) })
        version.current = payload.version
      }).catch((error: Error) => {
        window.dispatchEvent(new CustomEvent('ppms-request-error', { detail: error.message }))
      })
    }
  }, [canRead, key, remoteReady, remoteToken, value])
  return [value, setValue] as const
}

function LoginPanel({ onLogin, error }: { onLogin: (username: string, password: string) => void; error: string }) {
  const [showPassword, setShowPassword] = useState(false)
  const passwordToggleLabel = showPassword ? 'Hide password' : 'Show password'

  return <main className="login-panel"><div className="login-card"><span className="brand-mark">P</span><p className="eyebrow">Petrol Pump Management System</p><h1>Operator Sign In</h1><p>Use an authenticated PPMS account to access station registers.</p><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onLogin(String(data.get('username')), String(data.get('password'))) }}><label className="form-field"><span>Username</span><input name="username" autoComplete="username" required /></label><div className="form-field"><label htmlFor="login-password"><span>Password</span></label><div className="login-password-shell"><input id="login-password" className="login-password-input" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required /><button className="login-password-toggle" type="button" aria-label={passwordToggleLabel} title={passwordToggleLabel} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.7 4.5 9.5 6-.3.6-1.2 1.8-2.7 3M6.2 6.2C3.9 7.7 2.5 10 2.5 11c.8 1.5 4.3 6 9.5 6 1 0 1.9-.2 2.8-.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8"/></svg>}</button></div></div>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">Sign In</button></form></div></main>
}

const money = (value: number) => `Rs. ${Math.round(value).toLocaleString('en-PK')}`
const printMoney = (value: number) => `Rs. ${value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const numberValue = (value: FormDataEntryValue | null) => Number(value) || 0
const measurement = (value: number) => value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 3 })

const sampleMeterReadings = new Set(['2026-09-12|HSD-1|11800|12500', '2026-09-12|HSD-2|12100|12800', '2026-09-12|PMG-1|11350|11980', '2026-09-12|PMG-2|11490|12120'])

function normalizeMeters(value: unknown): MeterReading[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const meter = item as Partial<MeterReading>
    const previous = Number(meter.previous)
    const present = Number(meter.present)
    const litres = Number(meter.litres ?? present - previous)
    const rate = meter.rate === undefined ? undefined : Number(meter.rate)
    const amount = meter.amount === undefined ? (rate === undefined ? undefined : litres * rate) : Number(meter.amount)
    const rawDate = String(meter.date || '')
    return { id: Number(meter.id), date: normalizeLocalCalendarDate(rawDate) || rawDate, shift: String(meter.shift || 'Day'), nozzle: String(meter.nozzle || ''), product: (meter.product || 'HSD') as Product, previous, present, litres, rate, amount }
  }).filter((meter) => Number.isFinite(meter.id) && Number.isFinite(meter.previous) && Number.isFinite(meter.present) && Number.isFinite(meter.litres) && (meter.rate === undefined || Number.isFinite(meter.rate)) && !sampleMeterReadings.has(`${meter.date}|${meter.nozzle}|${meter.previous}|${meter.present}`))
}

function normalizeMeterTests(value: unknown): MeterTestEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof (item as Partial<MeterTestEntry>).returnedToTank === 'boolean').map((item) => {
    const test = item as Partial<MeterTestEntry>
    const rawDate = String(test.date || '')
    const product = String(test.product || 'HSD')
    return {
      id: Number(test.id),
      date: normalizeLocalCalendarDate(rawDate) || rawDate,
      shift: String(test.shift || 'Day'),
      product,
      nozzle: String(test.nozzle || ''),
      quantity: Number(test.quantity),
      returnedToTank: test.returnedToTank === true,
      reason: String(test.reason || ''),
      reference: String(test.reference || ''),
      notes: String(test.notes || ''),
    }
  }).filter((test) => Number.isFinite(test.id) && Boolean(normalizeLocalCalendarDate(test.date)) && ['Day', 'Night'].includes(test.shift) && products.includes(test.product as Product) && productNozzles[test.product as Product].includes(test.nozzle) && Number.isFinite(test.quantity) && test.quantity > 0)
}

function normalizeSales(value: unknown): Sale[] {
  if (!Array.isArray(value)) return initialSales
  return (value as Sale[]).filter((sale) => !(
    (sale.id === 1 && sale.product === 'HSD' && sale.litres === 3080 && sale.rate === 285 && sale.amount === 877800 && sale.mode === 'Cash' && sale.customer === '-') ||
    (sale.id === 2 && sale.product === 'PMG' && sale.litres === 1420 && sale.rate === 280 && sale.amount === 397600 && sale.mode === 'Credit' && sale.customer === 'Al-Rehman Transport' && sale.customerId === 1)
  ))
}

function normalizeUdharTransactions(value: unknown): UdharTransaction[] {
  if (!Array.isArray(value)) return initialUdhar
  return (value as UdharTransaction[]).filter((entry) => !(
    (entry.id === 2 && entry.reference === 'SALE-2' && entry.customerId === 1 && entry.type === 'Credit Sale' && entry.debit === 397600 && entry.credit === 0) ||
    (entry.id === 3 && entry.reference === 'RCV-001' && entry.customerId === 1 && entry.type === 'Payment Received' && entry.debit === 0 && entry.credit === 250000) ||
    (entry.id === 5 && entry.reference === 'SALE-003' && entry.customerId === 2 && entry.type === 'Credit Sale' && entry.debit === 125000 && entry.credit === 0) ||
    (entry.id === 6 && entry.reference === 'RCV-002' && entry.customerId === 2 && entry.type === 'Payment Received' && entry.debit === 0 && entry.credit === 90000)
  ))
}

function normalizeFleetVehicles(value: unknown): FleetVehicle[] {
  if (!Array.isArray(value)) return initialFleetVehicles
  return value.map((item) => {
    const vehicle = item as Partial<FleetVehicle>
    const customerId = Number(vehicle.customerId)
    const id = Number(vehicle.id)
    const vehicleNumber = String(vehicle.vehicleNumber || '')
    return {
      id: Number.isFinite(id) ? id : Date.now(),
      customerId: Number.isFinite(customerId) ? customerId : 0,
      vehicleNumber,
      vehicleName: String(vehicle.vehicleName || vehicleNumber || 'Vehicle'),
      driverName: String(vehicle.driverName || ''),
      fuelType: String(vehicle.fuelType || 'HSD'),
      status: (vehicle.status === 'Inactive' ? 'Inactive' : 'Active') as 'Active' | 'Inactive',
      notes: String(vehicle.notes || ''),
      createdAt: String(vehicle.createdAt || new Date().toISOString()),
      updatedAt: String(vehicle.updatedAt || new Date().toISOString()),
    }
  }).filter((vehicle) => vehicle.customerId > 0 && vehicle.vehicleNumber)
}

function normalizeFleetAllocations(value: unknown): FleetAllocation[] {
  if (!Array.isArray(value)) return initialFleetAllocations
  return value.map((item) => {
    const allocation = item as Partial<FleetAllocation>
    const customerId = Number(allocation.customerId)
    const vehicleId = Number(allocation.vehicleId)
    const month = String(allocation.month || '')
    const id = Number(allocation.id)
    return {
      id: Number.isFinite(id) ? id : Date.now(),
      customerId: Number.isFinite(customerId) ? customerId : 0,
      vehicleId: Number.isFinite(vehicleId) ? vehicleId : 0,
      month,
      monthlyLitresLimit: Number.isFinite(Number(allocation.monthlyLitresLimit)) ? Number(allocation.monthlyLitresLimit) : 0,
      createdAt: String(allocation.createdAt || new Date().toISOString()),
      updatedAt: String(allocation.updatedAt || new Date().toISOString()),
    }
  }).filter((allocation) => allocation.customerId > 0 && allocation.vehicleId > 0 && allocation.month)
}

function normalizeBankAccounts(value: unknown): BankAccount[] {
  if (!Array.isArray(value)) return defaultBankAccounts
  return value.map((item) => {
    const account = item as Partial<BankAccount>
    return {
      id: Number(account.id),
      bankName: String(account.bankName || ''),
      accountName: String(account.accountName || ''),
      accountNumber: String(account.accountNumber || ''),
      openingBalance: Number(account.openingBalance || 0),
      currentBookBalance: Number(account.currentBookBalance || 0),
      active: account.active !== false,
    }
  }).filter((account) => Number.isFinite(account.id) && account.bankName && account.accountName)
}

function normalizeBRSRecords(value: unknown): BRSRecord[] {
  if (!Array.isArray(value)) return defaultBRS
  return value.map((item) => {
    const record = item as Partial<BRSRecord> & { bank?: string; bankName?: string }
    const bankAccountId = Number(record.bankAccountId)
    return {
      id: Number(record.id),
      bankAccountId: Number.isFinite(bankAccountId) ? bankAccountId : 0,
      legacyBankName: record.legacyBankName || record.bank || record.bankName,
      date: String(record.date || ''),
      description: String(record.description || ''),
      type: record.type === 'Withdrawal' ? 'Withdrawal' : 'Deposit',
      amount: Number(record.amount || 0),
      status: record.status || 'Pending',
      reference: String(record.reference || ''),
      bankAmount: Number(record.bankAmount || 0),
      adjustment: Number(record.adjustment || 0),
      difference: typeof record.difference === 'number' ? record.difference : Number(record.amount || 0) - Number(record.bankAmount || 0),
    }
  })
}

function normalizeCommissionRecords(value: unknown): CommissionRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const record = item as Partial<CommissionRecord> & { fuelType?: Product; litres?: number; commissionAmount?: number; commissionRate?: number }
    const commissionableLitres = Number(record.commissionableLitres ?? record.litres ?? 0)
    const rate = Number(record.rate ?? record.commissionRate ?? 0)
    return {
      id: Number(record.id),
      date: String(record.date || ''),
      product: (record.product || record.fuelType || 'HSD') as Product,
      eligibleLitres: Number(record.eligibleLitres ?? commissionableLitres),
      commissionableLitres,
      rate,
      amount: Number(record.amount ?? record.commissionAmount ?? commissionableLitres * rate),
      reference: String(record.reference || ''),
      notes: String(record.notes || ''),
    }
  }).filter((record) => Number.isFinite(record.id) && products.includes(record.product))
}

function normalizeExpenses(value: unknown): Expense[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const expense = item as Partial<Expense>
    const paidBy = String(expense.paidBy || 'Cash')
    const amount = Math.abs(Number(expense.amount) || 0)
    return { id: Number(expense.id), date: String(expense.date || ''), category: String(expense.category || ''), description: String(expense.description || ''), amount: paidBy === 'Discount' ? -amount : amount, paidBy }
  }).filter((expense) => Number.isFinite(expense.id) && expense.date && Number.isFinite(expense.amount))
}

function Field({ label, name, type = 'text', defaultValue, options, required = true, min, step }: { label: string; name: string; type?: string; defaultValue?: string | number; options?: string[]; required?: boolean; min?: string | number; step?: string | number }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {options ? (
        <select name={name} defaultValue={defaultValue} required={required}>
          <option value="">Select</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input name={name} type={type} min={min} step={step ?? (type === 'number' ? 'any' : undefined)} defaultValue={defaultValue} required={required} />
      )}
    </label>
  )
}

function FormPanel({ title, children, onSubmit, submitLabel = 'Save Entry', onReset }: { title: string; children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; submitLabel?: string; onReset?: () => void }) {
  return (
    <form className="register-section entry-form" onSubmit={onSubmit} onReset={onReset}>
      <div className="section-heading"><h3>{title}</h3><span className="form-note">Saved on this device</span></div>
      <div className="form-grid">{children}</div>
      <div className="form-actions"><button className="primary-button" type="submit">{submitLabel}</button><button className="ghost-button" type="reset">Clear</button></div>
    </form>
  )
}

function DataTable({ headers, rows, empty = 'No entries recorded yet.', actions }: { headers: string[]; rows: (string | number)[][]; empty?: string; actions?: (rowIndex: number) => ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}{actions && <th>Actions</th>}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}{actions && <td>{actions(rowIndex)}</td>}</tr>) : <tr><td colSpan={headers.length + (actions ? 1 : 0)} className="empty-cell">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function PrintDocument({ request, rows, headers, summary, signatures = true }: { request: PrintDocumentRequest; rows: (string | number)[][]; headers: string[]; summary?: [string, string][]; signatures?: boolean }) {
  return <section className="print-document">
    <header className="print-header"><h1>EKHWAN - 1 FILLING STATION</h1><p>Petrol Pump Management System</p><div className="print-rule" /><h2>{request.title}</h2><p>Period: {request.period}</p><p>Generated: {new Date().toLocaleString('en-GB')}</p></header>
    <table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, rowIndex) => <tr key={`print-row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`print-cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length} className="empty-cell">No transactions found for the selected period.</td></tr>}</tbody></table>
    {summary && <section className="print-summary"><h3>Summary</h3>{summary.map(([label, value]) => <p key={label}><strong>{label}</strong><span>{value}</span></p>)}</section>}
    {signatures && <footer className="print-signatures"><div>Prepared By<br /><span>________________</span><br />Signature</div><div>Shift Manager<br /><span>________________</span><br />Signature</div><div>Verified By<br /><span>________________</span><br />Signature</div></footer>}
    <footer className="print-footer">Generated by Petrol Pump Management System</footer>
  </section>
}

function customerBalance(customerId: number, customers: Customer[], transactions: UdharTransaction[]) {
  const customer = customers.find((item) => item.id === customerId)
  const entries = transactions.filter((item) => item.customerId === customerId)
  const balance = entries.reduce((sum, item) => sum + item.debit - item.credit, 0)
  const hasOpeningEntry = entries.some((item) => item.type === 'Opening Balance')
  return customer ? (hasOpeningEntry ? balance : customer.openingBalance + balance) : 0
}

export default function App() {
  const [authUser, setAuthUser] = useState<SessionUser | null>(null)
  const [authError, setAuthError] = useState('')
  const [selectedTab, setSelectedTab] = useState('Dashboard')
  const [selectedSafetyProduct, setSelectedSafetyProduct] = useState<Product | null>(null)
  const [safetySummaryView, setSafetySummaryView] = useState<'Daily' | 'Weekly'>('Daily')
  const [safetySummaryPeriod, setSafetySummaryPeriod] = useState('This Week')
  const [safetySummaryFrom, setSafetySummaryFrom] = useState(today)
  const [safetySummaryTo, setSafetySummaryTo] = useState(today)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [meters, setMeters] = useStored<MeterReading[]>('meters', initialMeters, normalizeMeters)
  const [meterTests, setMeterTests] = useStored<MeterTestEntry[]>('meter-calibrations', [], normalizeMeterTests)
  const [meterTestDraft, setMeterTestDraft] = useState({ date: today, shift: '', product: 'HSD' as Product, nozzle: 'HSD-1', quantity: '', reason: '', returnedToTank: '', reference: '', notes: '' })
  const [editingMeterTest, setEditingMeterTest] = useState<MeterTestEntry | null>(null)
  const [meterDraft, setMeterDraft] = useState({ date: today, shift: 'Day', product: 'HSD' as Product, nozzle: 'HSD-1', previous: '', present: '', rate: '' })
  const [sales, setSales] = useStored<Sale[]>('sales', initialSales, normalizeSales)
  const [customers, setCustomers] = useStored<Customer[]>('customers', initialCustomers, (value) => Array.isArray(value) ? value.map((item) => {
    const legacy = item as Partial<Customer> & { opening?: number }
    return { id: Number(legacy.id), name: String(legacy.name || ''), phone: String(legacy.phone || ''), address: String(legacy.address || ''), openingBalance: Number(legacy.openingBalance ?? legacy.opening ?? 0) }
  }) : initialCustomers)
  const [fleetVehicles, setFleetVehicles] = useStored<FleetVehicle[]>('fleet-vehicles', initialFleetVehicles, normalizeFleetVehicles)
  const [fleetAllocations, setFleetAllocations] = useStored<FleetAllocation[]>('fleet-allocations', initialFleetAllocations, normalizeFleetAllocations)
  const [udhar, setUdhar] = useStored<UdharTransaction[]>('udhar-transactions', initialUdhar, normalizeUdharTransactions)
  const [expenses, setExpenses] = useStored<Expense[]>('expenses', [], normalizeExpenses)
  const [purchases, setPurchases] = useStored<Purchase[]>('purchases', [])
  const [oilSales, setOilSales] = useStored<OilSale[]>('oil-sales', [])
  const [commissionRecords, setCommissionRecords] = useStored<CommissionRecord[]>('commission-records', [], normalizeCommissionRecords)
  const [discountRules, setDiscountRules] = useStored<DiscountRule[]>('discount-rules', defaultDiscountRules)
  const [paymentFees, setPaymentFees] = useStored<PaymentFeeSetting[]>('payment-fees', defaultPaymentFees)
  const [stockAdjustments, setStockAdjustments] = useStored<StockAdjustment[]>('stock-adjustments', [])
  const [bankAccounts, setBankAccounts] = useStored<BankAccount[]>('bank-accounts', defaultBankAccounts, normalizeBankAccounts)
  const [brsRecords, setBrsRecords] = useStored<BRSRecord[]>('brs-records', defaultBRS, normalizeBRSRecords)
  const [familyAdjustments, setFamilyAdjustments] = useStored<FamilyAdjustment[]>('family-adjustments', defaultFamilyAdjustments)
  const [employeeSalaries, setEmployeeSalaries] = useStored<EmployeeSalary[]>('employee-salaries', [])
  const [stockOpenings, setStockOpenings] = useStored<Record<Product, number>>('stock-openings', defaultStockOpenings)
  const [notice, setNotice] = useState('')
  const [statementCustomerId, setStatementCustomerId] = useState(1)
  const [statementDate, setStatementDate] = useState(today)
  const [saleCustomerId, setSaleCustomerId] = useState(1)
  const [saleVehicleId, setSaleVehicleId] = useState(0)
  const [fleetCompanyId, setFleetCompanyId] = useState(1)
  const [fleetMonthFilter, setFleetMonthFilter] = useState(today.slice(0, 7))
  const [fleetVehicleDraft, setFleetVehicleDraft] = useState({ vehicleNumber: '', vehicleName: '', driverName: '', fuelType: 'HSD', status: 'Active' as 'Active' | 'Inactive', notes: '' })
  const [editingFleetVehicle, setEditingFleetVehicle] = useState<FleetVehicle | null>(null)
  const [fleetAllocationVehicleId, setFleetAllocationVehicleId] = useState<number>(0)
  const [fleetAllocationDraft, setFleetAllocationDraft] = useState('0')
  const [fleetCreditCompanyId, setFleetCreditCompanyId] = useState(1)
  const [fleetCreditVehicleId, setFleetCreditVehicleId] = useState<number>(0)
  const [fleetCreditDraft, setFleetCreditDraft] = useState({ date: today, fuelType: 'HSD', litres: '', rate: '', reference: '', description: '' })
  const [editingFleetCreditEntry, setEditingFleetCreditEntry] = useState<UdharTransaction | null>(null)
  const [paymentCustomerId, setPaymentCustomerId] = useState(0)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(today)
  const [paymentMethod, setPaymentMethod] = useState('Cash')
  const [paymentReference, setPaymentReference] = useState('')
  const [editingPayment, setEditingPayment] = useState<UdharTransaction | null>(null)
  const [dashboardPeriod, setDashboardPeriod] = useState('Today')
  const [dashboardCustomFrom, setDashboardCustomFrom] = useState(`${today.slice(0, 7)}-01`)
  const [dashboardCustomTo, setDashboardCustomTo] = useState(today)
  const [stockProduct, setStockProduct] = useState<Product>('HSD')
  const [stockReason, setStockReason] = useState('Cycle count')
  const [stockUser, setStockUser] = useState('Manager')
  const [editingStockProduct, setEditingStockProduct] = useState<Product | null>(null)
  const [stockOpeningDraft, setStockOpeningDraft] = useState('')
  const [reportPeriod, setReportPeriod] = useState('This Month')
  const [reportCustomFrom, setReportCustomFrom] = useState(`${today.slice(0, 7)}-01`)
  const [reportCustomTo, setReportCustomTo] = useState(today)
  const [selectedReport, setSelectedReport] = useState('Daily Sales')
  const [users, setUsers] = useState<SessionUser[]>([])
  const [recordSearch, setRecordSearch] = useState('')
  const [currentSystemDate, setCurrentSystemDate] = useState(getSystemDate)
  const [brsBankFilter, setBrsBankFilter] = useState('all')
  const [brsBookAmount, setBrsBookAmount] = useState('0')
  const [brsBankAmount, setBrsBankAmount] = useState('0')
  const [commissionPreviewDate, setCommissionPreviewDate] = useState(today)
  const [commissionPreviewProduct, setCommissionPreviewProduct] = useState<Product>('HSD')
  const [commissionPreviewLitres, setCommissionPreviewLitres] = useState('0')
  const [commissionPreviewRate, setCommissionPreviewRate] = useState('0')
  const [printRequest, setPrintRequest] = useState<PrintDocumentRequest | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupFilter, setBackupFilter] = useState<'All' | 'Daily' | 'Monthly' | 'Safety'>('All')
  const [monthlyBackupMonth, setMonthlyBackupMonth] = useState(currentSystemDate.slice(0, 7))
  const [backupMonth, setBackupMonth] = useState(currentSystemDate.slice(0, 7))
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [showChangeUsername, setShowChangeUsername] = useState(false)
  const [changeUsername, setChangeUsername] = useState('')
  const [changeUsernamePassword, setChangeUsernamePassword] = useState('')
  const [changeUsernameError, setChangeUsernameError] = useState('')
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false)
  const [changePasswordOld, setChangePasswordOld] = useState('')
  const [changePasswordNew, setChangePasswordNew] = useState('')
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('')
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [editingMeter, setEditingMeter] = useState<MeterReading | null>(null)

  useEffect(() => {
    clearLaunchSession()
  }, [])

  useEffect(() => {
    const handleRequestError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (detail) setNotice(detail)
    }
    window.addEventListener('ppms-request-error', handleRequestError)
    return () => window.removeEventListener('ppms-request-error', handleRequestError)
  }, [])

  useEffect(() => {
    if (!authUser || authUser.role === 'operator' || !localStorage.getItem('ppms-session-token')) return
    const loadBackups = () => apiRequest<{ backups: BackupInfo[] }>('/api/system/backups').then((payload) => setBackups(payload.backups)).catch((error: Error) => flash(error.message))
    const loadSystem = () => {
      apiRequest<SystemStatus>('/api/system/status').then(setSystemStatus).catch(() => undefined)
      loadBackups()
    }
    loadSystem()
    const lastBackup = localStorage.getItem('ppms-last-auto-backup')
    if (authUser.role === 'admin' && lastBackup !== currentSystemDate) {
      apiRequest<{ name: string }>('/api/system/backup', { method: 'POST' }).then(() => localStorage.setItem('ppms-last-auto-backup', currentSystemDate)).catch(() => undefined)
    }
  }, [authUser, currentSystemDate])

  useEffect(() => {
    const refreshSystemDate = () => {
      const nextDate = getSystemDate()
      setCurrentSystemDate((current) => current === nextDate ? current : nextDate)
    }
    refreshSystemDate()
    const timer = window.setInterval(refreshSystemDate, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!printRequest) return
    const originalTitle = document.title
    document.title = `EKHWAN-1 - ${printRequest.title} - ${printRequest.period}`
    const restore = () => {
      document.title = originalTitle
      setPrintRequest(null)
    }
    window.addEventListener('afterprint', restore, { once: true })
    const timer = window.setTimeout(() => window.print(), 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', restore)
      document.title = originalTitle
    }
  }, [printRequest])

  const printDocument = (title: string, period = displayDate(currentSystemDate)) => setPrintRequest({ title, period })
  const loadBackups = () => apiRequest<{ backups: BackupInfo[] }>('/api/system/backups').then((payload) => setBackups(payload.backups)).catch((error: Error) => flash(error.message))
  const backupDatabase = () => apiRequest<{ name: string }>('/api/system/backup', { method: 'POST' }).then((payload) => { flash(`Daily backup created: ${payload.name}`); return loadBackups() }).catch((error: Error) => flash(error.message))
  const createMonthlyBackup = () => {
    const [year, month] = monthlyBackupMonth.split('-').map(Number)
    const lastDay = new Date(year, month, 0).getDate()
    const isCurrentMonth = monthlyBackupMonth === currentSystemDate.slice(0, 7)
    const isMonthEnd = !isCurrentMonth || Number(currentSystemDate.slice(8, 10)) === lastDay
    if (!isMonthEnd && !window.confirm(`${displayDate(`${backupMonth}-01`)} has not ended yet. Today is ${displayDate(currentSystemDate)}. Create this monthly backup anyway?`)) return
    const request = (replace = false) => apiRequest<{ name: string }>('/api/system/monthly-backup', { method: 'POST', body: JSON.stringify({ month: monthlyBackupMonth, replace }) })
    request().catch((error: Error) => {
      if (error.message.includes('already exists') && window.confirm(`A monthly backup for ${monthlyBackupMonth} already exists. Replace it?`)) return request(true).then((payload) => { flash(`Monthly backup created: ${payload.name}`); return loadBackups() }).catch((replaceError: Error) => flash(replaceError.message))
      flash(error.message)
    }).then((payload) => { if (payload) { flash(`Monthly backup created: ${payload.name}`); return loadBackups() } return undefined })
  }
  const deleteBackup = (backup: BackupInfo) => {
    const message = backup.type === 'Monthly'
      ? `Delete Monthly Backup?\n\n${backup.name}\n\nThis is a monthly restore point. This action cannot be undone.`
      : `Delete backup?\n\n${backup.name}\n\nThis action cannot be undone.`
    if (!window.confirm(message)) return
    apiRequest(`/api/system/backups/${encodeURIComponent(backup.name)}?confirmed=true`, { method: 'DELETE' }).then(() => { flash('Backup deleted successfully.'); return loadBackups() }).catch((error: Error) => {
      if (error.message === 'Backup file not found.') return loadBackups().then(() => flash('Backup list refreshed. The selected file was already removed.'))
      flash(error.message)
    })
  }
  const restoreDatabase = (name: string) => {
    if (!window.confirm(`Restore ${name}?\n\nThis replaces the current PPMS database. A safety backup will be created first, then PPMS will reload with the restored data.`)) return
    apiRequest<{ restored: string; safetyBackup: string }>('/api/system/restore', { method: 'POST', body: JSON.stringify({ name }) }).then((payload) => { flash(`Database restored. Safety backup: ${payload.safetyBackup}`); window.setTimeout(() => window.location.reload(), 700) }).catch((error: Error) => flash(error.message))
  }

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const go = (tab: string) => { setSelectedTab(tab); setNotice(''); setMobileMenuOpen(false) }
  const customerName = (id: number) => customers.find((customer) => customer.id === id)?.name || 'Unknown customer'
  const downloadBackup = () => {
    if (authUser?.role !== 'admin') return flash('Administrator role required to download a complete register backup.')
    const blob = new Blob([createBackup(localStorage, STORAGE_KEYS)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ppms-backup-${today}.json`
    link.click()
    URL.revokeObjectURL(url)
    flash('PPMS backup downloaded.')
  }
  const uploadBackup = (file: File) => {
    file.text().then(async (backup) => {
      const registerData = parseBackup(backup, STORAGE_KEYS.map((key) => key.slice('ppms-'.length)))
      const token = localStorage.getItem('ppms-session-token')
      if (token) {
        await apiRequest('/api/system/restore-registers', { method: 'POST', body: JSON.stringify({ backup }) })
        for (const [key, value] of Object.entries(registerData)) writeStored(localStorage, `ppms-${key}`, value)
        window.location.reload()
        return
      }
      restoreBackup(localStorage, backup, STORAGE_KEYS)
      flash('Register backup restored successfully.')
      window.setTimeout(() => window.location.reload(), 400)
    }).catch((error: Error) => flash(error.message || 'Backup restore failed. Select a valid PPMS backup file.'))
  }
  const resetRegisterData = async () => {
    if (!window.confirm('This permanently clears all business register data while keeping user accounts. A verified safety backup will be created first.')) return
    if (window.prompt('Type RESET ALL REGISTER DATA to confirm:') !== 'RESET ALL REGISTER DATA') return
    try {
      const result = await apiRequest<{ safetyBackup: string }>('/api/system/reset-registers', { method: 'POST', body: JSON.stringify({ confirmation: 'RESET ALL REGISTER DATA' }) })
      flash(`Register data reset. Safety backup: ${result.safetyBackup}`)
      window.setTimeout(() => window.location.reload(), 500)
    } catch (error) {
      flash((error as Error).message)
    }
  }
  const deleteSale = async (sale: Sale) => {
    if (!window.confirm(`Delete the ${sale.product} sale from ${displayDate(sale.date)} for ${printMoney(sale.amount)}? This cannot be undone.`)) return
    try {
      await apiRequest(`/api/sales/${encodeURIComponent(String(sale.id))}`, { method: 'DELETE' })
      window.location.reload()
    } catch (error) {
      flash((error as Error).message)
    }
  }
  const deleteCustomer = async (customer: Customer) => {
    if (!window.confirm(`Delete customer ${customer.name}? Customers with outstanding balances or linked history cannot be deleted.`)) return
    try {
      await apiRequest(`/api/customers/${encodeURIComponent(String(customer.id))}`, { method: 'DELETE' })
      window.location.reload()
    } catch (error) {
      flash((error as Error).message)
    }
  }
  const login = (username: string, password: string) => {
    apiRequest<{ token: string; user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }).then((payload) => {
      localStorage.setItem('ppms-session-token', payload.token)
      localStorage.setItem('ppms-session-user', JSON.stringify(payload.user))
      setAuthUser(payload.user)
      setAuthError('')
    }).catch((error: Error) => setAuthError(error.message))
  }
  const logout = () => {
    if (localStorage.getItem('ppms-session-token')) apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    localStorage.removeItem('ppms-session-token')
    localStorage.removeItem('ppms-session-user')
    setAuthUser(null)
  }
  const handleChangePassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setChangePasswordError('')
    if (!changePasswordNew) { setChangePasswordError('Please enter a new password.'); return }
    if (changePasswordNew.length < 8) { setChangePasswordError('Password does not meet the required security requirements.'); return }
    if (changePasswordNew !== changePasswordConfirm) { setChangePasswordError('New passwords do not match.'); return }
    if (changePasswordNew === changePasswordOld) { setChangePasswordError('New password must be different from the current password.'); return }
    apiRequest('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: changePasswordOld, newPassword: changePasswordNew, confirmPassword: changePasswordConfirm }) }).then(() => {
      setChangePasswordSuccess(true)
      setTimeout(() => {
        if (localStorage.getItem('ppms-session-token')) apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
        localStorage.removeItem('ppms-session-token')
        localStorage.removeItem('ppms-session-user')
        setAuthUser(null)
        setShowChangePassword(false)
        setChangePasswordOld('')
        setChangePasswordNew('')
        setChangePasswordConfirm('')
        setChangePasswordSuccess(false)
        setChangePasswordError('')
      }, 1500)
    }).catch((error: Error) => setChangePasswordError(error.message))
  }
  const handleChangeUsername = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setChangeUsernameError('')
    const username = changeUsername.trim()
    if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) { setChangeUsernameError('Username must be 3-50 characters and may contain letters, numbers, dots, underscores, or hyphens.'); return }
    apiRequest<{ username: string }>('/api/auth/change-username', { method: 'POST', body: JSON.stringify({ username, currentPassword: changeUsernamePassword }) }).then((payload) => {
      const updatedUser = authUser ? { ...authUser, username: payload.username } : null
      setAuthUser(updatedUser)
      if (updatedUser) localStorage.setItem('ppms-session-user', JSON.stringify(updatedUser))
      setShowChangeUsername(false)
      setChangeUsername('')
      setChangeUsernamePassword('')
      flash('Username changed successfully.')
    }).catch((error: Error) => setChangeUsernameError(error.message))
  }
  const loadUsers = () => { if (authUser?.role === 'admin') apiRequest<{ users: SessionUser[] }>('/api/users').then((payload) => setUsers(payload.users)).catch(() => undefined) }
  const saveUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    apiRequest('/api/users', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password'), role: data.get('role') }) }).then(() => { event.currentTarget.reset(); loadUsers(); flash('User account created.') }).catch((error: Error) => flash(error.message))
  }
  const reportRange = useMemo(() => getDashboardDateRange(reportPeriod, reportCustomFrom, reportCustomTo, currentSystemDate), [currentSystemDate, reportCustomFrom, reportCustomTo, reportPeriod])
  const testsForMeter = (meter: MeterReading) => getMeterTestsForReading(meterTests, meter)
  const meterPeriodSummary = (meter: MeterReading) => calculateMeterPeriodSummary({ physicalMovement: meter.litres, rate: meter.rate || 0, tests: testsForMeter(meter) })
  const meterSales = useMemo<Sale[]>(() => meters.filter((meter) => meter.product === 'XTRON' && meter.rate !== undefined).map((meter) => {
    const summary = calculateMeterPeriodSummary({ physicalMovement: meter.litres, rate: meter.rate || 0, tests: getMeterTestsForReading(meterTests, meter) })
    return { id: -meter.id, date: meter.date, product: meter.product, litres: summary.actualCustomerSales, rate: meter.rate || 0, amount: summary.customerSalesAmount, mode: 'Cash', customer: '-', discountAmount: 0 }
  }), [meterTests, meters])
  const fuelSales = useMemo(() => [...sales, ...meterSales], [meterSales, sales])
  const eligibleLitresFor = (date: string, product: Product, excludeId?: number) => fuelSales.filter((sale) => sale.date === date && sale.product === product).reduce((sum, sale) => sum + sale.litres, 0)
  const commissionedLitresFor = (date: string, product: Product, excludeId?: number) => commissionRecords.filter((record) => record.id !== excludeId && record.date === date && record.product === product).reduce((sum, record) => sum + record.commissionableLitres, 0)
  const remainingEligibleLitresFor = (date: string, product: Product, excludeId?: number) => Math.max(0, eligibleLitresFor(date, product, excludeId) - commissionedLitresFor(date, product, excludeId))
  const commissionRangeRecords = commissionRecords.filter((record) => record.date >= reportRange.from && record.date <= reportRange.to)
  const commissionAmountForRange = getCommissionTotal({ startDate: reportRange.from, endDate: reportRange.to, records: commissionRecords })
  const commissionLitresForRange = commissionRangeRecords.reduce((sum, record) => sum + record.commissionableLitres, 0)
  const eligibleCommissionLitresForRange = products.reduce((sum, product) => sum + fuelSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to && sale.product === product).reduce((productSum, sale) => productSum + sale.litres, 0), 0)
  const commissionDatePreview = remainingEligibleLitresFor(commissionPreviewDate, commissionPreviewProduct)
  const filteredSales = fuelSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to)
  const filteredMeters = meters.filter((meter) => meter.date >= reportRange.from && meter.date <= reportRange.to)
  const filteredMeterTests = meterTests.filter((test) => normalizeLocalCalendarDate(test.date) >= reportRange.from && normalizeLocalCalendarDate(test.date) <= reportRange.to)
  const filteredPurchases = purchases.filter((purchase) => purchase.date >= reportRange.from && purchase.date <= reportRange.to)
  const filteredExpenses = expenses.filter((expense) => expense.date >= reportRange.from && expense.date <= reportRange.to && expense.category !== 'Commission')
  const filteredUdhar = udhar.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to)
  const visiblePurchases = purchases.filter((entry) => `${entry.date} ${entry.product} ${entry.supplier}`.toLowerCase().includes(recordSearch.toLowerCase()))
  const visibleSales = fuelSales.filter((sale) => `${sale.date} ${sale.product} ${sale.mode} ${sale.customer}`.toLowerCase().includes(recordSearch.toLowerCase()))
  const visibleExpenses = expenses.filter((expense) => `${expense.date} ${expense.category} ${expense.description} ${expense.paidBy}`.toLowerCase().includes(recordSearch.toLowerCase()))
  const exportCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`
    const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
    flash(`${filename} downloaded.`)
  }

  const dashboardRange = useMemo(() => getDashboardDateRange(dashboardPeriod, dashboardCustomFrom, dashboardCustomTo, currentSystemDate), [currentSystemDate, dashboardCustomFrom, dashboardCustomTo, dashboardPeriod])
  const dashboardSummary = useMemo(
    () => getDashboardSummary({ startDate: dashboardRange.from, endDate: dashboardRange.to, sales: fuelSales, expenses, udhar, otherSales: oilSales, customers, commission: commissionRecords }),
    [commissionRecords, customers, dashboardRange, expenses, fuelSales, oilSales, udhar],
  )
  const dailySales = fuelSales.filter((sale) => sale.date === currentSystemDate)
  const dailyExpenses = expenses.filter((expense) => expense.date === currentSystemDate && expense.category !== 'Commission')
  const dailyCustomerPayments = udhar.filter((entry) => entry.date === currentSystemDate && entry.type === 'Payment Received').reduce((sum, entry) => sum + entry.credit, 0)
  const dailyCommission = getCommissionTotal({ startDate: currentSystemDate, endDate: currentSystemDate, records: commissionRecords })
  const dailyMeterReadings = meters.filter((meter) => normalizeLocalCalendarDate(meter.date) === currentSystemDate)
  const dailyMeterTests = meterTests.filter((test) => normalizeLocalCalendarDate(test.date) === currentSystemDate)
  const dailyPhysicalMeterMovement = dailyMeterReadings.reduce((sum, meter) => sum + meter.litres, 0)
  const dailyTestQuantity = dailyMeterTests.reduce((sum, test) => sum + test.quantity, 0)
  const dailyMeterCustomerMovement = dailyMeterReadings.reduce((sum, meter) => sum + meterPeriodSummary(meter).actualCustomerSales, 0)
  const dailyNetTestStockImpact = dailyMeterTests.filter((test) => !test.returnedToTank).reduce((sum, test) => sum + test.quantity, 0)
  const previousMeterReading = findPreviousMeterReading(meters, {
    date: meterDraft.date,
    shift: meterDraft.shift,
    product: meterDraft.product,
    nozzle: meterDraft.nozzle,
    excludeId: editingMeter?.id,
  })
  const meterOpening = previousMeterReading ? previousMeterReading.present : Number(meterDraft.previous)
  const meterClosing = Number(meterDraft.present)
  const meterDraftLitres = meterDraft.present && (previousMeterReading || meterDraft.previous !== '') && Number.isFinite(meterOpening) && Number.isFinite(meterClosing) && meterClosing >= meterOpening ? meterClosing - meterOpening : 0
  const meterDraftAmount = meterDraftLitres * (Number(meterDraft.rate) || 0)

  const safetySummaryRange = useMemo(() => {
    if (safetySummaryPeriod === 'Today') return { from: currentSystemDate, to: currentSystemDate }
    if (safetySummaryPeriod === 'This Week') return getDashboardDateRange('This Week', '', '', currentSystemDate)
    if (safetySummaryPeriod === 'Previous Week') {
      const thisWeek = getDashboardDateRange('This Week', '', '', currentSystemDate)
      const previousWeekEnd = new Date(`${thisWeek.from}T00:00:00`)
      previousWeekEnd.setDate(previousWeekEnd.getDate() - 1)
      const previousWeekDate = `${previousWeekEnd.getFullYear()}-${String(previousWeekEnd.getMonth() + 1).padStart(2, '0')}-${String(previousWeekEnd.getDate()).padStart(2, '0')}`
      return getDashboardDateRange('This Week', '', '', previousWeekDate)
    }
    return { from: safetySummaryFrom || currentSystemDate, to: safetySummaryTo || currentSystemDate }
  }, [currentSystemDate, safetySummaryFrom, safetySummaryPeriod, safetySummaryTo])
  const safetySummaryRecords = selectedSafetyProduct ? meters.filter((meter) => meter.product === selectedSafetyProduct && meter.date >= safetySummaryRange.from && meter.date <= safetySummaryRange.to) : []
  const safetyDailyRows = Array.from(new Set(safetySummaryRecords.map((meter) => meter.date))).sort((a, b) => b.localeCompare(a)).map((date) => {
    const records = safetySummaryRecords.filter((meter) => meter.date === date)
    return { date, opening: Math.min(...records.map((meter) => meter.previous)), closing: Math.max(...records.map((meter) => meter.present)), litres: records.reduce((sum, meter) => sum + meter.litres, 0), entries: records.length }
  })
  const safetyWeeklyRows = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => {
    const records = safetySummaryRecords.filter((meter) => {
      const date = new Date(`${meter.date}T00:00:00`)
      const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1
      return dayIndex === index
    })
    return { day, litres: records.reduce((sum, meter) => sum + meter.litres, 0), entries: records.length }
  })
  const safetyTotalLitres = safetySummaryRecords.reduce((sum, meter) => sum + meter.litres, 0)
  const safetyAverageDaily = safetyDailyRows.length ? safetyTotalLitres / safetyDailyRows.length : 0

  const fuelStockRows = useMemo(() => {
    return products.map((product) => {
      const opening = stockOpenings[product] || 0
      const purchased = purchases.filter((entry) => entry.product === product).reduce((sum, entry) => sum + entry.litres, 0)
      const sold = fuelSales.filter((entry) => entry.product === product).reduce((sum, entry) => sum + entry.litres, 0)
      const manualAdjustment = stockAdjustments.filter((entry) => entry.product === product).reduce((sum, entry) => sum + entry.quantity, 0)
      const nonReturnedTestUsage = meterTests.filter((test) => test.product === product && !test.returnedToTank).reduce((sum, test) => sum + test.quantity, 0)
      const adjustment = manualAdjustment - nonReturnedTestUsage
      const result = calculateFuelStockSummary({ product, opening, purchased, sold, adjustment })
      return {
        product,
        opening: result.opening,
        purchased: result.purchased,
        sold: result.sold,
        adjustment: result.adjustment,
        remaining: result.remaining,
      }
    })
  }, [fuelSales, meterTests, purchases, stockAdjustments, stockOpenings])

  const statementEntries = udhar.filter((item) => item.customerId === statementCustomerId && item.date <= statementDate).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const statementBalance = statementEntries.reduce((balance, item) => balance + item.debit - item.credit, 0)
  const paymentCustomer = customers.find((customer) => customer.id === paymentCustomerId)
  const paymentOutstanding = paymentCustomer ? customerBalance(paymentCustomer.id, customers, udhar) : 0
  const selectedCustomerEntries = statementCustomerId ? udhar.filter((item) => item.customerId === statementCustomerId).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id) : []
  const selectedCustomerHistory = (() => {
    let balance = 0
    return selectedCustomerEntries.map((entry) => {
      balance += entry.debit - entry.credit
      return { entry, balance }
    })
  })()
  const activeBankAccounts = bankAccounts.filter((account) => account.active !== false)
  const bankAccountLabel = (account: BankAccount) => `${account.bankName} - ${account.accountName}`
  const brsBankName = (entry: BRSRecord) => {
    const account = bankAccounts.find((item) => item.id === entry.bankAccountId)
    return account ? bankAccountLabel(account) : entry.legacyBankName || 'Unlinked bank'
  }
  const vehicleUsageForMonth = (vehicleId: number, companyId: number, month = fleetMonthFilter) => {
    const vehicle = fleetVehicles.find((item) => item.id === vehicleId && item.customerId === companyId)
    if (!vehicle) return { limit: 0, used: 0, remaining: 0, usagePercent: 0, status: 'Normal', exceeded: 0, month }
    const allocation = fleetAllocations.find((entry) => entry.customerId === companyId && entry.vehicleId === vehicleId && entry.month === month)
    const limit = allocation ? Math.max(0, Number(allocation.monthlyLitresLimit || 0)) : 0
    const used = udhar
      .filter((entry) => entry.customerId === companyId && entry.vehicleId === vehicleId && entry.type === 'Credit Sale' && entry.date.startsWith(month) && Number.isFinite(Number(entry.litres || 0)))
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.litres || 0)), 0)
    return calculateVehicleUsageSummary({ limit, used, month })
  }
  const selectedCompanyFleet = fleetVehicles.filter((vehicle) => vehicle.customerId === fleetCompanyId && vehicle.status !== 'Inactive')
  const fleetCompanySummary = calculateCompanyFleetSummary({
    companyId: fleetCompanyId,
    vehicles: fleetVehicles,
    allocations: fleetAllocations,
    transactions: udhar.filter((entry) => entry.type === 'Credit Sale' && entry.customerId === fleetCompanyId && entry.vehicleId).map((entry) => ({
      customerId: entry.customerId,
      vehicleId: entry.vehicleId || 0,
      date: entry.date,
      type: entry.type,
      litres: entry.litres,
      debit: entry.debit,
      credit: entry.credit,
    })),
    month: fleetMonthFilter,
  })
  const fleetCompanyRows = customers.map((customer) => {
    const summary = calculateCompanyFleetSummary({
      companyId: customer.id,
      vehicles: fleetVehicles,
      allocations: fleetAllocations,
      transactions: udhar.filter((entry) => entry.type === 'Credit Sale' && entry.customerId === customer.id && entry.vehicleId).map((entry) => ({
        customerId: entry.customerId,
        vehicleId: entry.vehicleId || 0,
        date: entry.date,
        type: entry.type,
        litres: entry.litres,
        debit: entry.debit,
        credit: entry.credit,
      })),
      month: fleetMonthFilter,
    })
    return { customer, summary }
  })
  const dashboardFleetCompany = fleetCompanyRows.find(({ customer }) => fleetVehicles.some((vehicle) => vehicle.customerId === customer.id && vehicle.status !== 'Inactive'))
  const dashboardRecentActivity = [
    ...fuelSales.map((sale) => ({ id: `sale-${sale.id}`, date: sale.date, title: sale.mode === 'Credit' ? 'Credit fuel sale' : 'Fuel sale', detail: `${sale.product} · ${sale.litres.toLocaleString()} L · ${sale.customer}`, amount: printMoney(sale.amount) })),
    ...udhar.filter((entry) => entry.type === 'Payment Received').map((entry) => ({ id: `payment-${entry.id}`, date: entry.date, title: 'Customer payment', detail: `${customerName(entry.customerId)} · ${entry.paymentMethod || 'Collection'}`, amount: printMoney(entry.credit) })),
    ...expenses.map((expense) => ({ id: `expense-${expense.id}`, date: expense.date, title: 'Expense', detail: `${expense.category} · ${expense.description}`, amount: printMoney(expense.amount) })),
    ...meters.map((meter) => {
      const summary = meterPeriodSummary(meter)
      return { id: `meter-${meter.id}`, date: meter.date, title: 'Meter reading', detail: `${meter.product} ${meter.nozzle} · ${measurement(summary.physicalMovement)} L physical · ${measurement(summary.actualCustomerSales)} L customer movement`, amount: meter.rate === undefined ? '-' : printMoney(summary.customerSalesAmount) }
    }),
    ...meterTests.map((test) => ({ id: `test-${test.id}`, date: test.date, title: 'Meter test', detail: `${test.product} ${test.nozzle} · ${measurement(test.quantity)} L · ${test.returnedToTank ? 'Returned' : 'Not returned'}`, amount: printMoney(0) })),
  ].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 6)

  const reportOptions = [
    ['Operations', 'Daily Sales'], ['Operations', 'Fuel Sales'], ['Operations', 'Meter Reading'], ['Operations', 'Fuel Stock'], ['Operations', 'Fuel Purchase'], ['Operations', 'Mobile Oil'],
    ['Financial', 'Expenses'], ['Financial', 'Profit & Loss'], ['Financial', 'Customer / Udhar'], ['Financial', 'Bank / BRS'], ['Financial', 'Daily Closing'],
    ['Summary', 'Monthly Summary'], ['Summary', 'Yearly Summary'],
  ]
  const reportFuelRows = products.map((product) => {
    const rows = filteredSales.filter((sale) => sale.product === product)
    return [product, `${rows.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L`, rows.length ? printMoney(rows.reduce((sum, sale) => sum + sale.amount, 0) / rows.length / (rows.reduce((sum, sale) => sum + sale.litres, 0) / rows.length || 1)) : printMoney(0), printMoney(rows.reduce((sum, sale) => sum + sale.amount, 0)), rows.length]
  })
  const meterReportHeaders = ['Date', 'Shift', 'Nozzle', 'Fuel', 'Transaction Type', 'Opening', 'Closing', 'Physical Movement', 'Test Quantity', 'Returned Test Qty', 'Test Stock Impact', 'Actual Customer Sales', 'Rate', 'Amount', 'Reason', 'Reference']
  const meterReportRows = [
    ...filteredMeters.map((meter) => {
      const summary = meterPeriodSummary(meter)
      return [meter.date, meter.shift, meter.nozzle, meter.product, 'Normal Reading', measurement(meter.previous), measurement(meter.present), `${measurement(summary.physicalMovement)} L`, `${measurement(summary.testQuantity)} L`, `${measurement(summary.returnedTestQuantity)} L`, `${measurement(summary.netTestStockImpact)} L`, `${measurement(summary.actualCustomerSales)} L`, meter.rate === undefined ? '-' : printMoney(meter.rate), meter.rate === undefined ? '-' : printMoney(summary.customerSalesAmount), '-', '-']
    }),
    ...filteredMeterTests.map((test) => [test.date, test.shift, test.nozzle, test.product, 'Calibration/Test', '-', '-', `${measurement(test.quantity)} L`, `${measurement(test.quantity)} L`, `${measurement(test.returnedToTank ? test.quantity : 0)} L`, `${measurement(test.returnedToTank ? 0 : test.quantity)} L`, '0.00 L', '-', printMoney(0), test.reason || '-', test.reference || '-']),
  ]
  const monthlySummaryRows = Array.from(new Set([...filteredSales.map((sale) => sale.date.slice(0, 7)), ...filteredPurchases.map((purchase) => purchase.date.slice(0, 7)), ...filteredExpenses.map((expense) => expense.date.slice(0, 7)), ...commissionRangeRecords.map((record) => record.date.slice(0, 7))])).sort().map((month) => {
    const salesTotal = filteredSales.filter((sale) => sale.date.startsWith(month)).reduce((sum, sale) => sum + sale.amount, 0)
    const litresTotal = filteredSales.filter((sale) => sale.date.startsWith(month)).reduce((sum, sale) => sum + sale.litres, 0)
    const purchasesTotal = filteredPurchases.filter((purchase) => purchase.date.startsWith(month)).reduce((sum, purchase) => sum + purchase.amount, 0)
    const expensesTotal = filteredExpenses.filter((expense) => expense.date.startsWith(month)).reduce((sum, expense) => sum + expense.amount, 0)
    const commissionTotal = commissionRangeRecords.filter((record) => record.date.startsWith(month)).reduce((sum, record) => sum + record.amount, 0)
    return [month, printMoney(salesTotal), `${litresTotal.toLocaleString()} L`, printMoney(purchasesTotal), printMoney(expensesTotal), printMoney(commissionTotal), printMoney(salesTotal - purchasesTotal - expensesTotal - commissionTotal)]
  })
  const reportData = (() => {
    const reportPeriodLabel = `${displayDate(reportRange.from)} - ${displayDate(reportRange.to)}`
    const totalSales = filteredSales.reduce((sum, sale) => sum + sale.amount, 0)
    const totalLitres = filteredSales.reduce((sum, sale) => sum + sale.litres, 0)
    const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    const totalCommission = commissionAmountForRange
    const operatingExpenses = totalExpenses + totalCommission
    if (selectedReport === 'Fuel Sales') return { title: 'Fuel Sales Report', description: 'Fuel performance by product for the selected period.', headers: ['Fuel Type', 'Total Litres', 'Average Rate', 'Total Sales', 'Transactions'], rows: reportFuelRows, summary: [['Total Sales', printMoney(totalSales)], ['Total Litres', `${totalLitres.toLocaleString()} L`]] as [string, string][] }
    if (selectedReport === 'Meter Reading') return { title: 'Meter Reading Report', description: 'Physical nozzle movement, calibration tests, actual meter sales movement, and test stock impact.', headers: meterReportHeaders, rows: meterReportRows, summary: [['Physical Meter Movement', `${filteredMeters.reduce((sum, meter) => sum + meter.litres, 0).toLocaleString()} L`], ['Calibration / Test Quantity', `${filteredMeterTests.reduce((sum, test) => sum + test.quantity, 0).toLocaleString()} L`], ['Actual Meter Customer Movement', `${filteredMeters.reduce((sum, meter) => sum + meterPeriodSummary(meter).actualCustomerSales, 0).toLocaleString()} L`], ['Non-returned Test Stock Impact', `${filteredMeterTests.filter((test) => !test.returnedToTank).reduce((sum, test) => sum + test.quantity, 0).toLocaleString()} L`], ['Calibration Sales Amount', printMoney(0)]] as [string, string][] }
    if (selectedReport === 'Fuel Stock') return { title: 'Fuel Stock Report', description: 'Opening stock, movement, adjustments, and calculated closing stock.', headers: ['Fuel', 'Opening', 'Purchases', 'Sales', 'Adjustments', 'Closing Stock'], rows: fuelStockRows.map((row) => [row.product, `${row.opening.toLocaleString()} L`, `${row.purchased.toLocaleString()} L`, `${row.sold.toLocaleString()} L`, `${row.adjustment.toLocaleString()} L`, `${row.remaining.toLocaleString()} L`]) }
    if (selectedReport === 'Fuel Purchase') return { title: 'Fuel Purchase Report', description: 'Fuel received from suppliers during the selected period.', headers: ['Date', 'Supplier', 'Fuel', 'Litres', 'Rate', 'Amount'], rows: filteredPurchases.map((purchase) => [purchase.date, purchase.supplier, purchase.product, purchase.litres, printMoney(purchase.rate), printMoney(purchase.amount)]), summary: [['Total Purchased', `${filteredPurchases.reduce((sum, purchase) => sum + purchase.litres, 0).toLocaleString()} L`], ['Total Amount', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))]] as [string, string][] }
    if (selectedReport === 'Expenses') return { title: 'Expense Report', description: 'Operating expenses recorded during the selected period.', headers: ['Category', 'Transactions', 'Total Amount'], rows: [['Salaries', filteredExpenses.filter((expense) => expense.category === 'Salary').length, printMoney(filteredExpenses.filter((expense) => expense.category === 'Salary').reduce((sum, expense) => sum + expense.amount, 0))], ['Electricity', filteredExpenses.filter((expense) => expense.category === 'Electricity').length, printMoney(filteredExpenses.filter((expense) => expense.category === 'Electricity').reduce((sum, expense) => sum + expense.amount, 0))], ['Pump Expenses', filteredExpenses.filter((expense) => expense.category === 'Pump Expenses').length, printMoney(filteredExpenses.filter((expense) => expense.category === 'Pump Expenses').reduce((sum, expense) => sum + expense.amount, 0))], ['Commission', commissionRangeRecords.length, printMoney(totalCommission)], ['Other Expenses', filteredExpenses.filter((expense) => !['Salary', 'Electricity', 'Pump Expenses'].includes(expense.category)).length, printMoney(filteredExpenses.filter((expense) => !['Salary', 'Electricity', 'Pump Expenses'].includes(expense.category)).reduce((sum, expense) => sum + expense.amount, 0))]], summary: [['Total Operating Expenses', printMoney(operatingExpenses)]] as [string, string][] }
    if (selectedReport === 'Profit & Loss') return { title: 'Profit & Loss Report', description: 'Revenue, cost of goods, and operating result.', headers: ['Section', 'Amount'], rows: [['Fuel Sales', printMoney(totalSales)], ['Mobile Oil Sales', printMoney(oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).reduce((sum, sale) => sum + sale.amount, 0))], ['Fuel Purchases / Cost', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))], ['Gross Profit', printMoney(totalSales - filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))], ['Commission', printMoney(totalCommission)], ['Other Operating Expenses', printMoney(totalExpenses)], ['Net Profit / Result', printMoney(totalSales - filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0) - operatingExpenses)]] }
    if (selectedReport === 'Customer / Udhar') return { title: 'Customer / Udhar Report', description: 'Credit sales, collections, and outstanding balances.', headers: ['Customer', 'Credit Sales', 'Collections', 'Outstanding'], rows: customers.map((customer) => { const credit = filteredUdhar.filter((entry) => entry.customerId === customer.id && entry.type === 'Credit Sale').reduce((sum, entry) => sum + entry.debit, 0); const collections = filteredUdhar.filter((entry) => entry.customerId === customer.id && entry.type === 'Payment Received').reduce((sum, entry) => sum + entry.credit, 0); return [customer.name, printMoney(credit), printMoney(collections), printMoney(credit - collections)] }), summary: [['Credit Sales', printMoney(filteredUdhar.filter((entry) => entry.type === 'Credit Sale').reduce((sum, entry) => sum + entry.debit, 0))], ['Collections', printMoney(filteredUdhar.filter((entry) => entry.type === 'Payment Received').reduce((sum, entry) => sum + entry.credit, 0))]] as [string, string][] }
    if (selectedReport === 'Bank / BRS') return { title: 'Bank Reconciliation Statement', description: 'Bank transactions and reconciliation differences.', headers: ['Date', 'Bank', 'Type', 'Reference', 'PPMS Amount', 'Bank Amount', 'Difference', 'Status'], rows: brsRecords.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to).map((entry) => [entry.date, brsBankName(entry), entry.type, entry.reference, printMoney(entry.amount), printMoney(entry.bankAmount || 0), printMoney(entry.difference ?? entry.amount - (entry.bankAmount || 0)), entry.status]) }
    if (selectedReport === 'Mobile Oil') return { title: 'Mobile Oil Report', description: 'Mobile oil sales recorded during the selected period.', headers: ['Date', 'Item', 'Quantity', 'Rate', 'Amount'], rows: oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).map((sale) => [sale.date, sale.item, sale.quantity, printMoney(sale.rate), printMoney(sale.amount)]), summary: [['Total Revenue', printMoney(oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).reduce((sum, sale) => sum + sale.amount, 0))]] as [string, string][] }
    if (selectedReport === 'Daily Closing') { const collections = filteredUdhar.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0); return { title: 'Daily Closing Report', description: 'Daily operational and financial closing summary.', headers: ['Metric', 'Value'], rows: [['Fuel Sales', printMoney(totalSales)], ['Fuel Litres', `${totalLitres.toLocaleString()} L`], ['Physical Meter Movement', `${filteredMeters.reduce((sum, meter) => sum + meter.litres, 0).toLocaleString()} L`], ['Meter Test / Calibration', `${filteredMeterTests.reduce((sum, test) => sum + test.quantity, 0).toLocaleString()} L`], ['Actual Meter Customer Movement', `${filteredMeters.reduce((sum, meter) => sum + meterPeriodSummary(meter).actualCustomerSales, 0).toLocaleString()} L`], ['Non-returned Test Stock Impact', `${filteredMeterTests.filter((test) => !test.returnedToTank).reduce((sum, test) => sum + test.quantity, 0).toLocaleString()} L`], ['Customer Udhar Collections', printMoney(collections)], ['Expenses', printMoney(totalExpenses)], ['Commission', printMoney(totalCommission)], ['Net Result', printMoney(totalSales + collections - operatingExpenses)]] } }
    if (selectedReport === 'Monthly Summary' || selectedReport === 'Yearly Summary') return { title: selectedReport, description: 'Period performance summarized by month.', headers: ['Month', 'Sales', 'Litres', 'Purchases', 'Expenses', 'Commission', 'Net Result'], rows: monthlySummaryRows, summary: [['Total Sales', printMoney(totalSales)], ['Total Purchases', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))], ['Total Expenses', printMoney(operatingExpenses)], ['Net Result', printMoney(totalSales - filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0) - operatingExpenses)]] as [string, string][] }
    return { title: 'Daily Sales Report', description: 'Business sales and fuel performance for the selected period.', headers: ['Date', 'Fuel Type', 'Litres', 'Rate', 'Sales Amount', 'Payment Type'], rows: filteredSales.map((sale) => [sale.date, sale.product, sale.litres, printMoney(sale.rate), printMoney(sale.amount), sale.mode]), summary: [['Total Sales', printMoney(totalSales)], ['Total Litres', `${totalLitres.toLocaleString()} L`], ...products.map((product) => [`${product} Sales`, printMoney(filteredSales.filter((sale) => sale.product === product).reduce((sum, sale) => sum + sale.amount, 0))]), ['Cash Sales', printMoney(filteredSales.filter((sale) => sale.mode === 'Cash').reduce((sum, sale) => sum + sale.amount, 0))], ['Credit / Udhar Sales', printMoney(filteredSales.filter((sale) => sale.mode === 'Credit').reduce((sum, sale) => sum + sale.amount, 0))]] as [string, string][] }
  })()

  const printableReport = (() => {
    const period = selectedTab === 'Dashboard' ? `${displayDate(dashboardRange.from)} - ${displayDate(dashboardRange.to)}` : `${displayDate(reportRange.from)} - ${displayDate(reportRange.to)}`
    if (selectedTab === 'Reports') return { title: reportData.title, period, headers: reportData.headers, rows: reportData.rows, summary: reportData.summary }
    if (printRequest?.title === 'Bank Reconciliation Statement') return { title: printRequest.title, period, headers: ['Date', 'Bank Account', 'Type', 'Reference', 'Description', 'PPMS Amount', 'Bank Amount', 'Difference', 'Status'], rows: brsRecords.map((entry) => [entry.date, brsBankName(entry), entry.type, entry.reference, entry.description, printMoney(entry.amount), printMoney(entry.bankAmount || 0), printMoney(entry.difference ?? entry.amount - (entry.bankAmount || 0)), entry.status]), summary: [['Total PPMS Amount', printMoney(brsRecords.reduce((sum, entry) => sum + entry.amount, 0))], ['Total Bank Amount', printMoney(brsRecords.reduce((sum, entry) => sum + (entry.bankAmount || 0), 0))], ['Total Difference', printMoney(brsRecords.reduce((sum, entry) => sum + (entry.difference ?? entry.amount - (entry.bankAmount || 0)), 0))]] as [string, string][] }
    if (selectedTab === 'Meter Reading') return { title: 'Daily Meter Reading Register', period, headers: meterReportHeaders, rows: meterReportRows, summary: [['Physical Meter Movement', `${filteredMeters.reduce((sum, meter) => sum + meter.litres, 0).toLocaleString()} L`], ['Calibration / Test Quantity', `${filteredMeterTests.reduce((sum, test) => sum + test.quantity, 0).toLocaleString()} L`], ['Actual Meter Customer Movement', `${filteredMeters.reduce((sum, meter) => sum + meterPeriodSummary(meter).actualCustomerSales, 0).toLocaleString()} L`], ['Non-returned Test Stock Impact', `${filteredMeterTests.filter((test) => !test.returnedToTank).reduce((sum, test) => sum + test.quantity, 0).toLocaleString()} L`], ['Calibration Sales Amount', printMoney(0)]] as [string, string][] }
    if (selectedTab === 'Fuel Management') return { title: 'Fuel Purchase & Stock Report', period, headers: ['Fuel', 'Opening', 'Purchases', 'Sales', 'Adjustments', 'Closing Stock'], rows: fuelStockRows.map((row) => [row.product, row.opening, row.purchased, row.sold, row.adjustment, row.remaining]) }
    if (selectedTab === 'Sales') return { title: 'Fuel Sales Report', period, headers: ['Date', 'Fuel', 'Litres', 'Rate', 'Amount', 'Payment Type', 'Customer'], rows: filteredSales.map((sale) => [sale.date, sale.product, sale.litres, printMoney(sale.rate), printMoney(sale.amount), sale.mode, sale.customer]), summary: [['Total Sales', printMoney(filteredSales.reduce((sum, sale) => sum + sale.amount, 0))], ['Total Litres', `${filteredSales.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L`]] as [string, string][] }
    if (selectedTab === 'Expenses') return { title: 'Daily Expense Report', period, headers: ['Date', 'Category', 'Description', 'Amount', 'Paid By'], rows: filteredExpenses.map((expense) => [expense.date, expense.category, expense.description, printMoney(expense.amount), expense.paidBy]), summary: [['Total Expenses', printMoney(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0))]] as [string, string][] }
    if (selectedTab === 'Mobile Oil') return { title: 'Mobile Oil Sales Report', period, headers: ['Date', 'Item', 'Quantity', 'Rate', 'Amount'], rows: oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).map((sale) => [sale.date, sale.item, sale.quantity, printMoney(sale.rate), printMoney(sale.amount)]) }
    if (selectedTab === 'Commission') return { title: 'Commission Report', period, headers: ['Date', 'Fuel', 'Eligible Litres', 'Commissionable Litres', 'Rate / Litre', 'Commission'], rows: commissionRangeRecords.map((record) => [record.date, record.product, `${record.eligibleLitres.toLocaleString()} L`, `${record.commissionableLitres.toLocaleString()} L`, printMoney(record.rate), printMoney(record.amount)]), summary: [['Total Eligible Litres', `${eligibleCommissionLitresForRange.toLocaleString()} L`], ['Total Commissionable Litres', `${commissionLitresForRange.toLocaleString()} L`], ['Remaining Eligible Litres', `${Math.max(0, eligibleCommissionLitresForRange - commissionLitresForRange).toLocaleString()} L`], ['Total Commission', printMoney(commissionAmountForRange)]] as [string, string][] }
    if (selectedTab === 'Safety Duty') return { title: 'Safety Duty Register', period, headers: ['Nozzle', 'Fuel', 'Opening', 'Closing', 'Total Litres'], rows: meters.map((meter) => [meter.nozzle, meter.product, meter.previous, meter.present, meter.litres]) }
    if (selectedTab === 'Customers') return { title: 'Customer Ledger / Customer Statement', period: displayDate(statementDate), headers: ['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Description'], rows: statementEntries.map((entry) => [entry.date, entry.type, entry.reference, printMoney(entry.debit), printMoney(entry.credit), entry.description]), summary: [['Closing Balance', printMoney(statementBalance)]] as [string, string][] }
    if (selectedTab === 'Reports' || selectedTab === 'Accounting') return { title: selectedTab === 'Accounting' ? 'Accounting / Cash Book Report' : 'Monthly Financial & Operations Report', period, headers: ['Ledger', 'Total', 'Notes'], rows: [['Fuel Sales', printMoney(filteredSales.reduce((sum, sale) => sum + sale.amount, 0)), 'Gross fuel revenue'], ['Fuel Purchases', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0)), 'Stock procurement'], ['Expenses', printMoney(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)), 'Operating costs'], ['Commission', printMoney(commissionAmountForRange), 'Recorded commission expense']] }
    if (selectedTab === 'Daily Operations') return { title: 'Daily Closing Report', period: displayDate(currentSystemDate), headers: ['Metric', 'Value'], rows: [['Fuel Sales', printMoney(dailySales.reduce((sum, sale) => sum + sale.amount, 0))], ['Fuel Litres', `${dailySales.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L`], ['Physical Meter Movement', `${dailyPhysicalMeterMovement.toLocaleString()} L`], ['Meter Test / Calibration', `${dailyTestQuantity.toLocaleString()} L`], ['Actual Meter Customer Movement', `${dailyMeterCustomerMovement.toLocaleString()} L`], ['Non-returned Test Stock Impact', `${dailyNetTestStockImpact.toLocaleString()} L`], ['Customer Udhar Collections', printMoney(dailyCustomerPayments)], ['Expenses', printMoney(dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0))], ['Commission', printMoney(dailyCommission)], ['Net Result', printMoney(dailySales.reduce((sum, sale) => sum + sale.amount, 0) + dailyCustomerPayments - dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0) - dailyCommission)]] }
    return { title: 'Daily Dashboard Summary', period, headers: ['Metric', 'Value'], rows: [['Fuel Sales', printMoney(dashboardSummary.totalSales)], ['Fuel Litres Sold', `${dashboardSummary.totalFuelLitres.toLocaleString()} L`], ...products.map((product) => [product, printMoney(dashboardSummary.productTotals[product]?.amount || 0)]), ['Expenses', printMoney(dashboardSummary.operatingExpenses)], ['Sales Less Expenses', printMoney(dashboardSummary.netSales)]] }
  })()

  const saveMeterTest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const date = normalizeLocalCalendarDate(meterTestDraft.date)
    const quantity = Number(meterTestDraft.quantity)
    const product = meterTestDraft.product
    const nozzle = meterTestDraft.nozzle
    if (!date) return flash('Please select a valid meter test date.')
    if (!products.includes(product) || !productNozzles[product].includes(nozzle)) return flash('Select a valid fuel type and nozzle combination.')
    if (!['Day', 'Night'].includes(meterTestDraft.shift)) return flash('Select the meter-reading shift for this test.')
    if (meterTestDraft.quantity.trim() === '' || !Number.isFinite(quantity) || quantity <= 0) return flash('Test quantity must be a valid number greater than zero.')
    if (!['Yes', 'No'].includes(meterTestDraft.returnedToTank)) return flash('Select whether the test fuel was returned to the tank.')
    const entry: MeterTestEntry = {
      id: editingMeterTest?.id || Date.now(),
      date,
      shift: meterTestDraft.shift,
      product,
      nozzle,
      quantity,
      returnedToTank: meterTestDraft.returnedToTank === 'Yes',
      reason: meterTestDraft.reason.trim(),
      reference: meterTestDraft.reference.trim(),
      notes: meterTestDraft.notes.trim(),
    }
    setMeterTests((current) => editingMeterTest
      ? current.map((test) => test.id === editingMeterTest.id ? entry : test)
      : [entry, ...current])
    setEditingMeterTest(null)
    setMeterTestDraft({ date: today, shift: '', product: 'HSD', nozzle: 'HSD-1', quantity: '', reason: '', returnedToTank: '', reference: '', notes: '' })
    flash(editingMeterTest
      ? 'Meter test updated successfully.'
      : `Meter test recorded successfully. ${quantity.toLocaleString()} L excluded from customer sales. ${entry.returnedToTank ? `${quantity.toLocaleString()} L returned to tank. No net stock reduction.` : `${quantity.toLocaleString()} L recorded as operational test usage.`}`)
  }

  const editMeterTest = (test: MeterTestEntry) => {
    setEditingMeterTest(test)
    setMeterTestDraft({ date: test.date, shift: test.shift, product: test.product as Product, nozzle: test.nozzle, quantity: String(test.quantity), reason: test.reason, returnedToTank: test.returnedToTank ? 'Yes' : 'No', reference: test.reference || '', notes: test.notes })
  }

  const deleteMeterTest = (test: MeterTestEntry) => {
    if (!window.confirm(`Delete this ${test.quantity.toLocaleString()} L meter test? Sales and stock summaries will recalculate.`)) return
    setMeterTests((current) => current.filter((entry) => entry.id !== test.id))
    if (editingMeterTest?.id === test.id) {
      setEditingMeterTest(null)
      setMeterTestDraft({ date: today, shift: '', product: 'HSD', nozzle: 'HSD-1', quantity: '', reason: '', returnedToTank: '', reference: '', notes: '' })
    }
    flash('Meter test deleted. Meter sales and stock summaries recalculated.')
  }

  const saveMeter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const { date, shift, product, nozzle } = meterDraft
    const normalizedDate = normalizeLocalCalendarDate(date)
    const present = Number(meterDraft.present)
    const rate = Number(meterDraft.rate)
    const previous = previousMeterReading ? previousMeterReading.present : Number(meterDraft.previous)
    if (!normalizedDate) return flash('Please select a valid meter reading date.')
    if (!product || !nozzle || !productNozzles[product].includes(nozzle)) return flash('Select a valid fuel type and nozzle combination.')
    if (meterDraft.previous.trim() === '' && !previousMeterReading) return flash('Please enter an opening meter reading for this first reading.')
    if (!Number.isFinite(previous) || previous < 0) return flash('Please enter a valid opening meter reading.')
    if (meterDraft.present.trim() === '' || !Number.isFinite(present) || present < 0) return flash('Please enter a valid closing meter reading.')
    if (meterDraft.rate.trim() === '' || !Number.isFinite(rate) || rate < 0) return flash('Please enter a valid rate per litre.')
    if (present < previous) return flash('Closing meter reading cannot be less than opening meter reading.')
    if (meters.some((meter) => meter.id !== editingMeter?.id && normalizeLocalCalendarDate(meter.date) === normalizedDate && meter.shift === shift && meter.product === product && meter.nozzle === nozzle)) return flash(`A reading already exists for ${nozzle} on this date and shift.`)
    const litres = calculateMeterTotal(present, previous)
    const entry: MeterReading = { id: editingMeter?.id || Date.now(), date: normalizedDate, shift, nozzle, product, previous, present, litres, rate, amount: litres * rate }
    const changedReadings = editingMeter
      ? meters.map((meter) => meter.id === editingMeter.id ? entry : meter)
      : [...meters, entry]
    let nextReadings: MeterReading[]
    try {
      nextReadings = recalculateMeterReadingChain(changedReadings)
    } catch (error) {
      return flash(error instanceof Error ? error.message : 'Meter readings would form an invalid sequence.')
    }
    setMeters(nextReadings)
    setEditingMeter(null)
    setMeterDraft({ date: today, shift, product, nozzle, previous: '', present: '', rate: '' })
    flash(editingMeter ? 'Meter reading updated successfully.' : 'Meter reading saved.')
  }

  const editMeter = (meter: MeterReading) => {
    setEditingMeter(meter)
    setMeterDraft({ date: meter.date, shift: meter.shift, product: meter.product, nozzle: meter.nozzle, previous: String(meter.previous), present: String(meter.present), rate: String(meter.rate ?? '') })
  }
  const deleteMeter = (meter: MeterReading) => {
    if (!window.confirm('Delete this meter reading? This may affect fuel calculations, reports, and dashboard totals.')) return
    try {
      setMeters(recalculateMeterReadingChain(meters.filter((entry) => entry.id !== meter.id)))
    } catch (error) {
      return flash(error instanceof Error ? error.message : 'The meter chain could not be recalculated.')
    }
    if (editingMeter?.id === meter.id) {
      setEditingMeter(null)
      setMeterDraft({ date: today, shift: 'Day', product: 'HSD', nozzle: 'HSD-1', previous: '', present: '', rate: '' })
    }
    flash('Meter reading deleted successfully.')
  }

  const saveSale = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const mode = String(data.get('mode'))
    const customerId = Number(String(data.get('customerId') || '').split(' - ')[0]) || 0
    const litres = numberValue(data.get('litres'))
    const rate = numberValue(data.get('rate'))
    const product = String(data.get('product')) as Product
    const paymentMethod = (String(data.get('paymentMethod') || 'Cash')) as PaymentMethod
    const grossAmount = litres * rate
    const saleDate = String(data.get('date'))
    const selectedRule = discountRules.filter((rule) => rule.status === 'Active' && rule.effectiveDate <= saleDate).find((rule) => {
      const customerMatches = !rule.customerId || rule.customerId === customerId
      const productMatches = !rule.product || rule.product === product
      return customerMatches && productMatches
    })
    const discountType = selectedRule?.discountType ?? 'percent'
    const discountValue = selectedRule?.discountValue ?? 0
    const discountAmount = discountValue > 0 ? calculateDiscountAmount({ litres, rate, discountType, discountValue }) : 0
    const netAmount = grossAmount - discountAmount
    const paymentFeeSetting = paymentFees.find((setting) => setting.method === paymentMethod && setting.status === 'Active')
    const paymentFee = paymentFeeSetting ? calculatePaymentFee({ amount: netAmount, feePercent: paymentFeeSetting.feePercent }) : 0
    const totalCharged = paymentFeeSetting && !paymentFeeSetting.absorbedByBusiness ? netAmount + paymentFee : netAmount
    const customer = customers.find((item) => item.id === customerId)
    if (mode === 'Credit' && !customer) return flash('Select a customer for a credit sale.')
    const vehicleId = Number(String(data.get('vehicleId') || '0')) || 0
    const vehicle = vehicleId && customer ? fleetVehicles.find((item) => item.id === vehicleId && item.customerId === customer.id) : null
    if (mode === 'Credit' && customer && !vehicle) return flash('Select a valid vehicle for this credit sale.')
    const entry: Sale = {
      id: Date.now(),
      date: saleDate,
      product,
      litres,
      rate,
      amount: grossAmount,
      discount: selectedRule ? discountValue : 0,
      discountAmount,
      netAmount,
      paymentMethod,
      paymentFee,
      totalCharged,
      mode,
      customer: customer?.name || '-',
      customerId: customer?.id,
    }
    setSales((current) => [entry, ...current])
    if (mode === 'Credit' && customer) {
      setUdhar((current) => [{ id: Date.now() + 1, date: entry.date, customerId: customer.id, type: 'Credit Sale', reference: `SALE-${entry.id}`, description: `${entry.product} ${litres.toLocaleString()} litres`, debit: grossAmount, credit: 0, vehicleId: vehicle?.id, fuelType: product, litres }, ...current])
    }
    event.currentTarget.reset()
    setSaleVehicleId(0)
    flash(mode === 'Credit' ? 'Fuel sale and udhar transaction saved.' : 'Fuel sale saved.')
  }

  const saveCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const opening = numberValue(data.get('openingBalance'))
    const entry: Customer = { id: Date.now(), name: String(data.get('name')), phone: String(data.get('phone')), address: String(data.get('address')), openingBalance: opening }
    setCustomers((current) => [entry, ...current])
    if (opening > 0) {
      setUdhar((current) => [{ id: Date.now() + 1, date: String(data.get('date')), customerId: entry.id, type: 'Opening Balance', reference: `OB-${entry.id}`, description: 'Opening balance', debit: opening, credit: 0 }, ...current])
    }
    event.currentTarget.reset()
    flash('Customer master record saved.')
  }

  const saveFleetVehicle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const vehicleNumber = fleetVehicleDraft.vehicleNumber.trim()
    if (!fleetCompanyId || !vehicleNumber) return flash('Select a company and enter a vehicle number.')
    const duplicate = fleetVehicles.some((vehicle) => vehicle.customerId === fleetCompanyId && vehicle.vehicleNumber.trim().toLowerCase() === vehicleNumber.toLowerCase() && vehicle.id !== editingFleetVehicle?.id)
    if (duplicate) return flash('This vehicle number already exists for this company.')
    const stamp = new Date().toISOString()
    const entry: FleetVehicle = {
      id: editingFleetVehicle?.id || Date.now(),
      customerId: fleetCompanyId,
      vehicleNumber,
      vehicleName: fleetVehicleDraft.vehicleName.trim() || vehicleNumber,
      driverName: fleetVehicleDraft.driverName.trim(),
      fuelType: fleetVehicleDraft.fuelType,
      status: fleetVehicleDraft.status,
      notes: fleetVehicleDraft.notes.trim(),
      createdAt: editingFleetVehicle?.createdAt || stamp,
      updatedAt: stamp,
    }
    setFleetVehicles((current) => {
      if (editingFleetVehicle) return current.map((vehicle) => vehicle.id === editingFleetVehicle.id ? entry : vehicle)
      return [entry, ...current]
    })
    setFleetVehicleDraft({ vehicleNumber: '', vehicleName: '', driverName: '', fuelType: 'HSD', status: 'Active', notes: '' })
    setEditingFleetVehicle(null)
    setFleetAllocationVehicleId(entry.id)
    flash(editingFleetVehicle ? 'Vehicle updated successfully.' : 'Vehicle saved to the fleet register.')
  }

  const deleteFleetVehicle = (vehicle: FleetVehicle) => {
    if (!window.confirm(`Delete ${vehicle.vehicleNumber} and its monthly allocation history?`)) return
    setFleetVehicles((current) => current.filter((entry) => entry.id !== vehicle.id))
    setFleetAllocations((current) => current.filter((entry) => entry.vehicleId !== vehicle.id))
    if (fleetAllocationVehicleId === vehicle.id) setFleetAllocationVehicleId(0)
    flash('Vehicle and linked fleet records removed.')
  }

  const saveFleetAllocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const vehicleId = Number(fleetAllocationVehicleId)
    const limit = Number(fleetAllocationDraft)
    if (!fleetCompanyId || !vehicleId) return flash('Select a company and a vehicle before saving the monthly allocation.')
    if (!Number.isFinite(limit) || limit < 0) return flash('Monthly litre limit must be a valid non-negative number.')
    const month = fleetMonthFilter || `${today.slice(0, 7)}`
    const existing = fleetAllocations.find((entry) => entry.customerId === fleetCompanyId && entry.vehicleId === vehicleId && entry.month === month)
    const stamp = new Date().toISOString()
    const entry: FleetAllocation = {
      id: existing?.id || Date.now(),
      customerId: fleetCompanyId,
      vehicleId,
      month,
      monthlyLitresLimit: limit,
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
    }
    setFleetAllocations((current) => existing ? current.map((allocation) => allocation.id === existing.id ? entry : allocation) : [entry, ...current])
    setFleetAllocationDraft(String(limit))
    flash(`Monthly fleet allocation saved for ${month}.`)
  }

  const fleetCreditVehicleOptions = fleetVehicles.filter((vehicle) => vehicle.customerId === fleetCreditCompanyId && vehicle.status !== 'Inactive')
  const fleetCreditVehicle = fleetVehicles.find((vehicle) => vehicle.id === fleetCreditVehicleId && vehicle.customerId === fleetCreditCompanyId) || null
  const fleetCreditMonth = fleetCreditDraft.date ? fleetCreditDraft.date.slice(0, 7) : today.slice(0, 7)
  const fleetCreditTransactionLitres = Number(fleetCreditDraft.litres)
  const fleetCreditTransactionRate = Number(fleetCreditDraft.rate)
  const fleetCreditTransactionAmount = Number.isFinite(fleetCreditTransactionLitres) && Number.isFinite(fleetCreditTransactionRate) ? fleetCreditTransactionLitres * fleetCreditTransactionRate : 0
  const selectedFleetCreditHistory = udhar.filter((entry) => entry.customerId === fleetCreditCompanyId && entry.vehicleId === fleetCreditVehicleId && entry.type === 'Credit Sale').sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
  const selectedFleetCreditUsageSummary = fleetCreditVehicleId ? vehicleUsageForMonth(fleetCreditVehicleId, fleetCreditCompanyId, fleetCreditMonth) : { limit: 0, used: 0, remaining: 0, usagePercent: 0, status: 'Normal', exceeded: 0, month: fleetCreditMonth }

  const saveFleetCreditEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const companyId = Number(fleetCreditCompanyId)
    const vehicleId = Number(fleetCreditVehicleId)
    const vehicle = fleetVehicles.find((item) => item.id === vehicleId && item.customerId === companyId)
    if (!companyId) return flash('Select a company for the fuel credit entry.')
    if (!vehicle) return flash('Select a valid vehicle for this company.')
    if (!fleetCreditDraft.date) return flash('Please select a transaction date.')
    if (!fleetCreditDraft.fuelType) return flash('Select a fuel type.')
    const litres = Number(fleetCreditDraft.litres)
    const rate = Number(fleetCreditDraft.rate)
    if (!Number.isFinite(litres) || litres <= 0 || !Number.isFinite(rate) || rate < 0) return flash('Litres must be greater than zero and rate must be a valid non-negative number.')
    const month = fleetCreditDraft.date.slice(0, 7)
    const allocation = fleetAllocations.find((entry) => entry.customerId === companyId && entry.vehicleId === vehicleId && entry.month === month)
    if (!allocation) return flash(`No monthly fuel allocation exists for this vehicle for ${month}. Please create the monthly allocation first.`)
    const amount = litres * rate
    const reference = (fleetCreditDraft.reference || editingFleetCreditEntry?.reference || `VEH-${vehicle.vehicleNumber}-${Date.now()}`).trim()
    const description = (fleetCreditDraft.description || editingFleetCreditEntry?.description || `${vehicle.vehicleNumber} ${fleetCreditDraft.fuelType} credit`).trim()
    const transactionId = editingFleetCreditEntry?.id || Date.now()
    const saleEntry: Sale = {
      id: transactionId,
      date: fleetCreditDraft.date,
      product: fleetCreditDraft.fuelType as Product,
      litres,
      rate,
      amount,
      mode: 'Credit',
      customer: customers.find((customer) => customer.id === companyId)?.name || 'Company',
      customerId: companyId,
      vehicleId,
      reference,
    }
    const udharEntry: UdharTransaction = {
      id: transactionId,
      date: fleetCreditDraft.date,
      customerId: companyId,
      type: 'Credit Sale',
      reference,
      description,
      debit: amount,
      credit: 0,
      vehicleId,
      fuelType: fleetCreditDraft.fuelType,
      litres,
    }

    if (editingFleetCreditEntry) {
      setSales((current) => current.map((sale) => sale.id === editingFleetCreditEntry.id ? saleEntry : sale))
      setUdhar((current) => current.map((entry) => entry.id === editingFleetCreditEntry.id ? udharEntry : entry))
      setEditingFleetCreditEntry(null)
      flash('Credit fuel entry updated successfully.')
    } else {
      setSales((current) => [saleEntry, ...current])
      setUdhar((current) => [udharEntry, ...current])
      flash('Credit fuel entry saved successfully.')
    }

    setFleetCreditDraft({ date: today, fuelType: 'HSD', litres: '', rate: '', reference: '', description: '' })
    setFleetCreditVehicleId(vehicleId)
  }

  const editFleetCreditEntry = (entry: UdharTransaction) => {
    const vehicle = fleetVehicles.find((item) => item.id === entry.vehicleId)
    if (!vehicle) return
    setEditingFleetCreditEntry(entry)
    setFleetCreditCompanyId(entry.customerId)
    setFleetCreditVehicleId(vehicle.id)
    setFleetCreditDraft({
      date: entry.date,
      fuelType: entry.fuelType || 'HSD',
      litres: String(entry.litres ?? 0),
      rate: entry.litres && entry.debit ? String((entry.debit / entry.litres).toFixed(2)) : '0',
      reference: entry.reference,
      description: entry.description,
    })
  }

  const deleteFleetCreditEntry = (entry: UdharTransaction) => {
    if (!window.confirm(`Delete this credit fuel entry of ${printMoney(entry.debit)}? It will remove the vehicle usage and customer receivable effect.`)) return
    setUdhar((current) => current.filter((item) => item.id !== entry.id))
    setSales((current) => current.filter((sale) => sale.id !== entry.id))
    if (editingFleetCreditEntry?.id === entry.id) setEditingFleetCreditEntry(null)
    flash('Credit fuel entry deleted successfully.')
  }

  const customerOutstanding = (customerId: number) => customerBalance(customerId, customers, udhar)
  const saveCustomerPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(paymentAmount)
    const outstanding = customerOutstanding(paymentCustomerId)
    if (!paymentCustomerId) return flash('Select a customer for the payment.')
    if (!Number.isFinite(amount) || amount <= 0) return flash('Payment amount must be greater than zero.')
    const allowedAmount = outstanding + (editingPayment?.customerId === paymentCustomerId ? editingPayment.credit : 0)
    if (amount > allowedAmount + 0.000001) return flash("Payment cannot be greater than the customer's outstanding Udhar.")
    const reference = paymentReference.trim() || editingPayment?.reference || `RCV-${Date.now()}`
    const entry: UdharTransaction = { id: editingPayment?.id || Date.now(), date: paymentDate, customerId: paymentCustomerId, type: 'Payment Received', reference, description: `${paymentMethod} payment received`, debit: 0, credit: amount, paymentMethod }
    if (editingPayment) {
      setUdhar((current) => current.map((item) => item.id === editingPayment.id ? entry : item))
      setEditingPayment(null)
    } else {
      setUdhar((current) => [entry, ...current])
    }
    setPaymentAmount('')
    setPaymentReference('')
    flash(editingPayment ? 'Udhar payment updated successfully.' : 'Udhar payment received successfully.')
  }
  const editCustomerPayment = (payment: UdharTransaction) => {
    setEditingPayment(payment)
    setPaymentCustomerId(payment.customerId)
    setPaymentAmount(String(payment.credit))
    setPaymentDate(payment.date)
    setPaymentMethod(payment.paymentMethod || 'Cash')
    setPaymentReference(payment.reference)
  }
  const deleteCustomerPayment = (payment: UdharTransaction) => {
    if (!window.confirm(`Delete this payment of ${printMoney(payment.credit)}? The customer's receivable will increase again.`)) return
    setUdhar((current) => current.filter((entry) => entry.id !== payment.id))
    if (editingPayment?.id === payment.id) setEditingPayment(null)
    flash('Customer payment deleted successfully.')
  }

  const saveExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const paidBy = String(data.get('paidBy'))
    const enteredAmount = numberValue(data.get('amount'))
    if (enteredAmount <= 0) return flash('Expense amount must be greater than zero.')
    const entry: Expense = { id: Date.now(), date: String(data.get('date')), category: String(data.get('category')), description: String(data.get('description')), amount: paidBy === 'Discount' ? -enteredAmount : enteredAmount, paidBy }
    setExpenses((current) => [entry, ...current])
    event.currentTarget.reset()
    flash(paidBy === 'Discount' ? 'Discount adjustment saved and subtracted from expenses.' : 'Expense saved.')
  }

  const saveEmployeeSalary = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const gross = numberValue(data.get('gross'))
    const deductions = numberValue(data.get('deductions'))
    const entry: EmployeeSalary = { id: Date.now(), date: String(data.get('date')), period: String(data.get('period')), employee: String(data.get('employee')), gross, deductions, net: Math.max(0, gross - deductions), paidBy: String(data.get('paidBy')), status: String(data.get('status')) as EmployeeSalary['status'], notes: String(data.get('notes')) }
    setEmployeeSalaries((current) => [entry, ...current])
    event.currentTarget.reset()
    flash('Employee salary saved.')
  }

  const startStockOpeningEdit = (product: Product) => {
    setEditingStockProduct(product)
    setStockOpeningDraft(String(stockOpenings[product] || 0))
  }
  const saveStockOpening = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingStockProduct) return
    const opening = Math.max(0, Number(stockOpeningDraft) || 0)
    setStockOpenings((current) => ({ ...current, [editingStockProduct]: opening }))
    setEditingStockProduct(null)
    flash(`${editingStockProduct} opening stock updated.`)
  }
  const deleteStockProductData = (product: Product) => {
    if (!window.confirm(`Delete all ${product} stock data, including sales, purchases, adjustments, and opening stock?`)) return
    setStockOpenings((current) => ({ ...current, [product]: 0 }))
    setSales((current) => current.filter((sale) => sale.product !== product))
    setPurchases((current) => current.filter((purchase) => purchase.product !== product))
    setStockAdjustments((current) => current.filter((adjustment) => adjustment.product !== product))
    flash(`${product} stock data deleted.`)
  }

  const savePurchase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const litres = numberValue(data.get('litres'))
    const rate = numberValue(data.get('rate'))
    const entry: Purchase = { id: Date.now(), date: String(data.get('date')), product: String(data.get('product')) as Product, litres, rate, supplier: String(data.get('supplier')), amount: litres * rate }
    setPurchases((current) => [entry, ...current])
    event.currentTarget.reset()
    flash('Fuel purchase saved.')
  }

  const saveOil = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const quantity = numberValue(data.get('quantity'))
    const rate = numberValue(data.get('rate'))
    const entry: OilSale = { id: Date.now(), date: String(data.get('date')), item: String(data.get('item')), quantity, rate, amount: quantity * rate }
    setOilSales((current) => [entry, ...current])
    event.currentTarget.reset()
    flash('Mobile oil sale saved.')
  }

  const saveCommission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const date = String(data.get('date') || '')
    const product = String(data.get('product')) as Product
    const commissionableLitres = Number(data.get('commissionableLitres'))
    const rate = Number(data.get('rate'))
    const eligibleLitres = eligibleLitresFor(date, product)
    const remainingLitres = remainingEligibleLitresFor(date, product)
    if (!date || !products.includes(product)) return flash('Date and fuel type are required.')
    if (!Number.isFinite(commissionableLitres) || commissionableLitres < 0 || !Number.isFinite(rate) || rate < 0) return flash('Commissionable litres and rate must be valid non-negative numbers.')
    if (commissionableLitres > remainingLitres) return flash(`Commissionable litres cannot exceed remaining eligible litres (${remainingLitres.toLocaleString()} L).`)
    const record: CommissionRecord = { id: Date.now(), date, product, eligibleLitres, commissionableLitres, rate, amount: calculateCommissionAmount(commissionableLitres, rate), reference: String(data.get('reference') || ''), notes: String(data.get('notes') || '') }
    setCommissionRecords((current) => [record, ...current])
    event.currentTarget.reset()
    flash('Commission entry saved.')
  }

  const saveDiscountRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const customerId = Number(String(data.get('customerId') || '0')) || undefined
    const product = String(data.get('product') || '') as Product | ''
    const rule: DiscountRule = {
      id: Date.now(),
      customerId,
      product: product || undefined,
      discountType: String(data.get('discountType')) as DiscountType,
      discountValue: numberValue(data.get('discountValue')),
      effectiveDate: String(data.get('effectiveDate')),
      status: String(data.get('status')) as 'Active' | 'Inactive',
      description: String(data.get('description')),
    }
    setDiscountRules((current) => [rule, ...current])
    event.currentTarget.reset()
    flash('Discount rule saved.')
  }

  const savePaymentFee = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const setting: PaymentFeeSetting = {
      id: Date.now(),
      method: String(data.get('method')) as PaymentMethod,
      feePercent: numberValue(data.get('feePercent')),
      effectiveDate: String(data.get('effectiveDate')),
      status: String(data.get('status')) as 'Active' | 'Inactive',
      absorbedByBusiness: String(data.get('absorbedByBusiness')) === 'true',
    }
    setPaymentFees((current) => [setting, ...current])
    event.currentTarget.reset()
    flash('Payment fee policy saved.')
  }

  const saveStockAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const amount = numberValue(data.get('quantity'))
    const product = String(data.get('product')) as Product
    const entry: StockAdjustment = {
      id: Date.now(),
      date: String(data.get('date')),
      product,
      tank: String(data.get('tank')),
      transactionType: 'Stock Adjustment',
      reference: String(data.get('reference')),
      quantity: amount,
      user: stockUser,
      reason: stockReason,
      notes: String(data.get('notes')),
    }
    setStockAdjustments((current) => [entry, ...current])
    event.currentTarget.reset()
    flash('Stock adjustment recorded.')
  }

  const saveFamilyAdjustment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const amount = numberValue(data.get('amount'))
    const adjustment: FamilyAdjustment = {
      id: Date.now(),
      date: String(data.get('date')),
      customerId: Number(String(data.get('customerId') || '0')) || undefined,
      amount,
      adjustmentType: String(data.get('adjustmentType')) as FamilyAdjustment['adjustmentType'],
      status: String(data.get('status')) as FamilyAdjustment['status'],
      description: String(data.get('description')),
      notes: String(data.get('notes')),
    }
    setFamilyAdjustments((current) => [adjustment, ...current])
    event.currentTarget.reset()
    flash('Family adjustment saved.')
  }

  const saveBankAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const bankName = String(data.get('bankName') || '').trim()
    const accountName = String(data.get('accountName') || '').trim()
    const accountNumber = String(data.get('accountNumber') || '').trim()
    if (!bankName || !accountName || !accountNumber) return flash('Bank name, account name, and account number are required.')
    if (bankAccounts.some((account) => account.accountNumber === accountNumber)) return flash('That bank account number already exists.')
    const account: BankAccount = { id: Date.now(), bankName, accountName, accountNumber, openingBalance: numberValue(data.get('openingBalance')), currentBookBalance: numberValue(data.get('currentBookBalance')), active: true }
    setBankAccounts((current) => [account, ...current])
    event.currentTarget.reset()
    flash('Bank account created.')
  }

  const saveBRSRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const bankAccountId = Number(data.get('bankAccountId'))
    const bankAccount = bankAccounts.find((account) => account.id === bankAccountId && account.active !== false)
    const date = String(data.get('date') || '')
    const type = String(data.get('type')) as BRSRecord['type']
    const amount = Number(data.get('amount'))
    const bankAmount = Number(data.get('bankAmount'))
    if (!bankAccount) return flash('Select a valid active bank account.')
    if (!date) return flash('Transaction date is required.')
    if (!['Deposit', 'Withdrawal'].includes(type)) return flash('Select a transaction type.')
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(bankAmount) || bankAmount < 0) return flash('PPMS and bank amounts must be valid non-negative numbers.')
    const difference = amount - bankAmount
    const record: BRSRecord = {
      id: Date.now(),
      bankAccountId,
      date,
      description: String(data.get('description')),
      type,
      amount,
      bankAmount,
      adjustment: numberValue(data.get('adjustment')),
      status: String(data.get('status')) as BRSRecord['status'],
      reference: String(data.get('reference')),
      difference,
    }
    setBrsRecords((current) => [record, ...current])
    event.currentTarget.reset()
    setBrsBookAmount('0')
    setBrsBankAmount('0')
    flash('BRS transaction saved.')
  }

  const dashboard = (
    <>
      <section className="dashboard-hero">
        <div><p className="eyebrow">Station Operations</p><h2>Control Center</h2><p>EKHWAN - 1 Filling Station <span>·</span> {displayDate(currentSystemDate)}</p></div>
        <div className={`system-indicator${systemStatus?.databaseExists === false ? ' offline' : ''}`}><span className="status-dot" /><div><strong>{systemStatus?.databaseExists ? 'Database ready' : systemStatus ? 'Database unavailable' : 'Local system'}</strong><small>{systemStatus ? 'On-device register' : 'Status checking'}</small></div></div>
      </section>

      <section className="dashboard-period-control">
        <div className="period-summary"><span className="eyebrow">Reporting period</span><strong>{dashboardRange.from} <span>to</span> {dashboardRange.to}</strong></div>
        <div className="period-picker" role="group" aria-label="Dashboard period">
          {[
            ['Today', 'Daily'],
            ['This Week', 'Weekly'],
            ['This Month', 'Monthly'],
            ['This Year', 'Yearly'],
            ['Custom', 'Custom'],
          ].map(([value, label]) => <button key={value} type="button" className={`period-button${dashboardPeriod === value ? ' active' : ''}`} aria-pressed={dashboardPeriod === value} onClick={() => setDashboardPeriod(value)}>{label}</button>)}
        </div>
        {dashboardPeriod === 'Custom' && <div className="dashboard-custom-dates"><label className="form-field"><span>From Date</span><input type="date" value={dashboardCustomFrom} onChange={(event) => setDashboardCustomFrom(event.target.value)} /></label><label className="form-field"><span>To Date</span><input type="date" value={dashboardCustomTo} onChange={(event) => setDashboardCustomTo(event.target.value)} /></label></div>}
      </section>

      <section className="dashboard-kpis" aria-label="Period performance">
        <article className="dashboard-kpi kpi-primary"><span>Fuel Sales</span><strong>{money(dashboardSummary.totalSales)}</strong><small>Selected period</small></article>
        <article className="dashboard-kpi"><span>Fuel Sold</span><strong>{measurement(dashboardSummary.totalFuelLitres)} L</strong><small>Customer sales volume</small></article>
        <article className="dashboard-kpi"><span>Expenses</span><strong>{money(dashboardSummary.operatingExpenses)}</strong><small>Including commission</small></article>
        <article className="dashboard-kpi kpi-receivable"><span>Current Receivables</span><strong>{money(dashboardSummary.outstandingReceivables)}</strong><small>Balance as of {dashboardRange.to}</small></article>
      </section>

      <section className="dashboard-financial-strip" aria-label="Credit and cash summary">
        <div><span>Credit / Udhar Sales</span><strong>{money(dashboardSummary.creditSales)}</strong></div>
        <div><span>Customer Payments</span><strong>{money(dashboardSummary.customerPayments)}</strong></div>
        <div><span>Sales Less Expenses</span><strong>{money(dashboardSummary.netSales)}</strong></div>
      </section>

      <section className="dashboard-section dashboard-fuel-performance">
        <div className="dashboard-section-heading"><div><p className="eyebrow">Period breakdown</p><h3>Fuel Performance</h3></div><span className="form-note">Sales by product</span></div>
        <div className="fuel-performance-list">{products.map((product) => {
          const totals = dashboardSummary.productTotals[product] || { litres: 0, amount: 0 }
          const maximumAmount = Math.max(1, ...products.map((item) => dashboardSummary.productTotals[item]?.amount || 0))
          return <div className="fuel-performance-row" key={product}><strong>{product}</strong><div className="fuel-performance-bar"><span style={{ width: `${Math.min(100, totals.amount / maximumAmount * 100)}%` }} /></div><span>{measurement(totals.litres)} L</span><b>{money(totals.amount)}</b></div>
        })}</div>
      </section>

      <div className="dashboard-lower-grid">
        <section className="dashboard-section">
          <div className="dashboard-section-heading"><div><p className="eyebrow">Current position</p><h3>Fuel Stock</h3></div><span className="form-note">All-time stock balance</span></div>
          <div className="stock-overview-list">{fuelStockRows.map((row) => <div key={row.product}><span>{row.product}</span><strong>{measurement(row.remaining)} L</strong></div>)}</div>
        </section>
        <section className="dashboard-section">
          <div className="dashboard-section-heading"><div><p className="eyebrow">Company credit</p><h3>{dashboardFleetCompany?.customer.name || 'Fleet Credit'}</h3></div><button className="table-action" type="button" onClick={() => go('Customers')}>Open fleet</button></div>
          {dashboardFleetCompany ? <><div className="fleet-dashboard-stats"><div><span>Allocated</span><strong>{measurement(dashboardFleetCompany.summary.totalAllocation)} L</strong></div><div><span>Used</span><strong>{measurement(dashboardFleetCompany.summary.totalUsed)} L</strong></div><div><span>Remaining</span><strong>{measurement(dashboardFleetCompany.summary.totalRemaining)} L</strong></div></div><div className="fleet-progress-track"><span style={{ width: `${Math.min(100, dashboardFleetCompany.summary.usagePercent)}%` }} /></div><div className="fleet-progress-caption"><span>Monthly usage</span><strong>{dashboardFleetCompany.summary.usagePercent.toFixed(1)}% · {dashboardFleetCompany.summary.status}</strong></div></> : <p className="empty-state">No company vehicles are registered yet.</p>}
        </section>
      </div>

      <section className="dashboard-section dashboard-activity">
        <div className="dashboard-section-heading"><div><p className="eyebrow">Register updates</p><h3>Recent Activity</h3></div></div>
        {dashboardRecentActivity.length ? <div className="activity-list">{dashboardRecentActivity.map((activity) => <div className="activity-row" key={activity.id}><span className="activity-date">{activity.date}</span><div><strong>{activity.title}</strong><small>{activity.detail}</small></div><b>{activity.amount}</b></div>)}</div> : <p className="empty-state">No register activity has been recorded yet.</p>}
      </section>

      <section className="dashboard-quick-actions" aria-label="Quick actions">
        {['New Fuel Sale', 'Meter Reading', 'Customer Udhar', 'Expense', 'Fuel Purchase', 'Mobile Oil Sale', 'Daily Closing', 'Print Report'].map((action) => {
          const map: Record<string, string> = { 'New Fuel Sale': 'Sales', 'Meter Reading': 'Meter Reading', 'Customer Udhar': 'Customers', Expense: 'Expenses', 'Fuel Purchase': 'Fuel Management', 'Mobile Oil Sale': 'Mobile Oil', 'Daily Closing': 'Daily Operations', 'Print Report': 'Reports' }
          return <button key={action} type="button" className="action-button" onClick={() => go(map[action] || 'Dashboard')}>{action}</button>
        })}
      </section>
    </>
  )

  const fuelManagementPage = (
    <>
      <section className="register-section"><div className="section-heading"><h3>Fuel Stock / Litre Management</h3></div><DataTable headers={['Product', 'Opening', 'Purchased', 'Sold', 'Adjustment', 'Remaining']} rows={fuelStockRows.map((row) => [row.product, row.opening.toLocaleString(), row.purchased.toLocaleString(), row.sold.toLocaleString(), row.adjustment.toLocaleString(), row.remaining.toLocaleString()])} actions={authUser?.role === 'admin' ? (rowIndex) => { const row = fuelStockRows[rowIndex]; return <><button className="table-action" type="button" onClick={() => startStockOpeningEdit(row.product)}>Edit</button><button className="table-action danger-link" type="button" onClick={() => deleteStockProductData(row.product)}>Delete</button></> } : undefined} /></section>
      {authUser?.role === 'admin' && editingStockProduct && <form className="register-section stock-edit-form" onSubmit={saveStockOpening}><div className="section-heading"><h3>Edit {editingStockProduct} Opening Stock</h3></div><label className="form-field"><span>Opening Litres</span><input type="number" min="0" value={stockOpeningDraft} onChange={(event) => setStockOpeningDraft(event.target.value)} required /></label><div className="form-actions"><button className="primary-button" type="submit">Save Opening Stock</button><button className="ghost-button" type="button" onClick={() => setEditingStockProduct(null)}>Cancel</button></div></form>}
      <form className="register-section entry-form" onSubmit={saveStockAdjustment} onReset={() => { setStockProduct('HSD'); setStockReason('Cycle count'); setStockUser('Manager') }}>
        <div className="section-heading"><h3>Stock Adjustment</h3><span className="form-note">Recorded in ledger</span></div>
        <div className="form-grid">
          <label className="form-field"><span>Date</span><input name="date" type="date" defaultValue={today} required /></label>
          <label className="form-field"><span>Product</span><select name="product" value={stockProduct} onChange={(event) => setStockProduct(event.target.value as Product)} required><option value="HSD">HSD</option><option value="PMG">PMG</option><option value="XTRON">XTRON</option></select></label>
          <label className="form-field"><span>Tank</span><input name="tank" defaultValue={`${stockProduct} Tank 1`} required /></label>
          <label className="form-field"><span>Reference</span><input name="reference" defaultValue={`STK-${Date.now()}`} required /></label>
          <label className="form-field"><span>Quantity</span><input name="quantity" type="number" defaultValue={0} required /></label>
          <label className="form-field"><span>Reason</span><input value={stockReason} onChange={(event) => setStockReason(event.target.value)} required /></label>
          <label className="form-field"><span>User</span><input value={stockUser} onChange={(event) => setStockUser(event.target.value)} required /></label>
          <label className="form-field"><span>Notes</span><input name="notes" defaultValue="Stock reconciliation" required /></label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">Save Adjustment</button><button className="ghost-button" type="reset">Clear</button></div>
      </form>
      <FormPanel title="Fuel Purchase / Receiving Register" onSubmit={savePurchase} submitLabel="Save Purchase"><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Product" name="product" options={products} defaultValue="HSD" /><Field label="Litres" name="litres" type="number" defaultValue={1000} /><Field label="Purchase Rate" name="rate" type="number" defaultValue={280} /><Field label="Supplier" name="supplier" defaultValue="Fuel Supplier" /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>Fuel Purchase Register</h3><input className="table-search" aria-label="Search fuel purchases" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search purchases" /></div><DataTable headers={['Date', 'Product', 'Litres', 'Rate', 'Supplier', 'Amount']} rows={visiblePurchases.map((entry) => [entry.date, entry.product, entry.litres.toLocaleString(), money(entry.rate), entry.supplier, money(entry.amount)])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setPurchases((current) => current.filter((entry) => entry.id !== visiblePurchases[rowIndex].id))}>Delete</button>} /></section>
      <section className="register-section"><div className="section-heading"><h3>Stock Ledger</h3></div><DataTable headers={['Date', 'Product', 'Tank', 'Type', 'Reference', 'Qty', 'User', 'Reason']} rows={stockAdjustments.map((entry) => [entry.date, entry.product, entry.tank, entry.transactionType, entry.reference, entry.quantity.toLocaleString(), entry.user, entry.reason])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setStockAdjustments((current) => current.filter((entry) => entry.id !== stockAdjustments[rowIndex].id))}>Delete</button>} /></section>
    </>
  )

  const customerPage = (
    <>
      <FormPanel title="Customer Master Record" onSubmit={saveCustomer}><Field label="Customer / Party Name" name="name" /><Field label="Phone" name="phone" /><Field label="Address" name="address" required={false} /><Field label="Opening Balance" name="openingBalance" type="number" defaultValue={0} /><Field label="Opening Date" name="date" type="date" defaultValue={today} /></FormPanel>
      <section className="register-section">
        <div className="section-heading"><h3>Fleet Credit Monitoring</h3><span className="form-note">Company → Vehicle → Monthly litre allocation</span></div>
        <div className="form-grid">
          <label className="form-field"><span>Company</span><select value={fleetCompanyId} onChange={(event) => { const id = Number(event.target.value); setFleetCompanyId(id); const nextVehicle = fleetVehicles.find((vehicle) => vehicle.customerId === id && vehicle.status !== 'Inactive'); setFleetAllocationVehicleId(nextVehicle ? nextVehicle.id : 0) }} required><option value="0">Select company</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label className="form-field"><span>Selected Month</span><input type="month" value={fleetMonthFilter} onChange={(event) => setFleetMonthFilter(event.target.value)} /></label>
        </div>
        <div className="summary-strip">
          <strong>Vehicles: {fleetVehicles.filter((vehicle) => vehicle.customerId === fleetCompanyId && vehicle.status !== 'Inactive').length}</strong>
          <strong>Allocated: {fleetCompanySummary.totalAllocation.toLocaleString()} L</strong>
          <strong>Used: {fleetCompanySummary.totalUsed.toLocaleString()} L</strong>
          <strong>Remaining: {fleetCompanySummary.totalRemaining.toLocaleString()} L</strong>
          <strong>Usage: {fleetCompanySummary.usagePercent.toFixed(1)}%</strong>
          <strong>Over Limit: {fleetCompanySummary.overLimitVehicles}</strong>
        </div>
      </section>
      <section className="register-section">
        <div className="section-heading"><h3>Fuel Credit / Vehicle Udhar Entry</h3><span className="form-note">Company → Vehicle → Monthly fuel allocation → Actual credit fuel entry</span></div>
        <div className="form-grid">
          <label className="form-field"><span>Company</span><select value={fleetCreditCompanyId} onChange={(event) => {
            const companyId = Number(event.target.value)
            setFleetCreditCompanyId(companyId)
            const nextVehicle = fleetVehicles.find((vehicle) => vehicle.customerId === companyId && vehicle.status !== 'Inactive')
            setFleetCreditVehicleId(nextVehicle ? nextVehicle.id : 0)
          }} required><option value="0">Select company</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label className="form-field"><span>Vehicle</span>{fleetCreditCompanyId && fleetCreditVehicleOptions.length ? <select value={fleetCreditVehicleId} onChange={(event) => setFleetCreditVehicleId(Number(event.target.value))}><option value="0">Select vehicle</option>{fleetCreditVehicleOptions.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}</option>)}</select> : <input value="No vehicles found for this company. Add a vehicle first." readOnly />}</label>
        </div>
        <form className="entry-form" onSubmit={saveFleetCreditEntry}>
          <div className="form-grid">
            <label className="form-field"><span>Date</span><input type="date" value={fleetCreditDraft.date} onChange={(event) => setFleetCreditDraft((current) => ({ ...current, date: event.target.value }))} required /></label>
            <label className="form-field"><span>Fuel Type</span><select value={fleetCreditDraft.fuelType} onChange={(event) => setFleetCreditDraft((current) => ({ ...current, fuelType: event.target.value }))}>{products.map((product) => <option key={product} value={product}>{product}</option>)}</select></label>
            <label className="form-field"><span>Quantity / Litres</span><input type="number" min="0.01" step="0.01" value={fleetCreditDraft.litres} onChange={(event) => setFleetCreditDraft((current) => ({ ...current, litres: event.target.value }))} required /></label>
            <label className="form-field"><span>Rate Per Litre</span><input type="number" min="0" step="0.01" value={fleetCreditDraft.rate} onChange={(event) => setFleetCreditDraft((current) => ({ ...current, rate: event.target.value }))} required /></label>
            <label className="form-field"><span>Amount</span><input value={Number.isFinite(fleetCreditTransactionLitres) && Number.isFinite(fleetCreditTransactionRate) ? printMoney(fleetCreditTransactionAmount) : 'Rs. 0.00'} readOnly /></label>
            <label className="form-field"><span>Transaction Type</span><input value="Credit / Udhar" readOnly /></label>
            <label className="form-field"><span>Reference / Invoice No.</span><input value={fleetCreditDraft.reference} onChange={(event) => setFleetCreditDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="INV-001" /></label>
            <label className="form-field"><span>Description / Note</span><input value={fleetCreditDraft.description} onChange={(event) => setFleetCreditDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Vehicle fuel credit" /></label>
            {fleetCreditVehicle && <label className="form-field"><span>Monthly Allocation</span><input value={`${selectedFleetCreditUsageSummary.limit.toLocaleString()} L / ${selectedFleetCreditUsageSummary.used.toLocaleString()} L used / ${selectedFleetCreditUsageSummary.remaining.toLocaleString()} L remaining`} readOnly /></label>}
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">{editingFleetCreditEntry ? 'Save Credit Entry' : 'Save Credit Entry'}</button>{editingFleetCreditEntry && <button className="ghost-button" type="button" onClick={() => { setEditingFleetCreditEntry(null); setFleetCreditDraft({ date: today, fuelType: 'HSD', litres: '', rate: '', reference: '', description: '' }) }}>Cancel</button>}</div>
        </form>
      </section>
      <section className="register-section">
        <div className="section-heading"><h3>{fleetCreditVehicle ? `${fleetCreditVehicle.vehicleNumber} Credit History` : 'Vehicle Credit History'}</h3></div>
        {fleetCreditVehicle ? <>
          <div className="summary-strip">
            <strong>Monthly Limit: {selectedFleetCreditUsageSummary.limit.toLocaleString()} L</strong>
            <strong>Used: {selectedFleetCreditUsageSummary.used.toLocaleString()} L</strong>
            <strong>Remaining: {selectedFleetCreditUsageSummary.remaining.toLocaleString()} L</strong>
            <strong>Usage: {selectedFleetCreditUsageSummary.usagePercent.toFixed(1)}%</strong>
          </div>
          <DataTable headers={['Date', 'Fuel', 'Litres', 'Rate', 'Amount', 'Type', 'Reference', 'Action']} rows={selectedFleetCreditHistory.map((entry) => [entry.date, entry.fuelType || '-', `${Number(entry.litres || 0).toLocaleString()} L`, money(Number((entry.debit || 0) / (entry.litres || 1))), money(entry.debit), entry.type, entry.reference, ''])} actions={(rowIndex) => { const entry = selectedFleetCreditHistory[rowIndex]; if (!entry) return undefined; return <><button className="table-action" type="button" onClick={() => editFleetCreditEntry(entry)}>Edit</button><button className="table-action danger-link" type="button" onClick={() => deleteFleetCreditEntry(entry)}>Delete</button></> }} empty="No credit fuel transactions recorded for this vehicle in the selected month." />
        </> : <p className="form-note">Select a company and vehicle to view its credit history.</p>}
      </section>
      <section className="register-section">
        <div className="section-heading"><h3>Add / Edit Vehicle</h3></div>
        <form className="entry-form" onSubmit={saveFleetVehicle}>
          <div className="form-grid">
            <label className="form-field"><span>Company</span><select value={fleetCompanyId} onChange={(event) => setFleetCompanyId(Number(event.target.value))}><option value="0">Select company</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label className="form-field"><span>Vehicle Number</span><input value={fleetVehicleDraft.vehicleNumber} onChange={(event) => setFleetVehicleDraft((current) => ({ ...current, vehicleNumber: event.target.value }))} required /></label>
            <label className="form-field"><span>Vehicle Name / Type</span><input value={fleetVehicleDraft.vehicleName} onChange={(event) => setFleetVehicleDraft((current) => ({ ...current, vehicleName: event.target.value }))} placeholder="Tipper / Van / Car" /></label>
            <label className="form-field"><span>Driver Name</span><input value={fleetVehicleDraft.driverName} onChange={(event) => setFleetVehicleDraft((current) => ({ ...current, driverName: event.target.value }))} /></label>
            <label className="form-field"><span>Fuel Type</span><select value={fleetVehicleDraft.fuelType} onChange={(event) => setFleetVehicleDraft((current) => ({ ...current, fuelType: event.target.value }))}><option value="HSD">HSD</option><option value="PMG">PMG</option><option value="XTRON">XTRON</option></select></label>
            <label className="form-field"><span>Status</span><select value={fleetVehicleDraft.status} onChange={(event) => setFleetVehicleDraft((current) => ({ ...current, status: event.target.value as 'Active' | 'Inactive' }))}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label>
            <label className="form-field"><span>Notes</span><input value={fleetVehicleDraft.notes} onChange={(event) => setFleetVehicleDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">{editingFleetVehicle ? 'Save Vehicle' : 'Add Vehicle'}</button>{editingFleetVehicle && <button className="ghost-button" type="button" onClick={() => { setEditingFleetVehicle(null); setFleetVehicleDraft({ vehicleNumber: '', vehicleName: '', driverName: '', fuelType: 'HSD', status: 'Active', notes: '' }) }}>Cancel</button>}</div>
        </form>
      </section>
      <section className="register-section">
        <div className="section-heading"><h3>Monthly Fuel Allocation</h3></div>
        <form className="entry-form" onSubmit={saveFleetAllocation}>
          <div className="form-grid">
            <label className="form-field"><span>Company</span><select value={fleetCompanyId} onChange={(event) => { const id = Number(event.target.value); setFleetCompanyId(id); const nextVehicle = fleetVehicles.find((vehicle) => vehicle.customerId === id && vehicle.status !== 'Inactive'); setFleetAllocationVehicleId(nextVehicle ? nextVehicle.id : 0) }}><option value="0">Select company</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label className="form-field"><span>Vehicle</span><select value={fleetAllocationVehicleId} onChange={(event) => setFleetAllocationVehicleId(Number(event.target.value))}><option value="0">Select vehicle</option>{fleetVehicles.filter((vehicle) => vehicle.customerId === fleetCompanyId && vehicle.status !== 'Inactive').map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.vehicleNumber}</option>)}</select></label>
            <label className="form-field"><span>Month</span><input type="month" value={fleetMonthFilter} onChange={(event) => setFleetMonthFilter(event.target.value)} /></label>
            <label className="form-field"><span>Monthly Limit (Litres)</span><input type="number" min="0" step="1" value={fleetAllocationDraft} onChange={(event) => setFleetAllocationDraft(event.target.value)} /></label>
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">Save Allocation</button></div>
        </form>
      </section>
      <section className="register-section">
        <div className="section-heading"><h3>{customers.find((customer) => customer.id === fleetCompanyId)?.name || 'Selected Company'} Vehicle Status</h3></div>
        <DataTable headers={['Vehicle', 'Fuel', 'Monthly Limit', 'Used', 'Remaining', 'Usage %', 'Status']} rows={selectedCompanyFleet.map((vehicle) => {
          const summary = vehicleUsageForMonth(vehicle.id, fleetCompanyId, fleetMonthFilter)
          const allocation = fleetAllocations.find((entry) => entry.customerId === fleetCompanyId && entry.vehicleId === vehicle.id && entry.month === fleetMonthFilter)
          return [vehicle.vehicleNumber, vehicle.fuelType, `${(allocation ? allocation.monthlyLitresLimit : 0).toLocaleString()} L`, `${summary.used.toLocaleString()} L`, `${summary.remaining.toLocaleString()} L`, `${summary.usagePercent.toFixed(1)}%`, summary.status]
        })} actions={(rowIndex) => { const vehicle = selectedCompanyFleet[rowIndex]; if (!vehicle) return undefined; return <><button className="table-action" type="button" onClick={() => { setFleetCompanyId(vehicle.customerId); setFleetVehicleDraft({ vehicleNumber: vehicle.vehicleNumber, vehicleName: vehicle.vehicleName, driverName: vehicle.driverName, fuelType: vehicle.fuelType, status: vehicle.status, notes: vehicle.notes }); setEditingFleetVehicle(vehicle); setFleetAllocationVehicleId(vehicle.id); setFleetAllocationDraft(String((fleetAllocations.find((entry) => entry.customerId === vehicle.customerId && entry.vehicleId === vehicle.id && entry.month === fleetMonthFilter)?.monthlyLitresLimit) || 0)); }}>Edit</button><button className="table-action danger-link" type="button" onClick={() => deleteFleetVehicle(vehicle)}>Delete</button></> }} />
      </section>
      <section className="register-section">
        <div className="section-heading"><h3>Company Fleet Summary</h3></div>
        <DataTable headers={['Company', 'Vehicles', 'Allocation', 'Used', 'Remaining', 'Usage', 'Status']} rows={fleetCompanyRows.map(({ customer, summary }) => [customer.name, `${fleetVehicles.filter((vehicle) => vehicle.customerId === customer.id && vehicle.status !== 'Inactive').length}`, `${summary.totalAllocation.toLocaleString()} L`, `${summary.totalUsed.toLocaleString()} L`, `${summary.totalRemaining.toLocaleString()} L`, `${summary.usagePercent.toFixed(1)}%`, summary.status])} />
      </section>
      <form className="register-section entry-form" onSubmit={saveCustomerPayment}>
        <div className="section-heading"><h3>{editingPayment ? 'Edit Udhar Payment' : 'Receive Udhar Payment'}</h3><span className="form-note">Collection reduces the customer's receivable.</span></div>
        <div className="form-grid">
          <label className="form-field"><span>Customer</span><select value={paymentCustomerId} onChange={(event) => setPaymentCustomerId(Number(event.target.value))} required><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
          <label className="form-field"><span>Current Outstanding</span><input value={paymentCustomer ? money(paymentOutstanding) : 'Select a customer'} readOnly /></label>
          <label className="form-field"><span>Payment Amount</span><input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label>
          <label className="form-field"><span>Payment Date</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></label>
          <label className="form-field"><span>Payment Method</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{['Cash', 'Bank', 'Card', 'Credit Card', 'Debit Card', 'Bank Transfer', 'Online Payment', 'Other'].map((method) => <option key={method}>{method}</option>)}</select></label>
          <label className="form-field"><span>Reference / Note</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Receipt or note" /></label>
          <label className="form-field"><span>Remaining Udhar</span><input value={paymentCustomer ? money(Math.max(0, paymentOutstanding - (Number(paymentAmount) || 0))) : 'Select a customer'} readOnly /></label>
        </div>
        <div className="form-actions"><button className="primary-button" type="submit">{editingPayment ? 'Save Payment Changes' : 'Receive Payment'}</button><button className="ghost-button" type="reset" onClick={() => { setPaymentAmount(''); setPaymentReference(''); setEditingPayment(null) }}>Clear</button></div>
      </form>
      <FormPanel title="Discount Rule Setup" onSubmit={saveDiscountRule} submitLabel="Save Discount"><Field label="Customer" name="customerId" options={customers.map((customer) => `${customer.id} - ${customer.name}`)} required={false} /><Field label="Product" name="product" options={['', 'HSD', 'PMG', 'XTRON']} required={false} /><Field label="Discount Type" name="discountType" options={['percent', 'fixed']} defaultValue="percent" /><Field label="Discount Value" name="discountValue" type="number" defaultValue={2} /><Field label="Effective Date" name="effectiveDate" type="date" defaultValue={today} /><Field label="Status" name="status" options={['Active', 'Inactive']} defaultValue="Active" /><Field label="Description" name="description" defaultValue="Customer discount" /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>Customer Discount Rules</h3></div><DataTable headers={['Customer', 'Product', 'Type', 'Value', 'Status', 'Description']} rows={discountRules.map((rule) => [rule.customerId ? customerName(rule.customerId) : 'General', rule.product || 'All', rule.discountType, rule.discountValue.toString(), rule.status, rule.description])} /></section>
      <section className="register-section"><div className="section-heading"><h3>Customer Register</h3></div><DataTable headers={['Name', 'Phone', 'Address', 'Opening Balance']} rows={customers.map((customer) => [customer.name, customer.phone, customer.address, money(customer.openingBalance)])} actions={authUser?.role === 'operator' ? undefined : (rowIndex) => <button className="table-action" type="button" onClick={() => deleteCustomer(customers[rowIndex])}>Delete</button>} /></section><section className="register-section"><div className="section-heading"><h3>Customer Statement by Date</h3></div><div className="statement-controls"><label className="form-field"><span>Customer</span><select value={statementCustomerId} onChange={(event) => setStatementCustomerId(Number(event.target.value))}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="form-field"><span>As of</span><input type="date" value={statementDate} onChange={(event) => setStatementDate(event.target.value)} /></label></div><DataTable headers={['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Description']} rows={statementEntries.map((item) => [item.date, item.type, item.reference, money(item.debit), money(item.credit), item.description])} /><div className="summary-strip"><strong>Balance: {money(statementBalance)}</strong></div></section>
      <section className="register-section"><div className="section-heading"><h3>Customer Register</h3></div><DataTable headers={['Name', 'Phone', 'Address', 'Opening Balance', 'Outstanding']} rows={customers.map((customer) => [customer.name, customer.phone, customer.address, money(customer.openingBalance), money(customerBalance(customer.id, customers, udhar))])} actions={authUser?.role === 'operator' ? undefined : (rowIndex) => <button className="table-action" type="button" onClick={() => deleteCustomer(customers[rowIndex])}>Delete</button>} /></section>
      <section className="register-section"><div className="section-heading"><h3>Customer Transaction History</h3></div><div className="statement-controls"><label className="form-field"><span>Customer</span><select value={statementCustomerId} onChange={(event) => setStatementCustomerId(Number(event.target.value))}><option value="0">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="form-field"><span>As of</span><input type="date" value={statementDate} onChange={(event) => setStatementDate(event.target.value)} /></label></div>{statementCustomerId > 0 && <div className="summary-strip"><strong>Total Udhar: {money(selectedCustomerEntries.reduce((sum, item) => sum + item.debit, 0))}</strong><strong>Total Paid: {money(selectedCustomerEntries.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0))}</strong><strong>Remaining: {money(customerOutstanding(statementCustomerId))}</strong></div>}<DataTable headers={['Date', 'Type', 'Description', 'Payment Method', 'Debit', 'Credit', 'Balance', 'Action']} rows={selectedCustomerHistory.map(({ entry, balance }) => [entry.date, entry.type, entry.description, entry.paymentMethod || '-', money(entry.debit), money(entry.credit), money(balance), ''])} actions={(rowIndex) => { const item = selectedCustomerHistory[rowIndex]?.entry; return item?.type === 'Payment Received' ? <><button className="table-action" type="button" onClick={() => editCustomerPayment(item)}>Edit</button><button className="table-action danger-link" type="button" onClick={() => deleteCustomerPayment(item)}>Delete</button></> : undefined }} /></section>
    </>
  )

  const settingsPage = (
    <>
      {authUser?.role === 'admin' && <section className="register-section"><div className="section-heading"><h3>Account Security</h3><span className="form-note">Change your login username or password.</span></div><div className="form-actions"><button className="primary-button" type="button" onClick={() => { setShowChangePassword(true); setChangePasswordError(''); setChangePasswordSuccess(false) }}>Change Password</button><button className="ghost-button" type="button" onClick={() => { setShowChangeUsername(true); setChangeUsername(authUser.username); setChangeUsernamePassword(''); setChangeUsernameError('') }}>Change Username</button></div></section>}
      {authUser?.role === 'admin' && <><FormPanel title="User and Role Management" onSubmit={saveUser} submitLabel="Create User"><Field label="Username" name="username" /><Field label="Temporary Password" name="password" type="password" /><Field label="Role" name="role" options={['admin', 'manager', 'operator']} defaultValue="operator" /></FormPanel><section className="register-section"><div className="section-heading"><h3>Users</h3><button className="ghost-button" type="button" onClick={loadUsers}>Refresh Users</button></div><DataTable headers={['Username', 'Role', 'Status']} rows={users.map((user) => [user.username, user.role, 'Active'])} /></section><section className="register-section role-guide"><div className="section-heading"><h3>Role Permissions</h3></div><div className="role-guide-grid"><div><strong>Admin</strong><p>Full access, including user creation and accounting settings.</p></div><div><strong>Manager</strong><p>Runs operational registers and can update station data, but cannot manage user accounts.</p></div><div><strong>Operator</strong><p>Records daily operations. Settings are hidden, and accounting settings cannot be changed.</p></div></div></section></>}
      <section className="register-section">
        <div className="section-heading"><h3>Offline Database and Backup</h3><span className="form-note">Local SQLite data</span></div>
        <div className="summary-strip"><strong>Database: {systemStatus?.databaseExists ? 'Connected' : 'Unavailable'}</strong><strong>Version: {systemStatus?.version || 'Loading'}</strong><strong>Backups: {backups.length}</strong></div>
        <p className="form-note">Database location: {systemStatus?.databasePath || 'Loading'}<br />Backup folder: {systemStatus?.backupDir || 'Loading'}</p>
        {authUser?.role !== 'operator' && <div className="form-actions backup-actions"><button className="primary-button" type="button" onClick={backupDatabase}>Backup Database</button>{authUser?.role === 'admin' && <button className="ghost-button" type="button" onClick={createMonthlyBackup}>Create Monthly Backup</button>}<button className="ghost-button" type="button" onClick={downloadBackup}>Download Register Backup</button>{authUser?.role === 'admin' && <><label className="ghost-button backup-upload-button" htmlFor="register-backup-upload">Upload Register Backup</label><input id="register-backup-upload" className="backup-upload-input" type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadBackup(file); event.currentTarget.value = '' }} /></>}{authUser?.role === 'admin' && <button className="danger-button" type="button" onClick={resetRegisterData}>Reset Register Data</button>}<button className="ghost-button" type="button" onClick={loadBackups}>Refresh Backups</button></div>}
        <div className="period-controls backup-filters"><label className="form-field"><span>Backup Type</span><select value={backupFilter} onChange={(event) => setBackupFilter(event.target.value as 'All' | 'Daily' | 'Monthly' | 'Safety')}><option>All</option><option>Daily</option><option>Monthly</option><option>Safety</option></select></label><label className="form-field"><span>Monthly Backup Month</span><input type="month" value={monthlyBackupMonth} onChange={(event) => setMonthlyBackupMonth(event.target.value)} /></label><label className="form-field"><span>Month</span><input type="month" value={backupMonth} onChange={(event) => setBackupMonth(event.target.value)} /></label></div>
        <div className="table-wrap backup-table"><table><thead><tr><th>Date</th><th>Type</th><th>Backup</th><th>Size</th><th>Status</th><th>Action</th></tr></thead><tbody>{backups.filter((backup) => (backupFilter === 'All' || backup.type === backupFilter) && (!backupMonth || backup.name.includes(backupMonth))).length ? backups.filter((backup) => (backupFilter === 'All' || backup.type === backupFilter) && (!backupMonth || backup.name.includes(backupMonth))).map((backup) => <tr key={backup.name}><td>{new Date(backup.modifiedAt).toLocaleString()}</td><td>{backup.type}</td><td>{backup.name}</td><td>{Math.ceil(backup.size / 1024)} KB</td><td>Valid</td><td className="backup-row-actions">{authUser?.role === 'admin' && <><button className="table-action" type="button" onClick={() => restoreDatabase(backup.name)}>Restore</button><button className="table-action danger-link" type="button" onClick={() => deleteBackup(backup)}>Delete</button></>}</td></tr>) : <tr><td colSpan={6} className="empty-cell">No database backups found.</td></tr>}</tbody></table></div>
        <p className="form-note">Daily backups are retained until you delete them. Monthly backups are complete SQLite restore points. Restore always creates a safety backup first.</p>
      </section>
      <FormPanel title="Payment Fee Configuration" onSubmit={savePaymentFee} submitLabel="Save Fee Policy"><Field label="Payment Method" name="method" options={['Cash', 'Card', 'Credit Card', 'Debit Card', 'Bank Transfer', 'Online Payment', 'Other']} defaultValue="Card" /><Field label="Fee Percentage" name="feePercent" type="number" defaultValue={2} /><Field label="Effective Date" name="effectiveDate" type="date" defaultValue={today} /><Field label="Status" name="status" options={['Active', 'Inactive']} defaultValue="Active" /><Field label="Absorbed by Business" name="absorbedByBusiness" options={['true', 'false']} defaultValue="true" /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>Payment Fee Policies</h3></div><DataTable headers={['Method', 'Percent', 'Effective', 'Status', 'Business Absorbs']} rows={paymentFees.map((setting) => [setting.method, `${setting.feePercent}%`, setting.effectiveDate, setting.status, setting.absorbedByBusiness ? 'Yes' : 'No'])} /></section>
      <FormPanel title="Bank Accounts" onSubmit={saveBankAccount} submitLabel="Create Bank Account"><Field label="Bank Name" name="bankName" defaultValue="" /><Field label="Account Name" name="accountName" defaultValue="" /><Field label="Account Number" name="accountNumber" defaultValue="" /><Field label="Opening Balance" name="openingBalance" type="number" defaultValue={0} /><Field label="Current Book Balance" name="currentBookBalance" type="number" defaultValue={0} /></FormPanel>
      <section id="bank-accounts" className="register-section"><div className="section-heading"><h3>Bank Accounts</h3></div><DataTable headers={['Bank', 'Account', 'Account Number', 'Opening', 'Book Balance', 'Status']} rows={bankAccounts.map((account) => [account.bankName, account.accountName, account.accountNumber, money(account.openingBalance), money(account.currentBookBalance), account.active === false ? 'Inactive' : 'Active'])} /></section>
      <form className="register-section entry-form" onSubmit={saveBRSRecord} onReset={() => { setBrsBookAmount('0'); setBrsBankAmount('0') }}>
        <div className="section-heading"><h3>BRS Transaction / Reconciliation Entry</h3><span className="form-note">Bank Account is required</span></div>
        <div className="form-grid">
          <label className="form-field"><span>Bank Account</span><select name="bankAccountId" required disabled={!activeBankAccounts.length}><option value="">{activeBankAccounts.length ? 'Select Bank Account' : 'No bank accounts available'}</option>{activeBankAccounts.map((account) => <option key={account.id} value={account.id}>{bankAccountLabel(account)} - {account.accountNumber}</option>)}</select></label>
          <label className="form-field"><span>Transaction Date</span><input name="date" type="date" defaultValue={today} required /></label>
          <label className="form-field"><span>Transaction Type</span><select name="type" defaultValue="Deposit" required><option value="Deposit">Deposit</option><option value="Withdrawal">Withdrawal</option></select></label>
          <label className="form-field"><span>Reference / Cheque No.</span><input name="reference" defaultValue="BRS-001" required /></label>
          <label className="form-field"><span>Description</span><input name="description" defaultValue="Bank transaction" required /></label>
          <label className="form-field"><span>PPMS Amount</span><input name="amount" type="number" min="0" value={brsBookAmount} onChange={(event) => setBrsBookAmount(event.target.value)} required /></label>
          <label className="form-field"><span>Bank Statement Amount</span><input name="bankAmount" type="number" min="0" value={brsBankAmount} onChange={(event) => setBrsBankAmount(event.target.value)} required /></label>
          <label className="form-field"><span>Difference</span><input value={money((Number(brsBookAmount) || 0) - (Number(brsBankAmount) || 0))} readOnly /></label>
          <label className="form-field"><span>Adjustment</span><input name="adjustment" type="number" defaultValue={0} /></label>
          <label className="form-field"><span>Reconciliation Status</span><select name="status" defaultValue="Pending" required><option>Matched</option><option>Unmatched</option><option>Pending</option><option>Book Only</option><option>Bank Only</option></select></label>
        </div>
        {!activeBankAccounts.length && <p className="form-error">No bank accounts available. Create a bank account above before recording a BRS transaction.</p>}
        <div className="form-actions"><button className="primary-button" type="submit" disabled={!activeBankAccounts.length}>Save BRS Record</button><button className="ghost-button" type="reset">Clear</button></div>
      </form>
      <section className="register-section"><div className="section-heading"><h3>BRS / Bank Reconciliation</h3><button className="ghost-button" type="button" onClick={() => printDocument('Bank Reconciliation Statement', `${displayDate(reportRange.from)} - ${displayDate(reportRange.to)}`)}>Print BRS</button><label className="form-field"><span>Bank Account Filter</span><select value={brsBankFilter} onChange={(event) => setBrsBankFilter(event.target.value)}><option value="all">All Banks</option>{activeBankAccounts.map((account) => <option key={account.id} value={account.id}>{bankAccountLabel(account)}</option>)}</select></label></div><DataTable headers={['Date', 'Bank Account', 'Type', 'Reference', 'PPMS Amount', 'Bank Amount', 'Difference', 'Status']} rows={brsRecords.filter((entry) => brsBankFilter === 'all' || String(entry.bankAccountId) === brsBankFilter).map((entry) => [entry.date, brsBankName(entry), entry.type, entry.reference, money(entry.amount), money(entry.bankAmount || 0), money(entry.difference ?? entry.amount - (entry.bankAmount || 0)), entry.status])} /><div className="summary-strip"><strong>Book Transactions: {brsRecords.length}</strong><strong>Reconciled: {brsRecords.filter((entry) => entry.status === 'Matched').length}</strong><strong>Difference: {money(brsRecords.reduce((sum, entry) => sum + (entry.difference ?? entry.amount - (entry.bankAmount || 0)), 0))}</strong></div></section>
    </>
  )

  const reportCenterPage = (
    <>
      <section className="report-center-heading"><div><p className="eyebrow">Business reports, operational analysis and financial summaries</p><h3>Reports</h3><p className="form-note">Report Period: {displayDate(reportRange.from)} - {displayDate(reportRange.to)}</p></div><div className="form-actions"><button className="primary-button" type="button" onClick={() => printDocument(reportData.title, `${displayDate(reportRange.from)} - ${displayDate(reportRange.to)}`)}>Print</button><button className="ghost-button" type="button" onClick={() => exportCsv(`ppms-${selectedReport.toLowerCase().replaceAll(' ', '-')}-${reportRange.from}-${reportRange.to}.csv`, reportData.headers, reportData.rows)}>Export</button></div></section>
      <section className="register-section report-period-panel"><div className="period-picker">{['Today', 'Yesterday', 'This Week', 'This Month', 'Last Month', 'This Year', 'Custom'].map((period) => <button key={period} type="button" className={`period-button${reportPeriod === period ? ' active' : ''}`} onClick={() => setReportPeriod(period)}>{period}</button>)}</div>{reportPeriod === 'Custom' && <div className="period-controls"><label className="form-field"><span>From Date</span><input type="date" value={reportCustomFrom} onChange={(event) => setReportCustomFrom(event.target.value)} /></label><label className="form-field"><span>To Date</span><input type="date" value={reportCustomTo} onChange={(event) => setReportCustomTo(event.target.value)} /></label></div>}</section>
      <div className="report-center-layout"><nav className="report-selector">{['Operations', 'Financial', 'Summary'].map((category) => <div key={category}><h4>{category}</h4>{reportOptions.filter((option) => option[0] === category).map(([, report]) => <button key={report} type="button" className={selectedReport === report ? 'selected' : ''} onClick={() => setSelectedReport(report)}>{report}</button>)}</div>)}</nav><section className="register-section active-report"><div className="section-heading"><div><h3>{reportData.title}</h3><p className="form-note">{reportData.description}</p></div></div><DataTable headers={reportData.headers} rows={reportData.rows} /><div className="summary-strip">{reportData.summary?.map(([label, value]) => <strong key={label}>{label}: {value}</strong>)}</div></section></div>
    </>
  )

  const reportsPage = (
    <>
      <section className="register-section"><div className="section-heading"><h3>Report Period</h3><span className="form-note">{reportRange.from} - {reportRange.to}</span></div><div className="period-controls"><label className="form-field"><span>Period</span><select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)}><option>Today</option><option>This Week</option><option>This Month</option><option>This Year</option><option>Custom</option></select></label>{reportPeriod === 'Custom' && <><label className="form-field"><span>From Date</span><input type="date" value={reportCustomFrom} onChange={(event) => setReportCustomFrom(event.target.value)} /></label><label className="form-field"><span>To Date</span><input type="date" value={reportCustomTo} onChange={(event) => setReportCustomTo(event.target.value)} /></label></>}<div className="form-actions"><button className="primary-button" type="button" onClick={() => printDocument('Monthly Financial & Operations Report', `${displayDate(reportRange.from)} - ${displayDate(reportRange.to)}`)}>Print Report</button><button className="ghost-button" type="button" onClick={() => exportCsv(`ppms-report-${reportRange.from}-${reportRange.to}.csv`, ['Ledger', 'Total', 'Notes'], [['Fuel Sales', money(filteredSales.reduce((sum, sale) => sum + sale.amount, 0)), 'Fuel revenue'], ['Fuel Purchases', money(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0)), 'Stock procurement'], ['Customer Payments', money(filteredUdhar.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0)), 'Receipts'], ['Expenses', money(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)), 'Operating costs']])}>Export CSV</button></div></div></section>
      <section className="register-section"><div className="section-heading"><h3>Monthly Statement Overview</h3></div><DataTable headers={['Ledger', 'Total', 'Notes']} rows={[['Fuel Sales', money(filteredSales.reduce((sum, sale) => sum + sale.amount, 0)), 'Gross fuel revenue'], ['Fuel Purchases', money(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0)), 'Stock procurement'], ['Customer Payments', money(filteredUdhar.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0)), 'Receipts'], ['Expenses', money(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)), 'Operating costs'], ['Commission', money(commissionAmountForRange), 'Recorded commission expense'], ['Customers Receivable', money(customers.reduce((sum, customer) => sum + customerBalance(customer.id, customers, udhar), 0)), 'Current outstanding']]} /></section>
      <section className="register-section"><div className="section-heading"><h3>Meter Reading Report</h3></div><DataTable headers={['Date', 'Shift', 'Nozzle', 'Fuel', 'Opening', 'Closing', 'Litres Sold', 'Rate', 'Amount']} rows={filteredMeters.map((meter) => [meter.date, meter.shift, meter.nozzle, meter.product, measurement(meter.previous), measurement(meter.present), measurement(meter.litres), meter.rate === undefined ? '-' : printMoney(meter.rate), meter.amount === undefined ? '-' : printMoney(meter.amount)])} /></section>
      <section className="register-section"><div className="section-heading"><h3>BRS Detail</h3></div><DataTable headers={['Date', 'Description', 'Type', 'Amount', 'Status']} rows={brsRecords.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to).map((entry) => [entry.date, entry.description, entry.type, money(entry.amount), entry.status])} /></section>
      {authUser?.role === 'admin' && <><FormPanel title="Employee Salary Register" onSubmit={saveEmployeeSalary} submitLabel="Save Salary"><Field label="Payment Date" name="date" type="date" defaultValue={today} /><Field label="Salary Period" name="period" defaultValue={today.slice(0, 7)} /><Field label="Employee Name" name="employee" /><Field label="Gross Salary" name="gross" type="number" defaultValue={0} /><Field label="Deductions / Advance" name="deductions" type="number" defaultValue={0} /><Field label="Paid By" name="paidBy" options={['Cash', 'Bank', 'Card']} defaultValue="Cash" /><Field label="Status" name="status" options={['Paid', 'Pending']} defaultValue="Paid" /><Field label="Notes" name="notes" required={false} /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>Employee Salary History</h3></div><DataTable headers={['Date', 'Period', 'Employee', 'Gross', 'Deductions', 'Net Paid', 'Paid By', 'Status']} rows={employeeSalaries.filter((salary) => salary.date >= reportRange.from && salary.date <= reportRange.to).map((salary) => [salary.date, salary.period, salary.employee, money(salary.gross), money(salary.deductions), money(salary.net), salary.paidBy, salary.status])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => { const visibleSalaries = employeeSalaries.filter((salary) => salary.date >= reportRange.from && salary.date <= reportRange.to); setEmployeeSalaries((current) => current.filter((salary) => salary.id !== visibleSalaries[rowIndex].id)) }}>Delete</button>} /></section></>}
      <FormPanel title="Family Adjustment" onSubmit={saveFamilyAdjustment} submitLabel="Save Adjustment"><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Customer / Family Account" name="customerId" options={customers.map((customer) => `${customer.id} - ${customer.name}`)} required={false} /><Field label="Amount" name="amount" type="number" defaultValue={0} /><Field label="Adjustment Type" name="adjustmentType" options={['Increase', 'Decrease']} defaultValue="Increase" /><Field label="Status" name="status" options={['Active', 'Inactive']} defaultValue="Active" /><Field label="Description" name="description" defaultValue="Family adjustment" /><Field label="Notes" name="notes" defaultValue="Adjustment note" /></FormPanel><section className="register-section"><div className="section-heading"><h3>Family Adjustment Register</h3></div><DataTable headers={['Date', 'Customer', 'Amount', 'Type', 'Status', 'Description']} rows={familyAdjustments.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to).map((entry) => [entry.date, entry.customerId ? customerName(entry.customerId) : 'General', money(entry.amount), entry.adjustmentType, entry.status, entry.description])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setFamilyAdjustments((current) => current.filter((entry) => entry.id !== familyAdjustments.filter((item) => item.date >= reportRange.from && item.date <= reportRange.to)[rowIndex].id))}>Delete</button>} /></section>
    </>
  )

  const content = selectedTab === 'Dashboard' ? dashboard :
    selectedTab === 'Fuel Management' ? fuelManagementPage :
    selectedTab === 'Customers' ? customerPage :
    selectedTab === 'Settings' ? settingsPage :
    selectedTab === 'Reports' ? reportCenterPage :
    selectedTab === 'Accounting' ? (authUser?.role === 'operator' ? <section className="register-section"><h3>Restricted</h3><p>Accounting data is available to managers and administrators.</p></section> : reportsPage) :
    selectedTab === 'Meter Reading' ? (
      <>
        <section className="register-section meter-print-register">
          <div className="section-heading"><h3>Daily Meter Reading Register</h3><button className="ghost-button" type="button" onClick={() => printDocument('Daily Meter Reading Register', `${displayDate(dashboardRange.from)} - ${displayDate(dashboardRange.to)}`)}>Print Register</button></div>
          <form className="entry-form" onSubmit={saveMeter} onReset={() => { setEditingMeter(null); setMeterDraft({ date: today, shift: 'Day', product: 'HSD', nozzle: 'HSD-1', previous: '', present: '', rate: '' }) }}>
            <div className="section-heading"><h3>{editingMeter ? 'Edit Meter Reading' : 'Enter Meter Reading'}</h3><span className="form-note">Saved on this device</span></div>
            <div className="form-grid">
              <label className="form-field"><span>Date</span><input type="date" value={meterDraft.date} onChange={(event) => setMeterDraft((current) => ({ ...current, date: event.target.value, previous: '' }))} required /></label>
              <label className="form-field"><span>Shift</span><select value={meterDraft.shift} onChange={(event) => setMeterDraft((current) => ({ ...current, shift: event.target.value, previous: '' }))} required><option value="Day">Day</option><option value="Night">Night</option></select></label>
              <label className="form-field"><span>Fuel Type</span><select value={meterDraft.product} onChange={(event) => { const product = event.target.value as Product; setMeterDraft((current) => ({ ...current, product, nozzle: productNozzles[product][0], previous: '' })) }} required>{products.map((product) => <option key={product} value={product}>{product}</option>)}</select></label>
              <label className="form-field"><span>Nozzle Number / ID</span><select value={meterDraft.nozzle} onChange={(event) => setMeterDraft((current) => ({ ...current, nozzle: event.target.value, previous: '' }))} required>{productNozzles[meterDraft.product].map((nozzle) => <option key={nozzle} value={nozzle}>{nozzle}</option>)}</select></label>
              <label className="form-field"><span>Opening Meter Reading</span><input type="number" min="0" step="any" value={previousMeterReading ? String(previousMeterReading.present) : meterDraft.previous} onChange={(event) => setMeterDraft((current) => ({ ...current, previous: event.target.value }))} readOnly={Boolean(previousMeterReading)} required /><small className="form-note">{previousMeterReading ? 'Automatically taken from the previous closing reading for this nozzle.' : 'First reading for this nozzle. Enter the opening meter manually.'}</small></label>
              <label className="form-field"><span>Closing Meter Reading</span><input type="number" min="0" step="any" value={meterDraft.present} onChange={(event) => setMeterDraft((current) => ({ ...current, present: event.target.value }))} required /></label>
              <label className="form-field"><span>Litres</span><input value={meterDraftLitres ? measurement(meterDraftLitres) : '0.00'} readOnly /></label>
              <label className="form-field"><span>Rate per Litre</span><input type="number" min="0" step="any" value={meterDraft.rate} onChange={(event) => setMeterDraft((current) => ({ ...current, rate: event.target.value }))} required /></label>
              <label className="form-field"><span>Amount</span><input value={printMoney(meterDraftAmount)} readOnly /></label>
            </div>
            <div className="form-actions"><button className="primary-button" type="submit">{editingMeter ? 'Save Changes' : 'Save Entry'}</button><button className="ghost-button" type="reset">Clear</button></div>
          </form>
        </section>
        <form className="register-section entry-form" onSubmit={saveMeterTest} onReset={() => { setEditingMeterTest(null); setMeterTestDraft({ date: today, shift: '', product: 'HSD', nozzle: 'HSD-1', quantity: '', reason: '', returnedToTank: '', reference: '', notes: '' }) }}>
          <div className="section-heading"><h3>{editingMeterTest ? 'Edit Meter Test / Calibration' : 'Meter Test / Calibration'}</h3><span className="form-note">Test fuel is not treated as a customer sale.</span></div>
          <div className="form-grid">
            <label className="form-field"><span>Date</span><input type="date" value={meterTestDraft.date} onChange={(event) => setMeterTestDraft((current) => ({ ...current, date: event.target.value }))} required /></label>
            <label className="form-field"><span>Shift</span><select value={meterTestDraft.shift} onChange={(event) => setMeterTestDraft((current) => ({ ...current, shift: event.target.value }))} required><option value="">Select shift</option><option value="Day">Day</option><option value="Night">Night</option></select></label>
            <label className="form-field"><span>Fuel Type</span><select value={meterTestDraft.product} onChange={(event) => { const product = event.target.value as Product; setMeterTestDraft((current) => ({ ...current, product, nozzle: productNozzles[product][0] })) }} required>{products.map((product) => <option key={product} value={product}>{product}</option>)}</select></label>
            <label className="form-field"><span>Nozzle</span><select value={meterTestDraft.nozzle} onChange={(event) => setMeterTestDraft((current) => ({ ...current, nozzle: event.target.value }))} required>{productNozzles[meterTestDraft.product].map((nozzle) => <option key={nozzle} value={nozzle}>{nozzle}</option>)}</select></label>
            <label className="form-field"><span>Test Quantity (L)</span><input type="number" min="0.01" step="any" value={meterTestDraft.quantity} onChange={(event) => setMeterTestDraft((current) => ({ ...current, quantity: event.target.value }))} required /></label>
            <label className="form-field"><span>Returned to Tank</span><select value={meterTestDraft.returnedToTank} onChange={(event) => setMeterTestDraft((current) => ({ ...current, returnedToTank: event.target.value }))} required><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
            <label className="form-field"><span>Reason</span><input value={meterTestDraft.reason} onChange={(event) => setMeterTestDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Meter accuracy test" /></label>
            <label className="form-field"><span>Reference</span><input value={meterTestDraft.reference} onChange={(event) => setMeterTestDraft((current) => ({ ...current, reference: event.target.value }))} /></label>
            <label className="form-field"><span>Notes</span><input value={meterTestDraft.notes} onChange={(event) => setMeterTestDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          </div>
          <div className="summary-strip"><strong>Test Sales Amount: Rs. 0.00</strong><strong>Net Stock Impact: {meterTestDraft.returnedToTank === 'No' && Number.isFinite(Number(meterTestDraft.quantity)) ? `${Number(meterTestDraft.quantity || 0).toLocaleString()} L` : '0 L'}</strong></div>
          <div className="form-actions"><button className="primary-button" type="submit">Save Meter Test</button>{editingMeterTest && <button className="ghost-button" type="button" onClick={() => { setEditingMeterTest(null); setMeterTestDraft({ date: today, shift: '', product: 'HSD', nozzle: 'HSD-1', quantity: '', reason: '', returnedToTank: '', reference: '', notes: '' }) }}>Cancel Edit</button>}<button className="ghost-button" type="reset">Clear</button></div>
        </form>
        <section className="register-section"><div className="section-heading"><h3>Meter Reading History</h3></div><DataTable headers={['Date', 'Shift', 'Nozzle', 'Fuel', 'Opening', 'Closing', 'Physical Movement', 'Test Quantity', 'Returned Test', 'Test Stock Impact', 'Actual Customer Sales', 'Rate', 'Customer Sales Amount']} rows={meters.map((meter) => {
          const summary = meterPeriodSummary(meter)
          return [meter.date, meter.shift, meter.nozzle, meter.product, measurement(meter.previous), measurement(meter.present), `${measurement(summary.physicalMovement)} L`, `${measurement(summary.testQuantity)} L`, `${measurement(summary.returnedTestQuantity)} L`, `${measurement(summary.netTestStockImpact)} L`, `${measurement(summary.actualCustomerSales)} L`, meter.rate === undefined ? '-' : printMoney(meter.rate), meter.rate === undefined ? '-' : printMoney(summary.customerSalesAmount)]
        })} actions={authUser?.role === 'operator' ? undefined : (rowIndex) => { const meter = meters[rowIndex]; return <><button className="table-action" type="button" onClick={() => editMeter(meter)}>Edit</button><button className="table-action danger-link" type="button" onClick={() => deleteMeter(meter)}>Delete</button></> }} />
          <div className="section-heading"><h3>Meter Test / Calibration History</h3></div>
          <DataTable headers={['Date', 'Shift', 'Fuel', 'Nozzle', 'Test Quantity', 'Returned to Tank', 'Net Stock Impact', 'Reason', 'Reference', 'Notes']} rows={meterTests.map((test) => [test.date, test.shift, test.product, test.nozzle, `${measurement(test.quantity)} L`, test.returnedToTank ? 'Yes' : 'No', `${measurement(test.returnedToTank ? 0 : test.quantity)} L`, test.reason || '-', test.reference || '-', test.notes || '-'])} actions={authUser?.role === 'operator' ? undefined : (rowIndex) => { const test = meterTests[rowIndex]; return <><button className="table-action" type="button" onClick={() => editMeterTest(test)}>Edit</button><button className="table-action danger-link" type="button" onClick={() => deleteMeterTest(test)}>Delete</button></> }} empty="No meter tests or calibrations recorded." />
        </section>
      </>
    ) :
    selectedTab === 'Sales' ? (
      <>
        <FormPanel title="Fuel Sale / Daily Sales Register" onSubmit={saveSale}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Product" name="product" options={products} defaultValue="HSD" /><Field label="Litres" name="litres" type="number" defaultValue={100} /><Field label="Sale Rate" name="rate" type="number" defaultValue={285} /><Field label="Payment Mode" name="mode" options={['Cash', 'Credit', 'Bank']} defaultValue="Cash" /><Field label="Payment Method" name="paymentMethod" options={['Cash', 'Card', 'Credit Card', 'Debit Card', 'Bank Transfer', 'Online Payment', 'Other']} defaultValue="Cash" /><Field label="Customer for Credit Sale" name="customerId" options={customers.map((customer) => `${customer.id} - ${customer.name}`)} required={false} /></FormPanel>
        <section className="register-section"><div className="section-heading"><h3>Fuel Sales Register</h3><input className="table-search" aria-label="Search fuel sales" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search sales" /></div><DataTable headers={['Date', 'Product', 'Litres', 'Rate', 'Amount', 'Mode', 'Customer']} rows={visibleSales.map((sale) => [sale.date, sale.product, sale.litres, money(sale.rate), money(sale.amount), sale.mode, sale.customer])} actions={authUser?.role === 'operator' ? undefined : (rowIndex) => <button className="table-action" type="button" onClick={() => deleteSale(visibleSales[rowIndex])}>Delete</button>} /></section>
      </>
    ) :
    selectedTab === 'Expenses' ? (
      <>
        <FormPanel title="Expense Register" onSubmit={saveExpense}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Category" name="category" options={['Commission', 'Salary', 'Electricity', 'Maintenance', 'Pump Expenses', 'Miscellaneous']} defaultValue="Pump Expenses" /><Field label="Description" name="description" /><Field label="Amount" name="amount" type="number" min="0.01" step="0.01" defaultValue={0} /><Field label="Paid By" name="paidBy" options={['Cash', 'Bank', 'Card', 'Credit', 'Recived Amount']} defaultValue="Cash" /></FormPanel>
        <section className="register-section"><div className="section-heading"><h3>Expense Summary</h3><input className="table-search" aria-label="Search expenses" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search expenses" /></div><DataTable headers={['Date', 'Category', 'Description', 'Amount', 'Paid By']} rows={visibleExpenses.map((expense) => [expense.date, expense.category, expense.description, money(expense.amount), expense.paidBy])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setExpenses((current) => current.filter((expense) => expense.id !== visibleExpenses[rowIndex].id))}>Delete</button>} /></section>
      </>
    ) :
    selectedTab === 'Daily Operations' ? (
      <section className="register-section module-placeholder"><h3>Daily Closing & Shift Handover</h3><p>Review the active sales, expenses, meters, and customer balances before closing the shift.</p><div className="summary-strip"><strong>Fuel Sales: {money(dailySales.reduce((sum, sale) => sum + sale.amount, 0))}</strong><strong>Fuel Litres: {dailySales.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L</strong><strong>Physical Meter Movement: {dailyPhysicalMeterMovement.toLocaleString()} L</strong><strong>Meter Test / Calibration: {dailyTestQuantity.toLocaleString()} L</strong><strong>Actual Meter Customer Movement: {dailyMeterCustomerMovement.toLocaleString()} L</strong><strong>Non-returned Test Stock Impact: {dailyNetTestStockImpact.toLocaleString()} L</strong><strong>Cash Sale: {money(dailySales.filter((sale) => sale.mode === 'Cash').reduce((sum, sale) => sum + sale.amount, 0))}</strong><strong>Customer Collections: {money(dailyCustomerPayments)}</strong><strong>Expenses: {money(dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0))}</strong><strong>Commission: {money(dailyCommission)}</strong><strong>Net Result: {money(dailySales.reduce((sum, sale) => sum + sale.amount, 0) + dailyCustomerPayments - dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0) - dailyCommission)}</strong><button className="primary-button" type="button" onClick={() => printDocument('Daily Closing Report', displayDate(currentSystemDate))}>Print Daily Closing</button></div></section>
    ) :
    selectedTab === 'Mobile Oil' ? (
      <>
        <FormPanel title="Mobile Oil Sale" onSubmit={saveOil}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Item" name="item" defaultValue="Lubricant" /><Field label="Quantity" name="quantity" type="number" defaultValue={1} /><Field label="Rate" name="rate" type="number" defaultValue={500} /></FormPanel>
        <section className="register-section"><div className="section-heading"><h3>Mobile Oil Register</h3></div><DataTable headers={['Date', 'Item', 'Qty', 'Rate', 'Amount']} rows={oilSales.map((sale) => [sale.date, sale.item, sale.quantity, money(sale.rate), money(sale.amount)])} /></section>
      </>
    ) :
    selectedTab === 'Commission' ? (
      <>
        <form className="register-section entry-form" onSubmit={saveCommission} onReset={() => { setCommissionPreviewDate(today); setCommissionPreviewProduct('HSD'); setCommissionPreviewLitres('0'); setCommissionPreviewRate('0') }}>
          <div className="section-heading"><h3>Commission Entry</h3><span className="form-note">Only explicitly entered litres receive commission</span></div>
          <div className="form-grid">
            <label className="form-field"><span>Date</span><input name="date" type="date" value={commissionPreviewDate} onChange={(event) => setCommissionPreviewDate(event.target.value)} required /></label>
            <label className="form-field"><span>Fuel Type</span><select name="product" value={commissionPreviewProduct} onChange={(event) => setCommissionPreviewProduct(event.target.value as Product)} required>{products.map((product) => <option key={product}>{product}</option>)}</select></label>
            <label className="form-field"><span>Eligible Litres Sold (Calculated)</span><input value={`${commissionDatePreview.toLocaleString()} L`} readOnly aria-describedby="commission-eligibility-help" /><small id="commission-eligibility-help">Taken from sales for the selected date and fuel type, less previous commission entries.</small></label>
            <label className="form-field"><span>Commissionable Litres (Enter Here)</span><input name="commissionableLitres" type="number" min="0" step="0.01" value={commissionPreviewLitres} onChange={(event) => setCommissionPreviewLitres(event.target.value)} required /><small>Type the litres that should receive commission.</small></label>
            <label className="form-field"><span>Commission Rate / Litre</span><input name="rate" type="number" min="0" step="0.01" value={commissionPreviewRate} onChange={(event) => setCommissionPreviewRate(event.target.value)} required /></label>
            <label className="form-field"><span>Commission Amount</span><input value={printMoney(calculateCommissionAmount(Number(commissionPreviewLitres) || 0, Number(commissionPreviewRate) || 0))} readOnly /></label>
            <label className="form-field"><span>Sales Reference</span><input name="reference" defaultValue="" /></label>
            <label className="form-field"><span>Notes</span><input name="notes" defaultValue="" /></label>
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">Save Commission</button><button className="ghost-button" type="reset">Clear</button></div>
        </form>
        <section className="register-section"><div className="section-heading"><h3>Commission Register</h3><button className="ghost-button" type="button" onClick={() => printDocument('Commission Report', `${displayDate(reportRange.from)} - ${displayDate(reportRange.to)}`)}>Print Commission</button></div><DataTable headers={['Date', 'Fuel', 'Eligible Litres', 'Commissionable Litres', 'Rate / Litre', 'Commission', 'Reference']} rows={commissionRangeRecords.map((record) => [record.date, record.product, `${record.eligibleLitres.toLocaleString()} L`, `${record.commissionableLitres.toLocaleString()} L`, money(record.rate), money(record.amount), record.reference || '-'])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setCommissionRecords((current) => current.filter((record) => record.id !== commissionRangeRecords[rowIndex].id))}>Delete</button>} /><div className="summary-strip"><strong>Total Eligible: {eligibleCommissionLitresForRange.toLocaleString()} L</strong><strong>Total Commissionable: {commissionLitresForRange.toLocaleString()} L</strong><strong>Remaining Eligible: {Math.max(0, eligibleCommissionLitresForRange - commissionLitresForRange).toLocaleString()} L</strong><strong>Total Commission: {money(commissionAmountForRange)}</strong></div></section>
      </>
    ) :
    selectedTab === 'Safety Duty' ? (
      selectedSafetyProduct ? (
        <>
          <section className="register-section safety-summary-header"><div><p className="eyebrow">{selectedSafetyProduct}</p><h3>Safety Duty Summary</h3><p className="form-note">All {selectedSafetyProduct} nozzles · {safetySummaryRange.from} - {safetySummaryRange.to}</p></div><button className="ghost-button" type="button" onClick={() => setSelectedSafetyProduct(null)}>Back to Register</button></section>
          <section className="register-section safety-summary-controls"><div className="period-picker">{['Today', 'This Week', 'Previous Week', 'Custom'].map((period) => <button key={period} type="button" className={`period-button${safetySummaryPeriod === period ? ' active' : ''}`} onClick={() => setSafetySummaryPeriod(period)}>{period}</button>)}</div>{safetySummaryPeriod === 'Custom' && <div className="period-controls"><label className="form-field"><span>From Date</span><input type="date" value={safetySummaryFrom} onChange={(event) => setSafetySummaryFrom(event.target.value)} /></label><label className="form-field"><span>To Date</span><input type="date" value={safetySummaryTo} onChange={(event) => setSafetySummaryTo(event.target.value)} /></label></div>}<div className="period-picker safety-summary-tabs"><button type="button" className={`period-button${safetySummaryView === 'Daily' ? ' active' : ''}`} onClick={() => setSafetySummaryView('Daily')}>Daily</button><button type="button" className={`period-button${safetySummaryView === 'Weekly' ? ' active' : ''}`} onClick={() => setSafetySummaryView('Weekly')}>Weekly</button></div></section>
          <section className="dashboard-grid safety-summary-metrics"><div className="metric-card"><span>Today's Total</span><strong>{safetySummaryRecords.filter((meter) => meter.date === currentSystemDate).reduce((sum, meter) => sum + meter.litres, 0).toLocaleString()} L</strong></div><div className="metric-card"><span>Selected Period Total</span><strong>{safetyTotalLitres.toLocaleString()} L</strong></div><div className="metric-card"><span>Entries</span><strong>{safetySummaryRecords.length}</strong></div><div className="metric-card"><span>Average Daily Total</span><strong>{Math.round(safetyAverageDaily).toLocaleString()} L</strong></div></section>
          <section className="register-section"><div className="section-heading"><h3>{selectedSafetyProduct} - {safetySummaryView} Summary</h3></div>{safetySummaryView === 'Daily' ? <DataTable headers={['Date', 'Opening Reading', 'Closing Reading', 'Total Litres', 'Entries', 'Daily Total']} rows={safetyDailyRows.map((row) => [row.date, row.opening, row.closing, `${row.litres.toLocaleString()} L`, row.entries, `${row.litres.toLocaleString()} L`])} empty="No safety duty records found for this product and date range." /> : <DataTable headers={['Day', 'Total Litres', 'Entries']} rows={safetyWeeklyRows.map((row) => [row.day, `${row.litres.toLocaleString()} L`, row.entries])} empty="No safety duty records found for this product and date range." />}<div className="summary-strip"><strong>{safetySummaryView === 'Daily' ? 'Daily Total' : 'Weekly Total'}: {safetyTotalLitres.toLocaleString()} Liters</strong></div></section>
        </>
      ) : (
        <section className="register-section"><div className="section-heading"><h3>Safety Duty Register</h3><span className="form-note">Summaries combine all nozzles for the selected fuel product.</span></div><DataTable headers={['Fuel Product', 'Nozzle / Duty Point', 'Present Reading', 'Previous Reading', 'Total Litres']} rows={meters.map((meter) => [meter.product, meter.nozzle, meter.present, meter.previous, `${meter.litres.toLocaleString()} L`])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => { setSelectedSafetyProduct(meters[rowIndex].product); setSafetySummaryPeriod('This Week'); setSafetySummaryView('Daily') }}>View Summary</button>} /></section>
      )
    ) : <section className="register-section module-placeholder"><h3>{selectedTab}</h3><p>This module is ready for station configuration and its register workflow.</p></section>

  return (
    !authUser ? <LoginPanel onLogin={login} error={authError} /> :
    <>
      {showChangeUsername && <div className="modal-overlay" onClick={() => { setShowChangeUsername(false); setChangeUsernameError('') }}>
        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header"><h3>Change Username</h3><button className="modal-close" type="button" onClick={() => { setShowChangeUsername(false); setChangeUsernameError('') }} aria-label="Close">×</button></div>
          <form onSubmit={handleChangeUsername}>
            <label className="form-field"><span>New Username</span><input value={changeUsername} onChange={(event) => setChangeUsername(event.target.value)} autoComplete="username" required /></label>
            <label className="form-field"><span>Current Password</span><input type="password" value={changeUsernamePassword} onChange={(event) => setChangeUsernamePassword(event.target.value)} autoComplete="current-password" required /></label>
            {changeUsernameError && <p className="form-error" style={{ marginTop: '10px' }}>{changeUsernameError}</p>}
            <div className="form-actions" style={{ marginTop: '14px' }}><button className="ghost-button" type="button" onClick={() => { setShowChangeUsername(false); setChangeUsernameError('') }}>Cancel</button><button className="primary-button" type="submit">Change Username</button></div>
          </form>
        </div>
      </div>}
      {showChangePassword && <div className="modal-overlay" onClick={() => { setShowChangePassword(false); setChangePasswordError(''); setChangePasswordSuccess(false) }}>
        <div className="modal-card" onClick={(event) => event.stopPropagation()}>
          {changePasswordSuccess ? (
            <div className="modal-card" style={{ textAlign: 'center', padding: '36px 32px' }}>
              <p style={{ color: '#15803d', fontSize: '1.1rem', fontWeight: 700 }}>✓ Password changed successfully.</p>
              <p style={{ color: '#526072', fontSize: '0.85rem', marginTop: '8px' }}>You will need to log in again using your new password.</p>
            </div>
          ) : (
            <>
              <div className="modal-header"><h3>Change Password</h3><button className="modal-close" type="button" onClick={() => { setShowChangePassword(false); setChangePasswordError(''); setChangePasswordSuccess(false) }} aria-label="Close">×</button></div>
              <form onSubmit={handleChangePassword}>
                <label className="form-field">
                  <span>Current Password</span>
                  <div className="password-field">
                    <input type={showOldPassword ? 'text' : 'password'} value={changePasswordOld} onChange={(event) => setChangePasswordOld(event.target.value)} placeholder="Enter current password" autoComplete="current-password" required />
                    <button type="button" className="password-toggle" onClick={() => setShowOldPassword((v) => !v)} aria-label="Toggle password visibility">{showOldPassword ? '🙈' : '👁'}</button>
                  </div>
                </label>
                <label className="form-field">
                  <span>New Password</span>
                  <div className="password-field">
                    <input type={showNewPassword ? 'text' : 'password'} value={changePasswordNew} onChange={(event) => setChangePasswordNew(event.target.value)} placeholder="Enter new password" autoComplete="new-password" required />
                    <button type="button" className="password-toggle" onClick={() => setShowNewPassword((v) => !v)} aria-label="Toggle password visibility">{showNewPassword ? '🙈' : '👁'}</button>
                  </div>
                </label>
                <label className="form-field">
                  <span>Confirm New Password</span>
                  <div className="password-field">
                    <input type={showConfirmPassword ? 'text' : 'password'} value={changePasswordConfirm} onChange={(event) => setChangePasswordConfirm(event.target.value)} placeholder="Confirm new password" autoComplete="new-password" required />
                    <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword((v) => !v)} aria-label="Toggle password visibility">{showConfirmPassword ? '🙈' : '👁'}</button>
                  </div>
                </label>
                {changePasswordError && <p className="form-error" style={{ marginTop: '10px' }}>{changePasswordError}</p>}
                <div className="form-actions" style={{ marginTop: '14px' }}>
                  <button className="ghost-button" type="button" onClick={() => { setShowChangePassword(false); setChangePasswordError(''); setChangePasswordSuccess(false) }}>Cancel</button>
                  <button className="primary-button" type="submit">Change Password</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>}
      <div className="ppms-app">
        {mobileMenuOpen && <button type="button" className="mobile-nav-overlay" aria-label="Close navigation menu" onClick={() => setMobileMenuOpen(false)} />}
        <aside className={`sidebar${mobileMenuOpen ? ' mobile-open' : ''}`}>
          <div className="brand"><span className="brand-mark">P</span><div><strong>PPMS</strong><small>EKHWAN - 1 Filling Station</small></div></div>
          <nav className="nav" aria-label="PPMS modules">
            {navigationGroups.map((group) => {
              const visibleTabs = group.tabs.filter((tab) => (tab !== 'Settings' && tab !== 'Accounting') || authUser.role !== 'operator')
              if (!visibleTabs.length) return null
              return <div className="nav-section" key={group.label}><h3>{group.label}</h3>{visibleTabs.map((tab) => <button key={tab} type="button" className={`nav-item${selectedTab === tab ? ' active' : ''}`} aria-current={selectedTab === tab ? 'page' : undefined} onClick={() => go(tab)}><span className="nav-indicator" aria-hidden="true" />{tab}</button>)}</div>
            })}
          </nav>
          <div className="sidebar-footer">
            <div className="sidebar-system-state"><span className={`status-dot${systemStatus?.databaseExists === false ? ' offline' : ''}`} /><div><strong>{systemStatus?.databaseExists ? 'Database ready' : systemStatus ? 'Database unavailable' : 'Local system'}</strong><small>{systemStatus ? `Version ${systemStatus.version}` : 'On-device register'}</small></div></div>
            <div className="sidebar-user"><span className="user-avatar">{authUser.username.slice(0, 2).toUpperCase()}</span><div><strong>{authUser.username}</strong><small>{authUser.role}</small></div></div>
            <button className="sign-out-button" type="button" onClick={logout}>Sign Out</button>
          </div>
        </aside>
        <main key={selectedTab} className="main-panel">
          <header className="topbar">
            <div className="topbar-heading"><button type="button" className="mobile-menu-button" aria-label="Open navigation menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>Menu</button><div><p className="eyebrow">EKHWAN - 1 <span>/</span> {selectedTab === 'Customers' ? 'Companies & Customers' : selectedTab}</p><h2>{selectedTab === 'Dashboard' ? 'Dashboard' : selectedTab}</h2><p className="topbar-subtitle">{selectedTab === 'Dashboard' ? 'Station operations overview' : 'Petrol Pump Management System'}</p></div></div>
            <div className="topbar-actions"><span className={`topbar-system-state${systemStatus?.databaseExists === false ? ' offline' : ''}`}><span className="status-dot" />{systemStatus?.databaseExists ? 'Local database ready' : systemStatus ? 'Database unavailable' : 'Local system'}</span><button type="button" className="ghost-button" onClick={() => go('Daily Operations')}>Daily Closing</button><button type="button" className="primary-button" onClick={() => printDocument(selectedTab === 'Dashboard' ? 'Daily Dashboard Summary' : `${selectedTab} Report`)}>Print Report</button><div className="topbar-user"><span className="user-avatar">{authUser.username.slice(0, 2).toUpperCase()}</span><div><strong>{authUser.username}</strong><small>{authUser.role}</small></div></div></div>
          </header>
          {notice && <div className="toast" role="alert" aria-live="assertive">{notice}</div>}
          <div className="page-title"><span>Working Register</span><strong>{selectedTab}</strong></div>
          {content}
          {printRequest && <PrintDocument request={printRequest} rows={printableReport.rows} headers={printableReport.headers} summary={printableReport.summary} />}
        </main>
      </div>
    </>
  )
}