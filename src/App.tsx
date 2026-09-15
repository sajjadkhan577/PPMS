import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import './styles.css'
import { calculateCommissionAmount, calculateDiscountAmount, calculateFuelStockSummary, calculatePaymentFee, getCommissionTotal, getDashboardSummary } from './lib/ppms'
import { createBackup, readStored, restoreBackup, writeStored } from './lib/storage'

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
}
type Customer = { id: number; name: string; phone: string; address: string; openingBalance: number }
type UdharTransaction = { id: number; date: string; customerId: number; type: 'Opening Balance' | 'Credit Sale' | 'Payment Received' | 'Adjustment'; reference: string; description: string; debit: number; credit: number }
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
type BackupInfo = { name: string; createdAt: string; modifiedAt: string; size: number }

function clearLaunchSession() {
  localStorage.removeItem('ppms-session-token')
  localStorage.removeItem('ppms-session-user')
}

const tabs = ['Dashboard', 'Daily Operations', 'Meter Reading', 'Fuel Management', 'Sales', 'Customers', 'Expenses', 'Mobile Oil', 'Commission', 'Safety Duty', 'Reports', 'Accounting', 'Settings']
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
const initialSales: Sale[] = [
  { id: 1, date: today, product: 'HSD', litres: 3080, rate: 285, amount: 877800, mode: 'Cash', customer: '-', discountAmount: 0 },
  { id: 2, date: today, product: 'PMG', litres: 1420, rate: 280, amount: 397600, mode: 'Credit', customer: 'Al-Rehman Transport', customerId: 1, discountAmount: 0 },
]
const initialCustomers: Customer[] = [
  { id: 1, name: 'Al-Rehman Transport', phone: '0300-1234567', address: '', openingBalance: 120000 },
  { id: 2, name: 'Khan Traders', phone: '0321-5550199', address: '', openingBalance: 45000 },
]
const initialUdhar: UdharTransaction[] = [
  { id: 1, date: '2026-09-01', customerId: 1, type: 'Opening Balance', reference: 'OB-001', description: 'Opening balance', debit: 120000, credit: 0 },
  { id: 2, date: today, customerId: 1, type: 'Credit Sale', reference: 'SALE-2', description: 'PMG 1,420 litres', debit: 397600, credit: 0 },
  { id: 3, date: today, customerId: 1, type: 'Payment Received', reference: 'RCV-001', description: 'Cash received', debit: 0, credit: 250000 },
  { id: 4, date: '2026-09-01', customerId: 2, type: 'Opening Balance', reference: 'OB-002', description: 'Opening balance', debit: 45000, credit: 0 },
  { id: 5, date: today, customerId: 2, type: 'Credit Sale', reference: 'SALE-003', description: 'Fuel credit sale', debit: 125000, credit: 0 },
  { id: 6, date: today, customerId: 2, type: 'Payment Received', reference: 'RCV-002', description: 'Cash received', debit: 0, credit: 90000 },
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
]

const API_URL = 'http://localhost:8787'

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('ppms-session-token')
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error || 'Request failed.')
  return payload
}

