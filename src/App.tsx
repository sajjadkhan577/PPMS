import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import './styles.css'
import { calculateDiscountAmount, calculateFuelStockSummary, calculatePaymentFee, getDashboardSummary } from './lib/ppms'
import { createBackup, readStored, restoreBackup, writeStored } from './lib/storage'

type Product = 'HSD' | 'PMG' | 'XTRON'
type DiscountType = 'percent' | 'fixed'
type PaymentMethod = 'Cash' | 'Card' | 'Credit Card' | 'Debit Card' | 'Bank Transfer' | 'Online Payment' | 'Other'

type MeterReading = { id: number; date: string; shift: string; nozzle: string; product: Product; previous: number; present: number; litres: number }
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
}
type BRSRecord = {
  id: number
  bankAccountId: number
  date: string
  description: string
  type: 'Deposit' | 'Withdrawal'
  amount: number
  status: 'Matched' | 'Unmatched' | 'Pending' | 'Book Only' | 'Bank Only'
  reference: string
  bankAmount?: number
  adjustment?: number
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

const tabs = ['Dashboard', 'Daily Operations', 'Meter Reading', 'Fuel Management', 'Sales', 'Customers', 'Expenses', 'Mobile Oil', 'Commission', 'Safety Duty', 'Reports', 'Accounting', 'Settings']
const products: Product[] = ['HSD', 'PMG', 'XTRON']
const productNozzles: Record<Product, string[]> = { HSD: ['HSD-1', 'HSD-2', 'HSD-3', 'HSD-4'], PMG: ['PMG-1', 'PMG-2', 'PMG-3', 'PMG-4'], XTRON: [] }
const DEFAULT_STOCK: Record<Product, number> = { HSD: 20000, PMG: 15000, XTRON: 5000 }
const today = '2026-09-09'

const initialMeters: MeterReading[] = [
  { id: 1, date: today, shift: 'Day', nozzle: 'HSD-1', product: 'HSD', previous: 11800, present: 12500, litres: 700 },
  { id: 2, date: today, shift: 'Day', nozzle: 'HSD-2', product: 'HSD', previous: 12100, present: 12800, litres: 700 },
  { id: 3, date: today, shift: 'Day', nozzle: 'PMG-1', product: 'PMG', previous: 11350, present: 11980, litres: 630 },
  { id: 4, date: today, shift: 'Day', nozzle: 'PMG-2', product: 'PMG', previous: 11490, present: 12120, litres: 630 },
]
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
  { id: 1, bankName: 'HBL', accountName: 'EKHWAN-1 Depot', accountNumber: 'PK-001-454', openingBalance: 1200000, currentBookBalance: 1250000 },
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
  return <main className="login-panel"><div className="login-card"><span className="brand-mark">A</span><p className="eyebrow">Petrol Pump Management System</p><h1>Operator Sign In</h1><p>Use an authenticated PPMS account to access station registers.</p><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); onLogin(String(data.get('username')), String(data.get('password'))) }}><label className="form-field"><span>Username</span><input name="username" autoComplete="username" required /></label><label className="form-field"><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">Sign In</button></form><button className="ghost-button" type="button" onClick={() => onLogin('offline', 'offline')}>Continue Offline</button></div></main>
}

const money = (value: number) => `Rs. ${Math.round(value).toLocaleString('en-PK')}`
const numberValue = (value: FormDataEntryValue | null) => Number(value || 0)

