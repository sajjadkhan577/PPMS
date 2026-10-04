export type FuelSaleInput = {
  product: string
  litres: number
  rate: number
  discount?: number
  discountAmount?: number
}

export type CustomerBalanceInput = {
  opening: number
  creditSales: number
  payments: number
  adjustments: number
}

export type MonthlyStatementInput = {
  pmgLitres: number
  hsdLitres: number
  xtronLitres: number
  pmgRate: number
  hsdRate: number
  pmgAmount: number
  hsdAmount: number
  expenses: number
  otherIncome: number
}

export type ProfitLossInput = {
  fuelRevenue: number
  mobileOilRevenue: number
  otherIncome: number
  fuelPurchase: number
  mobileOilPurchase: number
  commission: number
  salaries: number
  electricity: number
  pumpExpenses: number
  otherExpenses: number
}

export type DashboardSummaryInput = {
  startDate: string
  endDate: string
  sales: Array<{
    id: number
    date: string
    product: string
    litres: number
    rate: number
    amount: number
    mode: string
    customer: string
    customerId?: number
    discount?: number
    discountAmount?: number
  }>
  expenses: Array<{
    id: number
    date: string
    category: string
    description: string
    amount: number
    paidBy: string
  }>
  otherSales?: Array<{ date: string; amount: number }>
  customers?: Array<{ id: number; openingBalance: number }>
  udhar: Array<{
    id: number
    date: string
    customerId: number
    type: string
    reference: string
    description: string
    debit: number
    credit: number
  }>
  commission?: Array<{
    date: string
    amount: number
  }>
}

export type FuelStockSummaryInput = {
  product: string
  opening: number
  purchased: number
  sold: number
  adjustment: number
}

export type DiscountInput = {
  litres: number
  rate: number
  discountType: 'percent' | 'fixed'
  discountValue: number
}

export type PaymentFeeInput = {
  amount: number
  feePercent: number
}

export type CommissionSummaryInput = {
  startDate: string
  endDate: string
  records: Array<{ date: string; amount: number }>
}

function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function normalizeLocalCalendarDate(value: string) {
  const raw = String(value || '').trim()
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoDate) {
    const [, year, month, day] = isoDate
    if (raw.length > 10 && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
      const timestamp = new Date(raw)
      if (!Number.isNaN(timestamp.getTime())) return localDateString(timestamp)
    }
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)
      ? `${year}-${month}-${day}`
      : ''
  }
  const localizedDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (localizedDate) {
    const [, day, month, year] = localizedDate
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : ''
  }
  return ''
}

export function isDateWithinRange(value: string, startDate: string, endDate: string) {
  const date = normalizeLocalCalendarDate(value)
  const start = normalizeLocalCalendarDate(startDate)
  const end = normalizeLocalCalendarDate(endDate)
  return Boolean(date && start && end && date >= start && date <= end)
}

export function getDashboardDateRange(period: string, customFrom: string, customTo: string, currentDate: string) {
  const today = normalizeLocalCalendarDate(currentDate) || localDateString(new Date())
  const [year, month, day] = today.split('-').map(Number)
  if (period === 'Today') return { from: today, to: today }
  if (period === 'Yesterday') {
    const yesterday = new Date(year, month - 1, day - 1)
    const date = localDateString(yesterday)
    return { from: date, to: date }
  }
  if (period === 'This Week') {
    const date = new Date(year, month - 1, day)
    const mondayOffset = (date.getDay() + 6) % 7
    const monday = new Date(year, month - 1, day - mondayOffset)
    const sunday = new Date(year, month - 1, day - mondayOffset + 6)
    return { from: localDateString(monday), to: localDateString(sunday) }
  }
  if (period === 'This Month') return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: localDateString(new Date(year, month, 0)) }
  if (period === 'Last Month') {
    const first = new Date(year, month - 2, 1)
    const last = new Date(year, month - 1, 0)
    return { from: localDateString(first), to: localDateString(last) }
  }
  if (period === 'This Year') return { from: `${year}-01-01`, to: `${year}-12-31` }
  return {
    from: normalizeLocalCalendarDate(customFrom) || today,
    to: normalizeLocalCalendarDate(customTo) || today,
  }
}

export function calculateMeterTotal(presentReading: number, previousReading: number) {
  if (presentReading < previousReading) {
    throw new Error('Present meter reading cannot be less than previous reading.')
  }

  return presentReading - previousReading
}

export type MeterTestEntry = {
  id: number
  date: string
  shift: string
  product: string
  nozzle: string
  quantity: number
  returnedToTank: boolean
  reason: string
  reference?: string
  notes: string
}