function useStored<T>(key: string, initial: T, normalize: (value: unknown) => T = (value) => value as T) {
  const remoteToken = localStorage.getItem('ppms-session-token')
  const [remoteReady, setRemoteReady] = useState(!remoteToken)
  const [value, setValue] = useState<T>(() => {
    return readStored(localStorage, `ppms-${key}`, initial, normalize)
  })
  useEffect(() => {
    if (!remoteToken) return
    apiRequest<{ value: unknown }>(`/api/state/${key}`).then((payload) => {
      if (payload.value !== null) setValue(normalize(payload.value))
    }).catch(() => undefined).finally(() => setRemoteReady(true))
  }, [key, remoteToken])
  useEffect(() => {
    if (!remoteReady) return
    writeStored(localStorage, `ppms-${key}`, value)
    window.dispatchEvent(new Event(`ppms-${key}-updated`))
    if (remoteToken) apiRequest(`/api/state/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }).catch(() => undefined)
  }, [key, remoteReady, remoteToken, value])
  return [value, setValue] as const
}

function LoginPanel({ onLogin, error }: { onLogin: (username: string, password: string) => void; error: string }) {
  return <main className="login-panel"><div className="login-card"><span className="brand-mark">A</span><p className="eyebrow">Petrol Pump Management System</p><h1>Operator Sign In</h1><p>Use an authenticated PPMS account to access station registers.</p><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onLogin(String(data.get('username')), String(data.get('password'))) }}><label className="form-field"><span>Username</span><input name="username" autoComplete="username" required /></label><label className="form-field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">Sign In</button></form></div></main>
}

const money = (value: number) => `Rs. ${Math.round(value).toLocaleString('en-PK')}`
const printMoney = (value: number) => `Rs. ${value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const numberValue = (value: FormDataEntryValue | null) => Number(value) || 0

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

function resolveDateRange(period: string, customFrom: string, customTo: string, currentDate = getSystemDate()) {
  if (period === 'Today') return { from: currentDate, to: currentDate }
  if (period === 'Yesterday') {
    const yesterday = new Date(`${currentDate}T00:00:00`)
    yesterday.setDate(yesterday.getDate() - 1)
    const date = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    return { from: date, to: date }
  }
  if (period === 'This Week') {
    const current = new Date(`${currentDate}T00:00:00`)
    const day = current.getDay()
    const diff = (day === 0 ? 6 : day - 1)
    current.setDate(current.getDate() - diff)
    return { from: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`, to: currentDate }
  }
  if (period === 'This Month') return { from: `${currentDate.slice(0, 7)}-01`, to: currentDate }
  if (period === 'Last Month') {
    const first = new Date(`${currentDate.slice(0, 7)}-01T00:00:00`)
    first.setMonth(first.getMonth() - 1)
    const month = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`
    const last = new Date(`${currentDate.slice(0, 7)}-01T00:00:00`)
    last.setDate(0)
    return { from: `${month}-01`, to: `${month}-${String(last.getDate()).padStart(2, '0')}` }
  }
  if (period === 'This Year') return { from: `${currentDate.slice(0, 4)}-01-01`, to: currentDate }
  return { from: customFrom || currentDate, to: customTo || currentDate }
}

function Field({ label, name, type = 'text', defaultValue, options, required = true }: { label: string; name: string; type?: string; defaultValue?: string | number; options?: string[]; required?: boolean }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {options ? (
        <select name={name} defaultValue={defaultValue} required={required}>
          <option value="">Select</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input name={name} type={type} defaultValue={defaultValue} required={required} />
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
  const [meters, setMeters] = useStored<MeterReading[]>('meters', initialMeters)
  const [sales, setSales] = useStored<Sale[]>('sales', initialSales)
  const [customers, setCustomers] = useStored<Customer[]>('customers', initialCustomers, (value) => Array.isArray(value) ? value.map((item) => {
    const legacy = item as Partial<Customer> & { opening?: number }
    return { id: Number(legacy.id), name: String(legacy.name || ''), phone: String(legacy.phone || ''), address: String(legacy.address || ''), openingBalance: Number(legacy.openingBalance ?? legacy.opening ?? 0) }
  }) : initialCustomers)
  const [udhar, setUdhar] = useStored<UdharTransaction[]>('udhar-transactions', initialUdhar)
  const [expenses, setExpenses] = useStored<Expense[]>('expenses', [])
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
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState(false)
  const [changePasswordOld, setChangePasswordOld] = useState('')
  const [changePasswordNew, setChangePasswordNew] = useState('')
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('')
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  useEffect(() => {
    clearLaunchSession()
  }, [])

  useEffect(() => {
    if (!authUser || !localStorage.getItem('ppms-session-token')) return
    const loadSystem = () => {
      apiRequest<SystemStatus>('/api/system/status').then(setSystemStatus).catch(() => undefined)
      apiRequest<{ backups: BackupInfo[] }>('/api/system/backups').then((payload) => setBackups(payload.backups)).catch(() => undefined)
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
  const backupDatabase = () => apiRequest<{ name: string }>('/api/system/backup', { method: 'POST' }).then((payload) => { flash(`Database backup created: ${payload.name}`); return apiRequest<{ backups: BackupInfo[] }>('/api/system/backups') }).then((payload) => setBackups(payload.backups)).catch((error: Error) => flash(error.message))
  const restoreDatabase = (name: string) => {
    if (!window.confirm(`Restore ${name}? A safety backup will be created first.`)) return
    apiRequest<{ restored: string; safetyBackup: string }>('/api/system/restore', { method: 'POST', body: JSON.stringify({ name }) }).then((payload) => { flash(`Database restored. Safety backup: ${payload.safetyBackup}`); window.setTimeout(() => window.location.reload(), 500) }).catch((error: Error) => flash(error.message))
  }

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const go = (tab: string) => { setSelectedTab(tab); setNotice(''); setMobileMenuOpen(false) }
  const customerName = (id: number) => customers.find((customer) => customer.id === id)?.name || 'Unknown customer'
  const downloadBackup = () => {
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
    file.text().then((backup) => {
      restoreBackup(localStorage, backup, STORAGE_KEYS)
      window.location.reload()
    }).catch(() => flash('Backup restore failed. Select a valid PPMS backup file.'))
  }
  const resetRegisterData = () => {
    if (!window.confirm('Reset all register data to empty? User accounts will be kept.')) return
    setMeters([])
    setSales([])
    setCustomers([])
    setUdhar([])
    setExpenses([])
    setPurchases([])
    setOilSales([])
    setCommissionRecords([])
    setDiscountRules([])
    setPaymentFees([])
    setStockAdjustments([])
    setBankAccounts([])
    setBrsRecords([])
    setFamilyAdjustments([])
    setEmployeeSalaries([])
    setStockOpenings({ HSD: 0, PMG: 0, XTRON: 0 })
    setStatementCustomerId(0)
    flash('All register data was reset. User accounts were kept.')
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
  const loadUsers = () => { if (authUser?.role === 'admin') apiRequest<{ users: SessionUser[] }>('/api/users').then((payload) => setUsers(payload.users)).catch(() => undefined) }
  const saveUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    apiRequest('/api/users', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password'), role: data.get('role') }) }).then(() => { event.currentTarget.reset(); loadUsers(); flash('User account created.') }).catch((error: Error) => flash(error.message))
  }
  const reportRange = useMemo(() => resolveDateRange(reportPeriod, reportCustomFrom, reportCustomTo, currentSystemDate), [currentSystemDate, reportCustomFrom, reportCustomTo, reportPeriod])
  const meterSales = useMemo<Sale[]>(() => meters.filter((meter) => meter.product === 'XTRON' && meter.rate !== undefined).map((meter) => ({ id: -meter.id, date: meter.date, product: meter.product, litres: meter.litres, rate: meter.rate || 0, amount: meter.amount ?? meter.litres * (meter.rate || 0), mode: 'Cash', customer: '-', discountAmount: 0 })), [meters])
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

  const dashboardRange = useMemo(() => resolveDateRange(dashboardPeriod, dashboardCustomFrom, dashboardCustomTo, currentSystemDate), [currentSystemDate, dashboardCustomFrom, dashboardCustomTo, dashboardPeriod])
  const dashboardSummary = useMemo(
    () => getDashboardSummary({ startDate: dashboardRange.from, endDate: dashboardRange.to, sales: fuelSales, expenses, udhar, commission: commissionRecords }),
    [commissionRecords, dashboardRange, expenses, fuelSales, udhar],
  )
  const dailySales = fuelSales.filter((sale) => sale.date === currentSystemDate)
  const dailyExpenses = expenses.filter((expense) => expense.date === currentSystemDate && expense.category !== 'Commission')
  const dailyCommission = getCommissionTotal({ startDate: currentSystemDate, endDate: currentSystemDate, records: commissionRecords })

  const safetySummaryRange = useMemo(() => {
    if (safetySummaryPeriod === 'Today') return { from: currentSystemDate, to: currentSystemDate }
    if (safetySummaryPeriod === 'This Week') return resolveDateRange('This Week', '', '', currentSystemDate)
    if (safetySummaryPeriod === 'Previous Week') {
      const thisWeek = resolveDateRange('This Week', '', '', currentSystemDate)
      const previousWeekEnd = new Date(`${thisWeek.from}T00:00:00`)
      previousWeekEnd.setDate(previousWeekEnd.getDate() - 1)
      const previousWeekDate = `${previousWeekEnd.getFullYear()}-${String(previousWeekEnd.getMonth() + 1).padStart(2, '0')}-${String(previousWeekEnd.getDate()).padStart(2, '0')}`
      return resolveDateRange('This Week', '', '', previousWeekDate)
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
      const adjustment = stockAdjustments.filter((entry) => entry.product === product).reduce((sum, entry) => sum + entry.quantity, 0)
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
  }, [fuelSales, purchases, stockAdjustments, stockOpenings])

  const statementEntries = udhar.filter((item) => item.customerId === statementCustomerId && item.date <= statementDate).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const statementBalance = statementEntries.reduce((balance, item) => balance + item.debit - item.credit, 0)
  const activeBankAccounts = bankAccounts.filter((account) => account.active !== false)
  const bankAccountLabel = (account: BankAccount) => `${account.bankName} - ${account.accountName}`
  const brsBankName = (entry: BRSRecord) => {
    const account = bankAccounts.find((item) => item.id === entry.bankAccountId)
    return account ? bankAccountLabel(account) : entry.legacyBankName || 'Unlinked bank'
  }

  const reportOptions = [
    ['Operations', 'Daily Sales'], ['Operations', 'Fuel Sales'], ['Operations', 'Meter Reading'], ['Operations', 'Fuel Stock'], ['Operations', 'Fuel Purchase'], ['Operations', 'Mobile Oil'],
    ['Financial', 'Expenses'], ['Financial', 'Profit & Loss'], ['Financial', 'Customer / Udhar'], ['Financial', 'Bank / BRS'], ['Financial', 'Daily Closing'],
    ['Summary', 'Monthly Summary'], ['Summary', 'Yearly Summary'],
  ]
  const reportFuelRows = products.map((product) => {
    const rows = filteredSales.filter((sale) => sale.product === product)
    return [product, `${rows.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L`, rows.length ? printMoney(rows.reduce((sum, sale) => sum + sale.amount, 0) / rows.length / (rows.reduce((sum, sale) => sum + sale.litres, 0) / rows.length || 1)) : printMoney(0), printMoney(rows.reduce((sum, sale) => sum + sale.amount, 0)), rows.length]
  })
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
    if (selectedReport === 'Meter Reading') return { title: 'Meter Reading Report', description: 'Daily nozzle meter readings for the selected period.', headers: ['Date', 'Fuel', 'Nozzle', 'Opening', 'Closing', 'Litres', 'Rate', 'Amount'], rows: filteredMeters.map((meter) => [meter.date, meter.product, meter.nozzle, meter.previous, meter.present, meter.litres, meter.rate === undefined ? '-' : printMoney(meter.rate), meter.amount === undefined ? '-' : printMoney(meter.amount)]), summary: [['Total Litres', `${filteredMeters.reduce((sum, meter) => sum + meter.litres, 0).toLocaleString()} L`], ['Total Amount', printMoney(filteredMeters.reduce((sum, meter) => sum + (meter.amount || 0), 0))]] as [string, string][] }
    if (selectedReport === 'Fuel Stock') return { title: 'Fuel Stock Report', description: 'Opening stock, movement, adjustments, and calculated closing stock.', headers: ['Fuel', 'Opening', 'Purchases', 'Sales', 'Adjustments', 'Closing Stock'], rows: fuelStockRows.map((row) => [row.product, `${row.opening.toLocaleString()} L`, `${row.purchased.toLocaleString()} L`, `${row.sold.toLocaleString()} L`, `${row.adjustment.toLocaleString()} L`, `${row.remaining.toLocaleString()} L`]) }
    if (selectedReport === 'Fuel Purchase') return { title: 'Fuel Purchase Report', description: 'Fuel received from suppliers during the selected period.', headers: ['Date', 'Supplier', 'Fuel', 'Litres', 'Rate', 'Amount'], rows: filteredPurchases.map((purchase) => [purchase.date, purchase.supplier, purchase.product, purchase.litres, printMoney(purchase.rate), printMoney(purchase.amount)]), summary: [['Total Purchased', `${filteredPurchases.reduce((sum, purchase) => sum + purchase.litres, 0).toLocaleString()} L`], ['Total Amount', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))]] as [string, string][] }
    if (selectedReport === 'Expenses') return { title: 'Expense Report', description: 'Operating expenses recorded during the selected period.', headers: ['Category', 'Transactions', 'Total Amount'], rows: [['Salaries', filteredExpenses.filter((expense) => expense.category === 'Salary').length, printMoney(filteredExpenses.filter((expense) => expense.category === 'Salary').reduce((sum, expense) => sum + expense.amount, 0))], ['Electricity', filteredExpenses.filter((expense) => expense.category === 'Electricity').length, printMoney(filteredExpenses.filter((expense) => expense.category === 'Electricity').reduce((sum, expense) => sum + expense.amount, 0))], ['Pump Expenses', filteredExpenses.filter((expense) => expense.category === 'Pump Expenses').length, printMoney(filteredExpenses.filter((expense) => expense.category === 'Pump Expenses').reduce((sum, expense) => sum + expense.amount, 0))], ['Commission', commissionRangeRecords.length, printMoney(totalCommission)], ['Other Expenses', filteredExpenses.filter((expense) => !['Salary', 'Electricity', 'Pump Expenses'].includes(expense.category)).length, printMoney(filteredExpenses.filter((expense) => !['Salary', 'Electricity', 'Pump Expenses'].includes(expense.category)).reduce((sum, expense) => sum + expense.amount, 0))]], summary: [['Total Operating Expenses', printMoney(operatingExpenses)]] as [string, string][] }
    if (selectedReport === 'Profit & Loss') return { title: 'Profit & Loss Report', description: 'Revenue, cost of goods, and operating result.', headers: ['Section', 'Amount'], rows: [['Fuel Sales', printMoney(totalSales)], ['Mobile Oil Sales', printMoney(oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).reduce((sum, sale) => sum + sale.amount, 0))], ['Fuel Purchases / Cost', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))], ['Gross Profit', printMoney(totalSales - filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))], ['Commission', printMoney(totalCommission)], ['Other Operating Expenses', printMoney(totalExpenses)], ['Net Profit / Result', printMoney(totalSales - filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0) - operatingExpenses)]] }
    if (selectedReport === 'Customer / Udhar') return { title: 'Customer / Udhar Report', description: 'Credit sales, collections, and outstanding balances.', headers: ['Customer', 'Credit Sales', 'Collections', 'Outstanding'], rows: customers.map((customer) => { const credit = filteredUdhar.filter((entry) => entry.customerId === customer.id && entry.type === 'Credit Sale').reduce((sum, entry) => sum + entry.debit, 0); const collections = filteredUdhar.filter((entry) => entry.customerId === customer.id && entry.type === 'Payment Received').reduce((sum, entry) => sum + entry.credit, 0); return [customer.name, printMoney(credit), printMoney(collections), printMoney(credit - collections)] }), summary: [['Credit Sales', printMoney(filteredUdhar.filter((entry) => entry.type === 'Credit Sale').reduce((sum, entry) => sum + entry.debit, 0))], ['Collections', printMoney(filteredUdhar.filter((entry) => entry.type === 'Payment Received').reduce((sum, entry) => sum + entry.credit, 0))]] as [string, string][] }
    if (selectedReport === 'Bank / BRS') return { title: 'Bank Reconciliation Statement', description: 'Bank transactions and reconciliation differences.', headers: ['Date', 'Bank', 'Type', 'Reference', 'PPMS Amount', 'Bank Amount', 'Difference', 'Status'], rows: brsRecords.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to).map((entry) => [entry.date, brsBankName(entry), entry.type, entry.reference, printMoney(entry.amount), printMoney(entry.bankAmount || 0), printMoney(entry.difference ?? entry.amount - (entry.bankAmount || 0)), entry.status]) }
    if (selectedReport === 'Mobile Oil') return { title: 'Mobile Oil Report', description: 'Mobile oil sales recorded during the selected period.', headers: ['Date', 'Item', 'Quantity', 'Rate', 'Amount'], rows: oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).map((sale) => [sale.date, sale.item, sale.quantity, printMoney(sale.rate), printMoney(sale.amount)]), summary: [['Total Revenue', printMoney(oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).reduce((sum, sale) => sum + sale.amount, 0))]] as [string, string][] }
    if (selectedReport === 'Daily Closing') return { title: 'Daily Closing Report', description: 'Daily operational and financial closing summary.', headers: ['Metric', 'Value'], rows: [['Fuel Sales', printMoney(totalSales)], ['Fuel Litres', `${totalLitres.toLocaleString()} L`], ['Expenses', printMoney(totalExpenses)], ['Commission', printMoney(totalCommission)], ['Net Result', printMoney(totalSales - operatingExpenses)]] }
    if (selectedReport === 'Monthly Summary' || selectedReport === 'Yearly Summary') return { title: selectedReport, description: 'Period performance summarized by month.', headers: ['Month', 'Sales', 'Litres', 'Purchases', 'Expenses', 'Commission', 'Net Result'], rows: monthlySummaryRows, summary: [['Total Sales', printMoney(totalSales)], ['Total Purchases', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0))], ['Total Expenses', printMoney(operatingExpenses)], ['Net Result', printMoney(totalSales - filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0) - operatingExpenses)]] as [string, string][] }
    return { title: 'Daily Sales Report', description: 'Business sales and fuel performance for the selected period.', headers: ['Date', 'Fuel Type', 'Litres', 'Rate', 'Sales Amount', 'Payment Type'], rows: filteredSales.map((sale) => [sale.date, sale.product, sale.litres, printMoney(sale.rate), printMoney(sale.amount), sale.mode]), summary: [['Total Sales', printMoney(totalSales)], ['Total Litres', `${totalLitres.toLocaleString()} L`], ...products.map((product) => [`${product} Sales`, printMoney(filteredSales.filter((sale) => sale.product === product).reduce((sum, sale) => sum + sale.amount, 0))]), ['Cash Sales', printMoney(filteredSales.filter((sale) => sale.mode === 'Cash').reduce((sum, sale) => sum + sale.amount, 0))], ['Credit / Udhar Sales', printMoney(filteredSales.filter((sale) => sale.mode === 'Credit').reduce((sum, sale) => sum + sale.amount, 0))]] as [string, string][] }
  })()

  const printableReport = (() => {
    const period = selectedTab === 'Dashboard' ? `${displayDate(dashboardRange.from)} - ${displayDate(dashboardRange.to)}` : `${displayDate(reportRange.from)} - ${displayDate(reportRange.to)}`
    if (selectedTab === 'Reports') return { title: reportData.title, period, headers: reportData.headers, rows: reportData.rows, summary: reportData.summary }
    if (printRequest?.title === 'Bank Reconciliation Statement') return { title: printRequest.title, period, headers: ['Date', 'Bank Account', 'Type', 'Reference', 'Description', 'PPMS Amount', 'Bank Amount', 'Difference', 'Status'], rows: brsRecords.map((entry) => [entry.date, brsBankName(entry), entry.type, entry.reference, entry.description, printMoney(entry.amount), printMoney(entry.bankAmount || 0), printMoney(entry.difference ?? entry.amount - (entry.bankAmount || 0)), entry.status]), summary: [['Total PPMS Amount', printMoney(brsRecords.reduce((sum, entry) => sum + entry.amount, 0))], ['Total Bank Amount', printMoney(brsRecords.reduce((sum, entry) => sum + (entry.bankAmount || 0), 0))], ['Total Difference', printMoney(brsRecords.reduce((sum, entry) => sum + (entry.difference ?? entry.amount - (entry.bankAmount || 0)), 0))]] as [string, string][] }
    if (selectedTab === 'Meter Reading') return { title: 'Daily Meter Reading Register', period, headers: ['Date', 'Nozzle', 'Fuel', 'Opening', 'Closing', 'Litres Sold', 'Rate', 'Amount'], rows: filteredMeters.map((meter) => [meter.date, meter.nozzle, meter.product, meter.previous, meter.present, meter.litres, meter.rate === undefined ? '-' : printMoney(meter.rate), meter.amount === undefined ? '-' : printMoney(meter.amount)]), summary: [['Total Litres Sold', `${filteredMeters.reduce((sum, meter) => sum + meter.litres, 0).toLocaleString()} L`], ['Total Amount', printMoney(filteredMeters.reduce((sum, meter) => sum + (meter.amount || 0), 0))]] as [string, string][] }
    if (selectedTab === 'Fuel Management') return { title: 'Fuel Purchase & Stock Report', period, headers: ['Fuel', 'Opening', 'Purchases', 'Sales', 'Adjustments', 'Closing Stock'], rows: fuelStockRows.map((row) => [row.product, row.opening, row.purchased, row.sold, row.adjustment, row.remaining]) }
    if (selectedTab === 'Sales') return { title: 'Fuel Sales Report', period, headers: ['Date', 'Fuel', 'Litres', 'Rate', 'Amount', 'Payment Type', 'Customer'], rows: filteredSales.map((sale) => [sale.date, sale.product, sale.litres, printMoney(sale.rate), printMoney(sale.amount), sale.mode, sale.customer]), summary: [['Total Sales', printMoney(filteredSales.reduce((sum, sale) => sum + sale.amount, 0))], ['Total Litres', `${filteredSales.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L`]] as [string, string][] }
    if (selectedTab === 'Expenses') return { title: 'Daily Expense Report', period, headers: ['Date', 'Category', 'Description', 'Amount', 'Paid By'], rows: filteredExpenses.map((expense) => [expense.date, expense.category, expense.description, printMoney(expense.amount), expense.paidBy]), summary: [['Total Expenses', printMoney(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0))]] as [string, string][] }
    if (selectedTab === 'Mobile Oil') return { title: 'Mobile Oil Sales Report', period, headers: ['Date', 'Item', 'Quantity', 'Rate', 'Amount'], rows: oilSales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to).map((sale) => [sale.date, sale.item, sale.quantity, printMoney(sale.rate), printMoney(sale.amount)]) }
    if (selectedTab === 'Commission') return { title: 'Commission Report', period, headers: ['Date', 'Fuel', 'Eligible Litres', 'Commissionable Litres', 'Rate / Litre', 'Commission'], rows: commissionRangeRecords.map((record) => [record.date, record.product, `${record.eligibleLitres.toLocaleString()} L`, `${record.commissionableLitres.toLocaleString()} L`, printMoney(record.rate), printMoney(record.amount)]), summary: [['Total Eligible Litres', `${eligibleCommissionLitresForRange.toLocaleString()} L`], ['Total Commissionable Litres', `${commissionLitresForRange.toLocaleString()} L`], ['Remaining Eligible Litres', `${Math.max(0, eligibleCommissionLitresForRange - commissionLitresForRange).toLocaleString()} L`], ['Total Commission', printMoney(commissionAmountForRange)]] as [string, string][] }
    if (selectedTab === 'Safety Duty') return { title: 'Safety Duty Register', period, headers: ['Nozzle', 'Fuel', 'Opening', 'Closing', 'Total Litres'], rows: meters.map((meter) => [meter.nozzle, meter.product, meter.previous, meter.present, meter.litres]) }
    if (selectedTab === 'Customers') return { title: 'Customer Ledger / Customer Statement', period: displayDate(statementDate), headers: ['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Description'], rows: statementEntries.map((entry) => [entry.date, entry.type, entry.reference, printMoney(entry.debit), printMoney(entry.credit), entry.description]), summary: [['Closing Balance', printMoney(statementBalance)]] as [string, string][] }
    if (selectedTab === 'Reports' || selectedTab === 'Accounting') return { title: selectedTab === 'Accounting' ? 'Accounting / Cash Book Report' : 'Monthly Financial & Operations Report', period, headers: ['Ledger', 'Total', 'Notes'], rows: [['Fuel Sales', printMoney(filteredSales.reduce((sum, sale) => sum + sale.amount, 0)), 'Gross fuel revenue'], ['Fuel Purchases', printMoney(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0)), 'Stock procurement'], ['Expenses', printMoney(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)), 'Operating costs'], ['Commission', printMoney(commissionAmountForRange), 'Recorded commission expense']] }
    if (selectedTab === 'Daily Operations') return { title: 'Daily Closing Report', period: displayDate(currentSystemDate), headers: ['Metric', 'Value'], rows: [['Fuel Sales', printMoney(dailySales.reduce((sum, sale) => sum + sale.amount, 0))], ['Fuel Litres', `${dailySales.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L`], ['Expenses', printMoney(dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0))], ['Commission', printMoney(dailyCommission)], ['Net Result', printMoney(dailySales.reduce((sum, sale) => sum + sale.amount, 0) - dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0) - dailyCommission)]] }
    return { title: 'Daily Dashboard Summary', period, headers: ['Metric', 'Value'], rows: [['Fuel Sales', printMoney(dashboardSummary.totalSales)], ['Fuel Litres Sold', `${dashboardSummary.totalFuelLitres.toLocaleString()} L`], ...products.map((product) => [product, printMoney(fuelSales.filter((sale) => sale.product === product && sale.date >= dashboardRange.from && sale.date <= dashboardRange.to).reduce((sum, sale) => sum + sale.amount, 0))]), ['Expenses', printMoney(dashboardSummary.operatingExpenses)], ['Sales Less Expenses', printMoney(dashboardSummary.netSales)]] }
  })()

  const saveMeter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const previous = numberValue(data.get('previous'))
    const present = numberValue(data.get('present'))
    const rate = numberValue(data.get('rate'))
    const product = String(data.get('product')) as Product
    const nozzle = String(data.get('nozzle'))
    const date = String(data.get('date'))
    const shift = String(data.get('shift'))
    if (previous < 0) return flash('Opening meter reading cannot be negative.')
    if (rate < 0) return flash('Rate cannot be negative.')
    if (present < previous) return flash('Present reading cannot be less than previous reading.')
    if (!productNozzles[product].includes(nozzle)) return flash(`${nozzle} does not belong to ${product}.`)
    if (meters.some((meter) => meter.date === date && meter.shift === shift && meter.nozzle === nozzle)) return flash(`A reading already exists for ${nozzle} on this date and shift.`)
    const litres = present - previous
    const entry: MeterReading = { id: Date.now(), date, shift, nozzle, product, previous, present, litres, rate, amount: litres * rate }
    setMeters((current) => [entry, ...current])
    event.currentTarget.reset()
    flash('Meter reading saved.')
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
      setUdhar((current) => [{ id: Date.now() + 1, date: entry.date, customerId: customer.id, type: 'Credit Sale', reference: `SALE-${entry.id}`, description: `${entry.product} ${litres.toLocaleString()} litres`, debit: grossAmount, credit: 0 }, ...current])
    }
    event.currentTarget.reset()
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

  const saveExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const entry: Expense = { id: Date.now(), date: String(data.get('date')), category: String(data.get('category')), description: String(data.get('description')), amount: numberValue(data.get('amount')), paidBy: String(data.get('paidBy')) }
    setExpenses((current) => [entry, ...current])
    event.currentTarget.reset()
    flash('Expense saved.')
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
      <section className="quick-actions">
        {['New Fuel Sale', 'Meter Reading', 'Customer Udhar', 'Expense', 'Fuel Purchase', 'Mobile Oil Sale', 'Daily Closing', 'Print Report'].map((action) => (
          <button key={action} type="button" className="action-button" onClick={() => {
            const map: Record<string, string> = {
              'New Fuel Sale': 'Sales',
              'Meter Reading': 'Meter Reading',
              'Customer Udhar': 'Customers',
              Expense: 'Expenses',
              'Fuel Purchase': 'Fuel Management',
              'Mobile Oil Sale': 'Mobile Oil',
              'Daily Closing': 'Daily Operations',
              'Print Report': 'Reports',
            }
            go(map[action] || 'Dashboard')
          }}>{action}</button>
        ))}
      </section>

      <section className="register-section">
        <div className="section-heading"><h3>Dashboard Period</h3><span className="form-note">Showing: {dashboardRange.from} - {dashboardRange.to}</span></div>
        <div className="period-controls">
          <div className="period-picker" role="group" aria-label="Dashboard period">
            {[
              ['Today', 'Daily'],
              ['This Week', 'Weekly'],
              ['This Month', 'Monthly'],
              ['This Year', 'Yearly'],
              ['Custom', 'Custom'],
            ].map(([value, label]) => <button key={value} type="button" className={`period-button${dashboardPeriod === value ? ' active' : ''}`} aria-pressed={dashboardPeriod === value} onClick={() => setDashboardPeriod(value)}>{label}</button>)}
          </div>
          {dashboardPeriod === 'Custom' && <>
            <label className="form-field"><span>From Date</span><input type="date" value={dashboardCustomFrom} onChange={(event) => setDashboardCustomFrom(event.target.value)} /></label>
            <label className="form-field"><span>To Date</span><input type="date" value={dashboardCustomTo} onChange={(event) => setDashboardCustomTo(event.target.value)} /></label>
          </>}
        </div>
      </section>

      <section className="dashboard-grid">
        {[
          ['Fuel Sales', money(dashboardSummary.totalSales)],
          ['Fuel Litres Sold', `${dashboardSummary.totalFuelLitres.toLocaleString()} L`],
          ...products.flatMap((product) => {
            const periodSales = fuelSales.filter((sale) => sale.product === product && sale.date >= dashboardRange.from && sale.date <= dashboardRange.to)
            return [[`${product} Litres Sold`, `${periodSales.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L`], [`${product} Sales`, money(periodSales.reduce((sum, sale) => sum + sale.amount, 0))]]
          }),
          ['Expenses', money(dashboardSummary.operatingExpenses)],
          ['Credit / Udhar Sales', money(dashboardSummary.creditSales)],
          ['Customer Payments', money(dashboardSummary.customerPayments)],
          ['Sales Less Expenses', money(dashboardSummary.netSales)],
          ['Current Receivables', money(customers.reduce((sum, customer) => sum + customerBalance(customer.id, customers, udhar), 0))],
        ].map(([label, value]) => <div key={label} className="metric-card"><span>{label}</span><strong>{value}</strong></div>)}
      </section>

      <section className="alerts-panel register-section">
        <div className="section-heading"><h3>Fuel Stock Overview</h3></div>
        <div className="summary-strip">{fuelStockRows.map((row) => <strong key={row.product}>{row.product}: {row.remaining.toLocaleString()} L</strong>)}</div>
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
      <FormPanel title="Discount Rule Setup" onSubmit={saveDiscountRule} submitLabel="Save Discount"><Field label="Customer" name="customerId" options={customers.map((customer) => `${customer.id} - ${customer.name}`)} required={false} /><Field label="Product" name="product" options={['', 'HSD', 'PMG', 'XTRON']} required={false} /><Field label="Discount Type" name="discountType" options={['percent', 'fixed']} defaultValue="percent" /><Field label="Discount Value" name="discountValue" type="number" defaultValue={2} /><Field label="Effective Date" name="effectiveDate" type="date" defaultValue={today} /><Field label="Status" name="status" options={['Active', 'Inactive']} defaultValue="Active" /><Field label="Description" name="description" defaultValue="Customer discount" /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>Customer Discount Rules</h3></div><DataTable headers={['Customer', 'Product', 'Type', 'Value', 'Status', 'Description']} rows={discountRules.map((rule) => [rule.customerId ? customerName(rule.customerId) : 'General', rule.product || 'All', rule.discountType, rule.discountValue.toString(), rule.status, rule.description])} /></section>
      <section className="register-section"><div className="section-heading"><h3>Customer Register</h3></div><DataTable headers={['Name', 'Phone', 'Address', 'Opening Balance']} rows={customers.map((customer) => [customer.name, customer.phone, customer.address, money(customer.openingBalance)])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => { const customer = customers[rowIndex]; setCustomers((current) => current.filter((item) => item.id !== customer.id)); setUdhar((current) => current.filter((item) => item.customerId !== customer.id)); setDiscountRules((current) => current.filter((rule) => rule.customerId !== customer.id)); setFamilyAdjustments((current) => current.filter((entry) => entry.customerId !== customer.id)); if (statementCustomerId === customer.id) setStatementCustomerId(0); flash('Customer and linked transactions deleted.') }}>Delete</button>} /></section><section className="register-section"><div className="section-heading"><h3>Customer Statement by Date</h3></div><div className="statement-controls"><label className="form-field"><span>Customer</span><select value={statementCustomerId} onChange={(event) => setStatementCustomerId(Number(event.target.value))}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="form-field"><span>As of</span><input type="date" value={statementDate} onChange={(event) => setStatementDate(event.target.value)} /></label></div><DataTable headers={['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Description']} rows={statementEntries.map((item) => [item.date, item.type, item.reference, money(item.debit), money(item.credit), item.description])} /><div className="summary-strip"><strong>Balance: {money(statementBalance)}</strong></div></section>
    </>
  )

  const settingsPage = (
    <>
      {authUser?.role === 'admin' && <section className="register-section"><div className="section-heading"><h3>Account Security</h3><span className="form-note">Change your login password.</span></div><div className="form-actions"><button className="primary-button" type="button" onClick={() => { setShowChangePassword(true); setChangePasswordError(''); setChangePasswordSuccess(false) }}>Change Password</button></div></section>}
      {authUser?.role === 'admin' && <><FormPanel title="User and Role Management" onSubmit={saveUser} submitLabel="Create User"><Field label="Username" name="username" /><Field label="Temporary Password" name="password" type="password" /><Field label="Role" name="role" options={['admin', 'manager', 'operator']} defaultValue="operator" /></FormPanel><section className="register-section"><div className="section-heading"><h3>Users</h3><button className="ghost-button" type="button" onClick={loadUsers}>Refresh Users</button></div><DataTable headers={['Username', 'Role', 'Status']} rows={users.map((user) => [user.username, user.role, 'Active'])} /></section><section className="register-section role-guide"><div className="section-heading"><h3>Role Permissions</h3></div><div className="role-guide-grid"><div><strong>Admin</strong><p>Full access, including user creation and accounting settings.</p></div><div><strong>Manager</strong><p>Runs operational registers and can update station data, but cannot manage user accounts.</p></div><div><strong>Operator</strong><p>Records daily operations. Settings are hidden, and accounting settings cannot be changed.</p></div></div></section></>}
      <section className="register-section">
        <div className="section-heading"><h3>Offline Database and Backup</h3><span className="form-note">Local SQLite data</span></div>
        <div className="summary-strip"><strong>Database: {systemStatus?.databaseExists ? 'Connected' : 'Unavailable'}</strong><strong>Version: {systemStatus?.version || 'Loading'}</strong><strong>Backups: {backups.length}</strong></div>
        <p className="form-note">Database location: {systemStatus?.databasePath || 'Loading'}<br />Backup folder: {systemStatus?.backupDir || 'Loading'}</p>
        <div className="form-actions"><button className="primary-button" type="button" onClick={backupDatabase}>Backup Database Now</button><button className="ghost-button" type="button" onClick={downloadBackup}>Download Register Backup</button>{authUser?.role === 'admin' && <button className="danger-button" type="button" onClick={resetRegisterData}>Reset Register Data</button>}</div>
        <div className="table-wrap"><table><thead><tr><th>Backup</th><th>Modified</th><th>Size</th><th>Action</th></tr></thead><tbody>{backups.length ? backups.map((backup) => <tr key={backup.name}><td>{backup.name}</td><td>{new Date(backup.modifiedAt).toLocaleString()}</td><td>{Math.ceil(backup.size / 1024)} KB</td><td><button className="table-action" type="button" onClick={() => restoreDatabase(backup.name)}>Restore</button></td></tr>) : <tr><td colSpan={4} className="empty-cell">No database backups found.</td></tr>}</tbody></table></div>
        <p className="form-note">Automatic daily backups run for administrators. Restoring always creates a safety backup first.</p>
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
      <section className="register-section"><div className="section-heading"><h3>Meter Reading Report</h3></div><DataTable headers={['Date', 'Shift', 'Nozzle', 'Fuel', 'Opening', 'Closing', 'Litres Sold', 'Rate', 'Amount']} rows={filteredMeters.map((meter) => [meter.date, meter.shift, meter.nozzle, meter.product, meter.previous, meter.present, meter.litres, meter.rate === undefined ? '-' : money(meter.rate), meter.amount === undefined ? '-' : money(meter.amount)])} /></section>
      <section className="register-section"><div className="section-heading"><h3>BRS Detail</h3></div><DataTable headers={['Date', 'Description', 'Type', 'Amount', 'Status']} rows={brsRecords.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to).map((entry) => [entry.date, entry.description, entry.type, money(entry.amount), entry.status])} /></section>
      <FormPanel title="Employee Salary Register" onSubmit={saveEmployeeSalary} submitLabel="Save Salary"><Field label="Payment Date" name="date" type="date" defaultValue={today} /><Field label="Salary Period" name="period" defaultValue={today.slice(0, 7)} /><Field label="Employee Name" name="employee" /><Field label="Gross Salary" name="gross" type="number" defaultValue={0} /><Field label="Deductions / Advance" name="deductions" type="number" defaultValue={0} /><Field label="Paid By" name="paidBy" options={['Cash', 'Bank', 'Card']} defaultValue="Cash" /><Field label="Status" name="status" options={['Paid', 'Pending']} defaultValue="Paid" /><Field label="Notes" name="notes" required={false} /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>Employee Salary History</h3></div><DataTable headers={['Date', 'Period', 'Employee', 'Gross', 'Deductions', 'Net Paid', 'Paid By', 'Status']} rows={employeeSalaries.filter((salary) => salary.date >= reportRange.from && salary.date <= reportRange.to).map((salary) => [salary.date, salary.period, salary.employee, money(salary.gross), money(salary.deductions), money(salary.net), salary.paidBy, salary.status])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => { const visibleSalaries = employeeSalaries.filter((salary) => salary.date >= reportRange.from && salary.date <= reportRange.to); setEmployeeSalaries((current) => current.filter((salary) => salary.id !== visibleSalaries[rowIndex].id)) }}>Delete</button>} /></section>
      <FormPanel title="Family Adjustment" onSubmit={saveFamilyAdjustment} submitLabel="Save Adjustment"><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Customer / Family Account" name="customerId" options={customers.map((customer) => `${customer.id} - ${customer.name}`)} required={false} /><Field label="Amount" name="amount" type="number" defaultValue={0} /><Field label="Adjustment Type" name="adjustmentType" options={['Increase', 'Decrease']} defaultValue="Increase" /><Field label="Status" name="status" options={['Active', 'Inactive']} defaultValue="Active" /><Field label="Description" name="description" defaultValue="Family adjustment" /><Field label="Notes" name="notes" defaultValue="Adjustment note" /></FormPanel><section className="register-section"><div className="section-heading"><h3>Family Adjustment Register</h3></div><DataTable headers={['Date', 'Customer', 'Amount', 'Type', 'Status', 'Description']} rows={familyAdjustments.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to).map((entry) => [entry.date, entry.customerId ? customerName(entry.customerId) : 'General', money(entry.amount), entry.adjustmentType, entry.status, entry.description])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setFamilyAdjustments((current) => current.filter((entry) => entry.id !== familyAdjustments.filter((item) => item.date >= reportRange.from && item.date <= reportRange.to)[rowIndex].id))}>Delete</button>} /></section>
    </>
  )

  const content = selectedTab === 'Dashboard' ? dashboard :
    selectedTab === 'Fuel Management' ? fuelManagementPage :
    selectedTab === 'Customers' ? customerPage :
    selectedTab === 'Settings' ? settingsPage :
    selectedTab === 'Reports' ? reportCenterPage :
    selectedTab === 'Accounting' ? reportsPage :
    selectedTab === 'Meter Reading' ? (
      <>
        <section className="register-section meter-print-register"><div className="section-heading"><h3>Daily Meter Reading Register</h3><button className="ghost-button" type="button" onClick={() => printDocument('Daily Meter Reading Register', `${displayDate(dashboardRange.from)} - ${displayDate(dashboardRange.to)}`)}>Print Register</button></div><FormPanel title="Enter Meter Reading" onSubmit={saveMeter}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Shift" name="shift" options={['Day', 'Night']} defaultValue="Day" /><Field label="Fuel Type" name="product" options={products} defaultValue="HSD" /><Field label="Nozzle Number / ID" name="nozzle" options={productNozzles.HSD.concat(productNozzles.PMG, productNozzles.XTRON)} defaultValue="HSD-1" /><Field label="Opening Meter Reading" name="previous" type="number" defaultValue={11800} /><Field label="Closing Meter Reading" name="present" type="number" defaultValue={12500} /><Field label="Rate per Litre" name="rate" type="number" defaultValue={285} /></FormPanel></section>
        <section className="register-section"><div className="section-heading"><h3>Meter Reading History</h3></div><DataTable headers={['Date', 'Shift', 'Nozzle', 'Fuel', 'Opening', 'Closing', 'Litres Sold', 'Rate', 'Amount']} rows={meters.map((meter) => [meter.date, meter.shift, meter.nozzle, meter.product, meter.previous, meter.present, meter.litres, meter.rate === undefined ? '-' : money(meter.rate), meter.amount === undefined ? '-' : money(meter.amount)])} /></section>
      </>
    ) :
    selectedTab === 'Sales' ? (
      <>
        <FormPanel title="Fuel Sale / Daily Sales Register" onSubmit={saveSale}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Product" name="product" options={products} defaultValue="HSD" /><Field label="Litres" name="litres" type="number" defaultValue={100} /><Field label="Sale Rate" name="rate" type="number" defaultValue={285} /><Field label="Payment Mode" name="mode" options={['Cash', 'Credit', 'Bank']} defaultValue="Cash" /><Field label="Payment Method" name="paymentMethod" options={['Cash', 'Card', 'Credit Card', 'Debit Card', 'Bank Transfer', 'Online Payment', 'Other']} defaultValue="Cash" /><Field label="Customer for Credit Sale" name="customerId" options={customers.map((customer) => `${customer.id} - ${customer.name}`)} required={false} /></FormPanel>
        <section className="register-section"><div className="section-heading"><h3>Fuel Sales Register</h3><input className="table-search" aria-label="Search fuel sales" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search sales" /></div><DataTable headers={['Date', 'Product', 'Litres', 'Rate', 'Amount', 'Mode', 'Customer']} rows={visibleSales.map((sale) => [sale.date, sale.product, sale.litres, money(sale.rate), money(sale.amount), sale.mode, sale.customer])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setSales((current) => current.filter((sale) => sale.id !== visibleSales[rowIndex].id))}>Delete</button>} /></section>
      </>
    ) :
    selectedTab === 'Expenses' ? (
      <>
        <FormPanel title="Expense Register" onSubmit={saveExpense}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Category" name="category" options={['Commission', 'Salary', 'Electricity', 'Maintenance', 'Pump Expenses', 'Miscellaneous']} defaultValue="Pump Expenses" /><Field label="Description" name="description" /><Field label="Amount" name="amount" type="number" defaultValue={0} /><Field label="Paid By" name="paidBy" options={['Cash', 'Bank', 'Card', 'Credit']} defaultValue="Cash" /></FormPanel>
        <section className="register-section"><div className="section-heading"><h3>Expense Summary</h3><input className="table-search" aria-label="Search expenses" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search expenses" /></div><DataTable headers={['Date', 'Category', 'Description', 'Amount', 'Paid By']} rows={visibleExpenses.map((expense) => [expense.date, expense.category, expense.description, money(expense.amount), expense.paidBy])} actions={(rowIndex) => <button className="table-action" type="button" onClick={() => setExpenses((current) => current.filter((expense) => expense.id !== visibleExpenses[rowIndex].id))}>Delete</button>} /></section>
      </>
    ) :
    selectedTab === 'Daily Operations' ? (
      <section className="register-section module-placeholder"><h3>Daily Closing & Shift Handover</h3><p>Review the active sales, expenses, meters, and customer balances before closing the shift.</p><div className="summary-strip"><strong>Fuel Sales: {money(dailySales.reduce((sum, sale) => sum + sale.amount, 0))}</strong><strong>Fuel Litres: {dailySales.reduce((sum, sale) => sum + sale.litres, 0).toLocaleString()} L</strong><strong>Cash Sale: {money(dailySales.filter((sale) => sale.mode === 'Cash').reduce((sum, sale) => sum + sale.amount, 0))}</strong><strong>Expenses: {money(dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0))}</strong><strong>Commission: {money(dailyCommission)}</strong><strong>Net Result: {money(dailySales.reduce((sum, sale) => sum + sale.amount, 0) - dailyExpenses.reduce((sum, expense) => sum + expense.amount, 0) - dailyCommission)}</strong><button className="primary-button" type="button" onClick={() => printDocument('Daily Closing Report', displayDate(currentSystemDate))}>Print Daily Closing</button></div></section>
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
        <aside className={`sidebar${mobileMenuOpen ? ' mobile-open' : ''}`}>
          <div className="brand"><span className="brand-mark">A</span><div><h1>Attock</h1><small>Petrol Pump</small></div></div>
          <nav className="nav"><div className="nav-section"><h3>PPMS Modules</h3>{tabs.filter((tab) => tab !== 'Settings' || authUser.role !== 'operator').map((tab) => <button key={tab} type="button" className={`nav-item ${selectedTab === tab ? 'active' : ''}`} onClick={() => go(tab)}>{tab}</button>)}</div><button className="ghost-button" type="button" onClick={logout}>Sign Out</button></nav>
        </aside>
        <main key={selectedTab} className="main-panel">
          <header className="topbar">
            <div><button type="button" className="mobile-menu-button" aria-label="Open navigation menu" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>Menu</button><p className="eyebrow">Petrol Pump Management System</p><h2>EKHWAN - 1 Filling Station</h2></div>
            <div className="topbar-actions"><button type="button" className="ghost-button" onClick={() => go('Daily Operations')}>Daily Closing</button><button type="button" className="primary-button" onClick={() => printDocument(selectedTab === 'Dashboard' ? 'Daily Dashboard Summary' : `${selectedTab} Report`)}>Print Report</button></div>
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