function resolveDateRange(period: string, customFrom: string, customTo: string) {
  if (period === 'Today') return { from: today, to: today }
  if (period === 'This Week') {
    const current = new Date(`${today}T00:00:00`)
    const day = current.getDay()
    const diff = (day === 0 ? 6 : day - 1)
    current.setDate(current.getDate() - diff)
    return { from: current.toISOString().slice(0, 10), to: today }
  }
  if (period === 'This Month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (period === 'This Year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  return { from: customFrom || today, to: customTo || today }
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

function customerBalance(customerId: number, customers: Customer[], transactions: UdharTransaction[]) {
  const customer = customers.find((item) => item.id === customerId)
  const entries = transactions.filter((item) => item.customerId === customerId)
  const balance = entries.reduce((sum, item) => sum + item.debit - item.credit, 0)
  const hasOpeningEntry = entries.some((item) => item.type === 'Opening Balance')
  return customer ? (hasOpeningEntry ? balance : customer.openingBalance + balance) : 0
}

export default function App() {
  const [authUser, setAuthUser] = useState<SessionUser | null>(() => { const saved = localStorage.getItem('ppms-session-user'); return saved ? JSON.parse(saved) as SessionUser : null })
  const [authError, setAuthError] = useState('')
  const [selectedTab, setSelectedTab] = useState('Dashboard')
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
  const [discountRules, setDiscountRules] = useStored<DiscountRule[]>('discount-rules', defaultDiscountRules)
  const [paymentFees, setPaymentFees] = useStored<PaymentFeeSetting[]>('payment-fees', defaultPaymentFees)
  const [stockAdjustments, setStockAdjustments] = useStored<StockAdjustment[]>('stock-adjustments', [])
  const [bankAccounts, setBankAccounts] = useStored<BankAccount[]>('bank-accounts', defaultBankAccounts)
  const [brsRecords, setBrsRecords] = useStored<BRSRecord[]>('brs-records', defaultBRS)
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
  const [users, setUsers] = useState<SessionUser[]>([])
  const [recordSearch, setRecordSearch] = useState('')

  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2600) }
  const go = (tab: string) => { setSelectedTab(tab); setNotice('') }
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
    if (username === 'offline' && password === 'offline') {
      const offlineUser: SessionUser = { id: 'offline', username: 'Offline Manager', role: 'manager' }
      setAuthUser(offlineUser)
      localStorage.setItem('ppms-session-user', JSON.stringify(offlineUser))
      setAuthError('')
      return
    }
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
  const loadUsers = () => { if (authUser?.role === 'admin') apiRequest<{ users: SessionUser[] }>('/api/users').then((payload) => setUsers(payload.users)).catch(() => undefined) }
  const saveUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    apiRequest('/api/users', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password'), role: data.get('role') }) }).then(() => { event.currentTarget.reset(); loadUsers(); flash('User account created.') }).catch((error: Error) => flash(error.message))
  }
  const reportRange = useMemo(() => resolveDateRange(reportPeriod, reportCustomFrom, reportCustomTo), [reportCustomFrom, reportCustomTo, reportPeriod])
  const filteredSales = sales.filter((sale) => sale.date >= reportRange.from && sale.date <= reportRange.to)
  const filteredPurchases = purchases.filter((purchase) => purchase.date >= reportRange.from && purchase.date <= reportRange.to)
  const filteredExpenses = expenses.filter((expense) => expense.date >= reportRange.from && expense.date <= reportRange.to)
  const filteredUdhar = udhar.filter((entry) => entry.date >= reportRange.from && entry.date <= reportRange.to)
  const visiblePurchases = purchases.filter((entry) => `${entry.date} ${entry.product} ${entry.supplier}`.toLowerCase().includes(recordSearch.toLowerCase()))
  const visibleSales = sales.filter((sale) => `${sale.date} ${sale.product} ${sale.mode} ${sale.customer}`.toLowerCase().includes(recordSearch.toLowerCase()))
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

  const dashboardRange = useMemo(() => resolveDateRange(dashboardPeriod, dashboardCustomFrom, dashboardCustomTo), [dashboardCustomFrom, dashboardCustomTo, dashboardPeriod])
  const dashboardSummary = useMemo(
    () => getDashboardSummary({ startDate: dashboardRange.from, endDate: dashboardRange.to, sales, expenses, udhar }),
    [dashboardRange, expenses, sales, udhar],
  )

  const fuelStockRows = useMemo(() => {
    return products.map((product) => {
      const opening = stockOpenings[product] || 0
      const purchased = purchases.filter((entry) => entry.product === product).reduce((sum, entry) => sum + entry.litres, 0)
      const sold = sales.filter((entry) => entry.product === product).reduce((sum, entry) => sum + entry.litres, 0)
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
  }, [purchases, sales, stockAdjustments, stockOpenings])

  const statementEntries = udhar.filter((item) => item.customerId === statementCustomerId && item.date <= statementDate).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const statementBalance = statementEntries.reduce((balance, item) => balance + item.debit - item.credit, 0)

  const saveMeter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const previous = numberValue(data.get('previous'))
    const present = numberValue(data.get('present'))
    const product = String(data.get('product')) as Product
    const nozzle = String(data.get('nozzle'))
    if (present < previous) return flash('Present reading cannot be less than previous reading.')
    if (!productNozzles[product].includes(nozzle)) return flash(`${nozzle} does not belong to ${product}.`)
    const entry: MeterReading = { id: Date.now(), date: String(data.get('date')), shift: String(data.get('shift')), nozzle, product, previous, present, litres: present - previous }
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

  const saveBRSRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const record: BRSRecord = {
      id: Date.now(),
      bankAccountId: Number(data.get('bankAccountId')),
      date: String(data.get('date')),
      description: String(data.get('description')),
      type: String(data.get('type')) as BRSRecord['type'],
      amount: numberValue(data.get('amount')),
      bankAmount: numberValue(data.get('bankAmount')),
      adjustment: numberValue(data.get('adjustment')),
      status: String(data.get('status')) as BRSRecord['status'],
      reference: String(data.get('reference')),
    }
    setBrsRecords((current) => [record, ...current])
    event.currentTarget.reset()
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
          ['HSD Sales', money(sales.filter((sale) => sale.product === 'HSD' && sale.date >= dashboardRange.from && sale.date <= dashboardRange.to).reduce((sum, sale) => sum + sale.amount, 0))],
          ['PMG Sales', money(sales.filter((sale) => sale.product === 'PMG' && sale.date >= dashboardRange.from && sale.date <= dashboardRange.to).reduce((sum, sale) => sum + sale.amount, 0))],
          ['Expenses', money(dashboardSummary.totalExpenses)],
          ['Credit / Udhar Sales', money(dashboardSummary.creditSales)],
          ['Customer Payments', money(dashboardSummary.customerPayments)],
          ['Net Sales', money(dashboardSummary.netSales)],
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
      {authUser?.role === 'admin' && <><FormPanel title="User and Role Management" onSubmit={saveUser} submitLabel="Create User"><Field label="Username" name="username" /><Field label="Temporary Password" name="password" type="password" /><Field label="Role" name="role" options={['admin', 'manager', 'operator']} defaultValue="operator" /></FormPanel><section className="register-section"><div className="section-heading"><h3>Users</h3><button className="ghost-button" type="button" onClick={loadUsers}>Refresh Users</button></div><DataTable headers={['Username', 'Role', 'Status']} rows={users.map((user) => [user.username, user.role, 'Active'])} /></section><section className="register-section role-guide"><div className="section-heading"><h3>Role Permissions</h3></div><div className="role-guide-grid"><div><strong>Admin</strong><p>Full access, including user creation and accounting settings.</p></div><div><strong>Manager</strong><p>Runs operational registers and can update station data, but cannot manage user accounts.</p></div><div><strong>Operator</strong><p>Records daily operations. Settings are hidden, and accounting settings cannot be changed.</p></div></div></section></>}
      <section className="register-section">
        <div className="section-heading"><h3>Data Backup and Restore</h3><span className="form-note">Versioned local register data</span></div>
        <div className="form-actions"><button className="primary-button" type="button" onClick={downloadBackup}>Download Backup</button><label className="ghost-button file-button">Restore Backup<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadBackup(file) }} /></label>{authUser?.role === 'admin' && <button className="danger-button" type="button" onClick={resetRegisterData}>Reset Register Data</button>}</div>
        <p className="form-note">Reset Register Data removes operational records and keeps user accounts.</p>
      </section>
      <FormPanel title="Payment Fee Configuration" onSubmit={savePaymentFee} submitLabel="Save Fee Policy"><Field label="Payment Method" name="method" options={['Cash', 'Card', 'Credit Card', 'Debit Card', 'Bank Transfer', 'Online Payment', 'Other']} defaultValue="Card" /><Field label="Fee Percentage" name="feePercent" type="number" defaultValue={2} /><Field label="Effective Date" name="effectiveDate" type="date" defaultValue={today} /><Field label="Status" name="status" options={['Active', 'Inactive']} defaultValue="Active" /><Field label="Absorbed by Business" name="absorbedByBusiness" options={['true', 'false']} defaultValue="true" /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>Payment Fee Policies</h3></div><DataTable headers={['Method', 'Percent', 'Effective', 'Status', 'Business Absorbs']} rows={paymentFees.map((setting) => [setting.method, `${setting.feePercent}%`, setting.effectiveDate, setting.status, setting.absorbedByBusiness ? 'Yes' : 'No'])} /></section>
      <FormPanel title="BRS Transaction / Reconciliation Entry" onSubmit={saveBRSRecord} submitLabel="Save BRS Record"><Field label="Bank Account" name="bankAccountId" options={bankAccounts.map((account) => `${account.id} - ${account.bankName} ${account.accountName}`)} defaultValue={`${bankAccounts[0]?.id || 1} - ${bankAccounts[0]?.bankName || ''} ${bankAccounts[0]?.accountName || ''}`} /><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Description" name="description" defaultValue="Bank transaction" /><Field label="Type" name="type" options={['Deposit', 'Withdrawal']} defaultValue="Deposit" /><Field label="Book Amount" name="amount" type="number" defaultValue={0} /><Field label="Bank Amount" name="bankAmount" type="number" defaultValue={0} /><Field label="Adjustment" name="adjustment" type="number" defaultValue={0} required={false} /><Field label="Status" name="status" options={['Matched', 'Unmatched', 'Pending', 'Book Only', 'Bank Only']} defaultValue="Pending" /><Field label="Reference" name="reference" defaultValue="BRS-001" /></FormPanel>
      <section className="register-section"><div className="section-heading"><h3>BRS / Bank Reconciliation</h3></div><DataTable headers={['Bank', 'Account', 'Opening', 'Book Balance']} rows={bankAccounts.map((account) => [account.bankName, account.accountName, money(account.openingBalance), money(account.currentBookBalance)])} /><DataTable headers={['Date', 'Description', 'Type', 'Book', 'Bank', 'Adjustment', 'Status']} rows={brsRecords.map((entry) => [entry.date, entry.description, entry.type, money(entry.amount), money(entry.bankAmount || 0), money(entry.adjustment || 0), entry.status])} /><div className="summary-strip"><strong>Book Transactions: {brsRecords.length}</strong><strong>Reconciled: {brsRecords.filter((entry) => entry.status === 'Matched').length}</strong><strong>Difference: {money(brsRecords.reduce((sum, entry) => sum + entry.amount - (entry.bankAmount || 0) + (entry.adjustment || 0), 0))}</strong></div></section>
    </>
  )

  const reportsPage = (
    <>
      <section className="register-section"><div className="section-heading"><h3>Report Period</h3><span className="form-note">{reportRange.from} - {reportRange.to}</span></div><div className="period-controls"><label className="form-field"><span>Period</span><select value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value)}><option>Today</option><option>This Week</option><option>This Month</option><option>This Year</option><option>Custom</option></select></label>{reportPeriod === 'Custom' && <><label className="form-field"><span>From Date</span><input type="date" value={reportCustomFrom} onChange={(event) => setReportCustomFrom(event.target.value)} /></label><label className="form-field"><span>To Date</span><input type="date" value={reportCustomTo} onChange={(event) => setReportCustomTo(event.target.value)} /></label></>}<div className="form-actions"><button className="primary-button" type="button" onClick={() => window.print()}>Print Report</button><button className="ghost-button" type="button" onClick={() => exportCsv(`ppms-report-${reportRange.from}-${reportRange.to}.csv`, ['Ledger', 'Total', 'Notes'], [['Fuel Sales', money(filteredSales.reduce((sum, sale) => sum + sale.amount, 0)), 'Fuel revenue'], ['Fuel Purchases', money(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0)), 'Stock procurement'], ['Customer Payments', money(filteredUdhar.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0)), 'Receipts'], ['Expenses', money(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)), 'Operating costs']])}>Export CSV</button></div></div></section>
      <section className="register-section"><div className="section-heading"><h3>Monthly Statement Overview</h3></div><DataTable headers={['Ledger', 'Total', 'Notes']} rows={[['Fuel Sales', money(filteredSales.reduce((sum, sale) => sum + sale.amount, 0)), 'Gross fuel revenue'], ['Fuel Purchases', money(filteredPurchases.reduce((sum, purchase) => sum + purchase.amount, 0)), 'Stock procurement'], ['Customer Payments', money(filteredUdhar.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0)), 'Receipts'], ['Expenses', money(filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)), 'Operating costs'], ['Customers Receivable', money(customers.reduce((sum, customer) => sum + customerBalance(customer.id, customers, udhar), 0)), 'Current outstanding']]} /></section>
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
    selectedTab === 'Reports' || selectedTab === 'Accounting' ? reportsPage :
    selectedTab === 'Meter Reading' ? (
      <>
        <FormPanel title="Daily Meter Reading Register" onSubmit={saveMeter}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Shift" name="shift" options={['Day', 'Night']} defaultValue="Day" /><Field label="Product" name="product" options={products} defaultValue="HSD" /><Field label="Nozzle" name="nozzle" options={productNozzles.HSD.concat(productNozzles.PMG)} defaultValue="HSD-1" /><Field label="Previous Reading" name="previous" type="number" defaultValue={11800} /><Field label="Present Reading" name="present" type="number" defaultValue={12500} /></FormPanel>
        <section className="register-section"><div className="section-heading"><h3>Meter Reading History</h3></div><DataTable headers={['Date', 'Shift', 'Nozzle', 'Product', 'Previous', 'Present', 'Total Litres']} rows={meters.map((meter) => [meter.date, meter.shift, meter.nozzle, meter.product, meter.previous, meter.present, meter.litres])} /></section>
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
      <section className="register-section module-placeholder"><h3>Daily Closing & Shift Handover</h3><p>Review the active sales, expenses, meters, and customer balances before closing the shift.</p><div className="summary-strip"><strong>Cash Sale: {money(sales.filter((sale) => sale.mode === 'Cash').reduce((sum, sale) => sum + sale.amount, 0))}</strong><strong>Expenses: {money(expenses.reduce((sum, expense) => sum + expense.amount, 0))}</strong><button className="primary-button" type="button" onClick={() => window.print()}>Print Daily Closing</button></div></section>
    ) :
    selectedTab === 'Mobile Oil' ? (
      <>
        <FormPanel title="Mobile Oil Sale" onSubmit={saveOil}><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Item" name="item" defaultValue="Lubricant" /><Field label="Quantity" name="quantity" type="number" defaultValue={1} /><Field label="Rate" name="rate" type="number" defaultValue={500} /></FormPanel>
        <section className="register-section"><div className="section-heading"><h3>Mobile Oil Register</h3></div><DataTable headers={['Date', 'Item', 'Qty', 'Rate', 'Amount']} rows={oilSales.map((sale) => [sale.date, sale.item, sale.quantity, money(sale.rate), money(sale.amount)])} /></section>
      </>
    ) :
    selectedTab === 'Commission' ? (
      <section className="register-section"><div className="section-heading"><h3>Commission Statement</h3></div><DataTable headers={['Product', 'Litres Sold', 'Commission Rate', 'Commission']} rows={products.map((product) => { const litres = sales.filter((sale) => sale.product === product).reduce((sum, sale) => sum + sale.litres, 0); const rate = product === 'HSD' ? 2.2 : 2.5; return [product, `${litres.toLocaleString()} L`, `${rate}%`, money(litres * rate)] })} /></section>
    ) :
    selectedTab === 'Safety Duty' ? (
      <section className="register-section"><div className="section-heading"><h3>Safety Duty Register</h3></div><DataTable headers={['Nozzle / Duty Point', 'Present Reading', 'Previous Reading', 'Total']} rows={meters.map((meter) => [meter.nozzle, meter.present, meter.previous, meter.litres])} /></section>
    ) : <section className="register-section module-placeholder"><h3>{selectedTab}</h3><p>This module is ready for station configuration and its register workflow.</p></section>

  return (
    !authUser ? <LoginPanel onLogin={login} error={authError} /> :
    <div className="ppms-app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><div><h1>Attock</h1><small>Petrol Pump</small></div></div>
        <nav className="nav"><div className="nav-section"><h3>PPMS Modules</h3>{tabs.filter((tab) => tab !== 'Settings' || authUser.role !== 'operator').map((tab) => <button key={tab} type="button" className={`nav-item ${selectedTab === tab ? 'active' : ''}`} onClick={() => go(tab)}>{tab}</button>)}</div><button className="ghost-button" type="button" onClick={logout}>Sign Out</button></nav>
      </aside>
      <main key={selectedTab} className="main-panel">
        <header className="topbar">
          <div><p className="eyebrow">Petrol Pump Management System</p><h2>EKHWAN - 1 Filling Station</h2></div>
          <div className="topbar-actions"><button type="button" className="ghost-button" onClick={() => go('Daily Operations')}>Daily Closing</button><button type="button" className="primary-button" onClick={() => go('Reports')}>Print Report</button></div>
        </header>
        {notice && <div className="toast">{notice}</div>}
        <div className="page-title"><span>Working Register</span><strong>{selectedTab}</strong></div>
        {content}
      </main>
    </div>
  )
}