export function getMeterTestsForReading<T extends Pick<MeterTestEntry, 'date' | 'shift' | 'product' | 'nozzle'>>(
  tests: T[],
  reading: { date: string; shift: string; product: string; nozzle: string },
) {
  const readingDate = normalizeLocalCalendarDate(reading.date)
  return tests.filter((test) => normalizeLocalCalendarDate(test.date) === readingDate
    && test.shift === reading.shift
    && test.product === reading.product
    && test.nozzle === reading.nozzle)
}

export function calculateMeterPeriodSummary({
  physicalMovement,
  rate = 0,
  tests,
}: {
  physicalMovement: number
  rate?: number
  tests: Array<{ quantity: number; returnedToTank: boolean }>
}) {
  const movement = Number.isFinite(physicalMovement) ? Math.max(0, physicalMovement) : 0
  const validTests = tests.filter((test) => Number.isFinite(test.quantity) && test.quantity > 0)
  const testQuantity = validTests.reduce((sum, test) => sum + test.quantity, 0)
  const returnedTestQuantity = validTests.filter((test) => test.returnedToTank).reduce((sum, test) => sum + test.quantity, 0)
  const netTestStockImpact = validTests.filter((test) => !test.returnedToTank).reduce((sum, test) => sum + test.quantity, 0)
  const actualCustomerSales = Math.max(0, movement - testQuantity)
  const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 0

  return {
    physicalMovement: movement,
    testQuantity,
    returnedTestQuantity,
    actualCustomerSales,
    netTestStockImpact,
    totalStockReduction: actualCustomerSales + netTestStockImpact,
    customerSalesAmount: actualCustomerSales * safeRate,
    calibrationSalesAmount: 0,
  }
}

export type MeterChainReading = {
  id: number
  date: string
  shift: string
  product: string
  nozzle: string
  previous: number
  present: number
  litres: number
  rate?: number
  amount?: number
}

function meterShiftOrder(shift: string) {
  return shift === 'Night' ? 1 : 0
}

export function findPreviousMeterReading<T extends MeterChainReading>(
  readings: T[],
  selection: { date: string; shift: string; product: string; nozzle: string; excludeId?: number },
) {
  const selectedDate = normalizeLocalCalendarDate(selection.date)
  if (!selectedDate) return undefined
  return readings
    .filter((reading) => {
      if (reading.id === selection.excludeId || reading.product !== selection.product || reading.nozzle !== selection.nozzle) return false
      const readingDate = normalizeLocalCalendarDate(reading.date)
      if (!readingDate || readingDate > selectedDate) return false
      if (readingDate < selectedDate) return true
      return meterShiftOrder(reading.shift) < meterShiftOrder(selection.shift)
    })
    .sort((left, right) => {
      const dateOrder = normalizeLocalCalendarDate(right.date).localeCompare(normalizeLocalCalendarDate(left.date))
      if (dateOrder) return dateOrder
      const shiftOrder = meterShiftOrder(right.shift) - meterShiftOrder(left.shift)
      return shiftOrder || right.id - left.id
    })[0]
}

export function recalculateMeterReadingChain<T extends MeterChainReading>(readings: T[]) {
  const grouped = new Map<string, T[]>()
  for (const reading of readings) {
    const key = `${reading.product}\u0000${reading.nozzle}`
    const group = grouped.get(key) || []
    group.push(reading)
    grouped.set(key, group)
  }

  const updates = new Map<number, T>()
  for (const group of grouped.values()) {
    const ordered = [...group].sort((left, right) => {
      const leftDate = normalizeLocalCalendarDate(left.date) || left.date
      const rightDate = normalizeLocalCalendarDate(right.date) || right.date
      const dateOrder = leftDate.localeCompare(rightDate)
      if (dateOrder) return dateOrder
      const shiftOrder = meterShiftOrder(left.shift) - meterShiftOrder(right.shift)
      return shiftOrder || left.id - right.id
    })
    for (let index = 0; index < ordered.length; index += 1) {
      const reading = ordered[index]
      const previous = index === 0 ? reading.previous : ordered[index - 1].present
      if (reading.present < previous) throw new Error('Closing meter reading cannot be less than opening meter reading.')
      const litres = calculateMeterTotal(reading.present, previous)
      updates.set(reading.id, {
        ...reading,
        previous,
        litres,
        amount: reading.rate === undefined ? undefined : litres * reading.rate,
      })
    }
  }
  return readings.map((reading) => updates.get(reading.id) || reading)
}

export function calculateFuelSales(items: FuelSaleInput[]) {
  const byProduct: Record<string, number> = {}
  let totalLitres = 0
  let totalAmount = 0

  for (const item of items) {
    const amount = item.litres * item.rate
    totalLitres += item.litres
    totalAmount += amount
    byProduct[item.product] = (byProduct[item.product] ?? 0) + amount
  }

  return {
    totalLitres,
    totalAmount,
    byProduct,
  }
}

