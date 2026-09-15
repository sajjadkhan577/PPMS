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

export function calculateMeterTotal(presentReading: number, previousReading: number) {
  if (presentReading < previousReading) {
    throw new Error('Present meter reading cannot be less than previous reading.')
  }

  return presentReading - previousReading
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

export function getDashboardSummary({ startDate, endDate, sales, expenses, udhar, commission: commissionRecords = [] }: DashboardSummaryInput) {
  const filteredSales = sales.filter((sale) => sale.date >= startDate && sale.date <= endDate)
  const filteredExpenses = expenses.filter((expense) => expense.date >= startDate && expense.date <= endDate && expense.category !== 'Commission')
  const filteredUdhar = udhar.filter((entry) => entry.date >= startDate && entry.date <= endDate)
  const commission = getCommissionTotal({ startDate, endDate, records: commissionRecords })

  const totalSales = filteredSales.reduce((sum, sale) => sum + sale.amount, 0)
  const totalFuelLitres = filteredSales.reduce((sum, sale) => sum + sale.litres, 0)
  const creditSales = filteredSales.filter((sale) => sale.mode === 'Credit').reduce((sum, sale) => sum + sale.amount, 0)
  const cashSales = totalSales - creditSales
  const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0)
  const customerPayments = filteredUdhar.filter((item) => item.type === 'Payment Received').reduce((sum, item) => sum + item.credit, 0)
  const creditPosted = filteredUdhar.filter((item) => item.type === 'Credit Sale').reduce((sum, item) => sum + item.debit, 0)

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
    netSales: totalSales - totalExpenses - commission,
    outstandingReceivables: filteredUdhar.reduce((sum, item) => sum + item.debit - item.credit, 0),
  }
}

export function getCommissionTotal({ startDate, endDate, records }: CommissionSummaryInput) {
  return records.filter((record) => record.date >= startDate && record.date <= endDate).reduce((sum, record) => sum + record.amount, 0)
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
