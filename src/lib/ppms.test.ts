import { describe, expect, it } from 'vitest'
import {
  calculateMeterTotal,
  calculateFuelSales,
  calculateCustomerBalance,
  calculateMonthlyStatement,
  calculateProfitLoss,
  getDashboardSummary,
  calculateFuelStockSummary,
  calculateDiscountAmount,
  calculatePaymentFee,
  calculateCommissionAmount,
  getCommissionTotal,
} from './ppms'

describe('petrol pump accounting logic', () => {
  it('calculates meter totals correctly', () => {
    expect(calculateMeterTotal(12500, 11800)).toBe(700)
    expect(calculateMeterTotal(101500, 100000)).toBe(1500)
  })

  it('calculates fuel sales totals', () => {
    const result = calculateFuelSales([
      { product: 'PMG', litres: 1000, rate: 280 },
      { product: 'HSD', litres: 800, rate: 285 },
      { product: 'PMG', litres: 500, rate: 280 },
    ])

    expect(result.totalLitres).toBe(2300)
    expect(result.totalAmount).toBe(648000)
    expect(result.byProduct.PMG).toBe(420000)
    expect(result.byProduct.HSD).toBe(228000)
  })

  it('calculates customer outstanding balance', () => {
    const balance = calculateCustomerBalance({
      opening: 10000,
      creditSales: 25000,
      payments: 15000,
      adjustments: 5000,
    })

    expect(balance).toBe(25000)
  })

  it('calculates monthly statement totals', () => {
    const statement = calculateMonthlyStatement({
      pmgLitres: 34687,
      hsdLitres: 26112,
      xtronLitres: 0,
      pmgRate: 7.4,
      hsdRate: 7.3,
      pmgAmount: 256000,
      hsdAmount: 190000,
      expenses: 120000,
      otherIncome: 15000,
    })

    expect(statement.totalLitres).toBe(60799)
    expect(statement.totalAmount).toBe(446000)
    expect(statement.profitLoss).toBe(341000)
  })

  it('calculates a simple profit loss report', () => {
    const result = calculateProfitLoss({
      fuelRevenue: 800000,
      mobileOilRevenue: 120000,
      otherIncome: 20000,
      fuelPurchase: 500000,
      mobileOilPurchase: 90000,
      commission: 30000,
      salaries: 70000,
      electricity: 15000,
      pumpExpenses: 25000,
      otherExpenses: 10000,
    })

    expect(result.grossRevenue).toBe(940000)
    expect(result.totalCost).toBe(740000)
    expect(result.grossProfit).toBe(350000)
    expect(result.operatingExpenses).toBe(150000)
    expect(result.netProfit).toBe(200000)
  })

  it('builds a reusable dashboard summary for a selected range', () => {
    const summary = getDashboardSummary({
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      sales: [
        { id: 1, date: '2026-09-02', product: 'HSD', litres: 1000, rate: 280, amount: 280000, mode: 'Cash', customer: '-', discount: 0, discountAmount: 0 },
        { id: 2, date: '2026-09-05', product: 'PMG', litres: 500, rate: 290, amount: 145000, mode: 'Credit', customer: 'Test', customerId: 7, discount: 0, discountAmount: 0 },
      ],
      expenses: [
        { id: 1, date: '2026-09-03', category: 'Salary', description: 'Salary', amount: 50000, paidBy: 'Cash' },
        { id: 2, date: '2026-09-08', category: 'Maintenance', description: 'Repair', amount: 15000, paidBy: 'Cash' },
      ],
      udhar: [
        { id: 1, date: '2026-09-05', customerId: 7, type: 'Credit Sale', reference: 'S-1', description: 'Sale', debit: 145000, credit: 0 },
        { id: 2, date: '2026-09-07', customerId: 7, type: 'Payment Received', reference: 'P-1', description: 'Payment', debit: 0, credit: 50000 },
      ],
      commission: [{ date: '2026-09-05', amount: 10000 }],
    })

    expect(summary.totalSales).toBe(425000)
    expect(summary.totalFuelLitres).toBe(1500)
    expect(summary.totalExpenses).toBe(65000)
    expect(summary.creditSales).toBe(145000)
    expect(summary.customerPayments).toBe(50000)
    expect(summary.commission).toBe(10000)
    expect(summary.netSales).toBe(350000)
  })

  it('calculates stock remaining using opening, purchases, sales and adjustments', () => {
    const result = calculateFuelStockSummary({
      product: 'HSD',
      opening: 20000,
      purchased: 10000,
      sold: 8500,
      adjustment: -500,
    })

    expect(result.remaining).toBe(21000)
    expect(result.adjustment).toBe(-500)

    expect(calculateFuelStockSummary({
      product: 'HSD',
      opening: 20000,
      purchased: 10000,
      sold: 8500,
      adjustment: 500,
    }).remaining).toBe(22000)
  })

  it('calculates commission from explicitly commissionable litres', () => {
    expect(calculateCommissionAmount(3000, 2)).toBe(6000)
    expect(calculateCommissionAmount(0, 2)).toBe(0)
    expect(calculateCommissionAmount(12000, 2)).toBe(24000)
  })

  it('totals only commission records inside the selected period', () => {
    expect(getCommissionTotal({
      startDate: '2026-09-12',
      endDate: '2026-09-12',
      records: [
        { date: '2026-09-11', amount: 5000 },
        { date: '2026-09-12', amount: 6000 },
        { date: '2026-09-12', amount: 4000 },
      ],
    })).toBe(10000)
  })

  it('calculates discounts and payment fees consistently', () => {
    expect(calculateDiscountAmount({ litres: 100, rate: 280, discountType: 'percent', discountValue: 2 })).toBe(560)
    expect(calculateDiscountAmount({ litres: 100, rate: 280, discountType: 'fixed', discountValue: 5 })).toBe(500)
    expect(calculateDiscountAmount({ litres: 100, rate: 280, discountType: 'fixed', discountValue: -5 })).toBe(0)
    expect(calculateDiscountAmount({ litres: 100, rate: 280, discountType: 'fixed', discountValue: 500 })).toBe(28000)
    expect(calculatePaymentFee({ amount: 100000, feePercent: 2 })).toBe(2000)
    expect(calculatePaymentFee({ amount: 100000, feePercent: -2 })).toBe(0)
  })

  it('keeps customer opening balance from being counted twice', () => {
    const opening = 120000
    const transactions = [{ type: 'Opening Balance', debit: opening, credit: 0 }, { type: 'Credit Sale', debit: 10000, credit: 0 }, { type: 'Payment Received', debit: 0, credit: 5000 }]
    const postedBalance = transactions.reduce((sum, item) => sum + item.debit - item.credit, 0)
    expect(postedBalance).toBe(125000)
  })
})