export function calculateCustomerBalance({ opening, creditSales, payments, adjustments }: CustomerBalanceInput) {
  return opening + creditSales - payments + adjustments
}

export type FleetStatus = 'Normal' | 'Warning' | 'High Usage' | 'Limit Reached'

export function calculateVehicleUsageSummary({ limit, used, month }: { limit: number; used: number; month: string }) {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Number(limit)) : 0
  const safeUsed = Number.isFinite(used) ? Math.max(0, Number(used)) : 0
  const remaining = safeLimit - safeUsed
  const usagePercent = safeLimit > 0 ? (safeUsed / safeLimit) * 100 : safeUsed > 0 ? 100 : 0
  let status: FleetStatus = 'Normal'
  if (usagePercent >= 100) status = 'Limit Reached'
  else if (usagePercent >= 90) status = 'High Usage'
  else if (usagePercent >= 80) status = 'Warning'

  return {
    month: String(month || ''),
    limit: safeLimit,
    used: safeUsed,
    remaining,
    usagePercent: Number.isFinite(usagePercent) ? usagePercent : 0,
    status,
    exceeded: Math.max(0, safeUsed - safeLimit),
  }
}

export function calculateCompanyFleetSummary({
  companyId,
  vehicles,
  allocations,
  transactions,
  month,
}: {
  companyId: number
  vehicles: Array<{ id: number; customerId: number; vehicleNumber: string; status?: string }>
  allocations: Array<{ customerId: number; vehicleId: number; month: string; monthlyLitresLimit: number }>
  transactions: Array<{ customerId: number; vehicleId: number; date: string; type: string; litres?: number; debit?: number; credit?: number }>
  month: string
}) {
  const activeVehicles = vehicles.filter((vehicle) => vehicle.customerId === companyId && (vehicle.status || 'Active') !== 'Inactive')
  let totalAllocation = 0
  let totalUsed = 0
  let overLimitVehicles = 0

  for (const vehicle of activeVehicles) {
    const limit = allocations
      .filter((allocation) => allocation.customerId === companyId && allocation.vehicleId === vehicle.id && allocation.month === month)
      .reduce((sum, allocation) => sum + Math.max(0, Number(allocation.monthlyLitresLimit || 0)), 0)

    const used = transactions
      .filter((transaction) => transaction.customerId === companyId && transaction.vehicleId === vehicle.id && transaction.date.startsWith(month) && transaction.type === 'Credit Sale')
      .reduce((sum, transaction) => sum + Math.max(0, Number(transaction.litres || 0)), 0)

    totalAllocation += limit
    totalUsed += used

    const summary = calculateVehicleUsageSummary({ limit, used, month })
    if (summary.exceeded > 0 || summary.status === 'Limit Reached') overLimitVehicles += 1
  }

  const totalRemaining = totalAllocation - totalUsed
  const usagePercent = totalAllocation > 0 ? (totalUsed / totalAllocation) * 100 : totalUsed > 0 ? 100 : 0
  let status: FleetStatus = 'Normal'
  if (usagePercent >= 100) status = 'Limit Reached'
  else if (usagePercent >= 90) status = 'High Usage'
  else if (usagePercent >= 80) status = 'Warning'

  return {
    companyId,
    month,
    totalAllocation,
    totalUsed,
    totalRemaining,
    usagePercent: Number.isFinite(usagePercent) ? usagePercent : 0,
    status,
    overLimitVehicles,
  }
}

export function calculateMonthlyStatement({
  pmgLitres,
  hsdLitres,
  xtronLitres,
  pmgRate,
  hsdRate,
  pmgAmount,
  hsdAmount,
  expenses,
  otherIncome,
}: MonthlyStatementInput) {
  const totalLitres = pmgLitres + hsdLitres + xtronLitres
  const totalAmount = pmgAmount + hsdAmount
  const profitLoss = totalAmount + otherIncome - expenses

  return {
    totalLitres,
    totalAmount,
    profitLoss,
    pmgRate,
    hsdRate,
  }
}

export function calculateProfitLoss({
  fuelRevenue,
  mobileOilRevenue,
  otherIncome,
  fuelPurchase,
  mobileOilPurchase,
  commission,
  salaries,
  electricity,
  pumpExpenses,
  otherExpenses,
}: ProfitLossInput) {
  const grossRevenue = fuelRevenue + mobileOilRevenue + otherIncome
  const costOfGoods = fuelPurchase + mobileOilPurchase
  const operatingExpenses = commission + salaries + electricity + pumpExpenses + otherExpenses
  const totalCost = costOfGoods + operatingExpenses
  const grossProfit = grossRevenue - costOfGoods
  const netProfit = grossProfit - operatingExpenses

  return {
    grossRevenue,
    totalCost,
    grossProfit,
    operatingExpenses,
    netProfit,
  }
}

export function getDashboardSummary({ startDate, endDate, sales, expenses, udhar, otherSales = [], customers = [], commission: commissionRecords = [] }: DashboardSummaryInput) {
  const filteredSales = sales.filter((sale) => isDateWithinRange(sale.date, startDate, endDate))
  const filteredExpenses = expenses.filter((expense) => isDateWithinRange(expense.date, startDate, endDate) && expense.category !== 'Commission')
  const filteredUdhar = udhar.filter((entry) => isDateWithinRange(entry.date, startDate, endDate))
  const filteredOtherSales = otherSales.filter((sale) => isDateWithinRange(sale.date, startDate, endDate))
  const commission = getCommissionTotal({ startDate, endDate, records: commissionRecords })

  const totalSales = filteredSales.reduce((sum, sale) => sum + sale.amount, 0)
  const totalFuelLitres = filteredSales.reduce((sum, sale) => sum + sale.litres, 0)
  const creditSales = filteredSales.filter((sale) => sale.mode === 'Credit').reduce((sum, sale) => sum + sale.amount, 0)
  const cashSales = totalSales - creditSales
  const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)
  const customerPayments = filteredUdhar.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0)
  const creditPosted = filteredUdhar.filter((item) => item.type === 'Credit Sale').reduce((sum, item) => sum + item.debit, 0)
  const totalOtherSales = filteredOtherSales.reduce((sum, sale) => sum + sale.amount, 0)
  const productTotals = filteredSales.reduce<Record<string, { litres: number; amount: number }>>((totals, sale) => {
    const current = totals[sale.product] || { litres: 0, amount: 0 }
    totals[sale.product] = { litres: current.litres + sale.litres, amount: current.amount + sale.amount }
    return totals
  }, { HSD: { litres: 0, amount: 0 }, PMG: { litres: 0, amount: 0 }, XTRON: { litres: 0, amount: 0 } })
  const normalizedEndDate = normalizeLocalCalendarDate(endDate)
  const ledgerEntriesAsOf = udhar.filter((entry) => {
    const date = normalizeLocalCalendarDate(entry.date)
    return Boolean(date && normalizedEndDate && date <= normalizedEndDate)
  })
  const receivablesAsOf = customers.length
    ? customers.reduce((total, customer) => {
      const customerLedger = udhar.filter((entry) => entry.customerId === customer.id)
      const entriesAsOf = ledgerEntriesAsOf.filter((entry) => entry.customerId === customer.id)
      const hasOpeningLedgerEntry = customerLedger.some((entry) => entry.type === 'Opening Balance')
      const ledgerBalance = entriesAsOf.reduce((balance, entry) => balance + entry.debit - entry.credit, 0)
      return total + ledgerBalance + (hasOpeningLedgerEntry ? 0 : customer.openingBalance)
    }, 0)
    : ledgerEntriesAsOf.reduce((balance, entry) => balance + entry.debit - entry.credit, 0)

  return {
    totalSales,
    totalFuelLitres,
    cashSales,
    creditSales,
    totalExpenses,
    commission,
    operatingExpenses: totalExpenses + commission,
    customerPayments,
    creditPosted,
    totalOtherSales,
    productTotals,
    netSales: totalSales + totalOtherSales - totalExpenses - commission,
    outstandingReceivables: receivablesAsOf,
  }
}

export function getCommissionTotal({ startDate, endDate, records }: CommissionSummaryInput) {
  return records.filter((record) => isDateWithinRange(record.date, startDate, endDate)).reduce((sum, record) => sum + record.amount, 0)
}

export function calculateFuelStockSummary({ product, opening, purchased, sold, adjustment }: FuelStockSummaryInput) {
  const remaining = opening + purchased - sold + adjustment

  return {
    product,
    opening,
    purchased,
    sold,
    adjustment,
    remaining,
  }
}

export function calculateDiscountAmount({ litres, rate, discountType, discountValue }: DiscountInput) {
  const grossAmount = litres * rate
  const safeDiscountValue = Math.max(0, discountValue)

  if (discountType === 'percent') {
    const discount = grossAmount * (safeDiscountValue / 100)
    return discount
  }

  return Math.min(grossAmount, litres * safeDiscountValue)
}

export function calculatePaymentFee({ amount, feePercent }: PaymentFeeInput) {
  return Math.max(0, amount) * (Math.max(0, feePercent) / 100)
}

export function calculateCommissionAmount(commissionableLitres: number, ratePerLitre: number) {
  return Math.max(0, commissionableLitres) * Math.max(0, ratePerLitre)
}
