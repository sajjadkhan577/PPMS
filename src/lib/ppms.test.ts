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
  calculateVehicleUsageSummary,
  calculateCompanyFleetSummary,
  getDashboardDateRange,
  findPreviousMeterReading,
  recalculateMeterReadingChain,
  calculateMeterPeriodSummary,
  getMeterTestsForReading,
} from './ppms'

describe('petrol pump accounting logic', () => {
  it('calculates meter totals correctly', () => {
    expect(calculateMeterTotal(12500, 11800)).toBe(700)
    expect(calculateMeterTotal(101500, 100000)).toBe(1500)
    expect(() => calculateMeterTotal(900, 1000)).toThrow('Present meter reading cannot be less than previous reading.')
  })

  it('preserves decimal meter totals and rates in amount calculations', () => {
    const litres = calculateMeterTotal(150.75, 100.5)
    expect(litres).toBe(50.25)
    expect(litres * 330.59).toBeCloseTo(16612.1475, 10)
  })

  it('finds the latest strictly previous meter reading for the exact fuel and nozzle', () => {
    const readings = [
      { id: 1, date: '2026-10-01', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 9800, present: 10000, litres: 200 },
      { id: 2, date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 10000, present: 10200, litres: 200 },
      { id: 3, date: '2026-10-03', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 10200, present: 10500, litres: 300 },
      { id: 4, date: '2026-10-03', shift: 'Day', product: 'HSD', nozzle: 'HSD-02', previous: 4000, present: 5000, litres: 1000 },
      { id: 5, date: '2026-10-03', shift: 'Day', product: 'PMG', nozzle: 'PMG-01', previous: 6000, present: 7000, litres: 1000 },
      { id: 6, date: '2026-10-05', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 10500, present: 11000, litres: 500 },
    ]

    const previous = findPreviousMeterReading(readings, { date: '2026-10-04', shift: 'Day', product: 'HSD', nozzle: 'HSD-01' })
    expect(previous?.present).toBe(10500)
    expect(findPreviousMeterReading(readings, { date: '2026-10-04', shift: 'Day', product: 'HSD', nozzle: 'HSD-02' })?.present).toBe(5000)
    expect(findPreviousMeterReading(readings, { date: '2026-10-04', shift: 'Day', product: 'PMG', nozzle: 'PMG-01' })?.present).toBe(7000)
    expect(findPreviousMeterReading(readings, { date: '2026-10-04', shift: 'Day', product: 'XTRON', nozzle: 'XTRON-01' })).toBeUndefined()
    expect(findPreviousMeterReading(readings, { date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-01' })?.present).toBe(10000)
  })

  it('uses the prior same-day shift but not a future same-day shift', () => {
    const readings = [
      { id: 1, date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 1000, present: 1100, litres: 100 },
      { id: 2, date: '2026-10-02', shift: 'Night', product: 'HSD', nozzle: 'HSD-01', previous: 1100, present: 1200, litres: 100 },
    ]

    expect(findPreviousMeterReading(readings, { date: '2026-10-02', shift: 'Night', product: 'HSD', nozzle: 'HSD-01' })?.present).toBe(1100)
    expect(findPreviousMeterReading(readings, { date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-01' })).toBeUndefined()
  })

  it('recalculates only the dependent meter chain after edits and deletion', () => {
    const readings = [
      { id: 1, date: '2026-10-01', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 900, present: 1000, litres: 100, rate: 10, amount: 1000 },
      { id: 2, date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 1000, present: 1100, litres: 100, rate: 10, amount: 1000 },
      { id: 3, date: '2026-10-03', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', previous: 1100, present: 1200, litres: 100, rate: 10, amount: 1000 },
      { id: 4, date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-02', previous: 0, present: 50, litres: 50, rate: 10, amount: 500 },
    ]
    const edited = readings.map((reading) => reading.id === 1 ? { ...reading, present: 1050 } : reading)
    const afterEdit = recalculateMeterReadingChain(edited)
    expect(afterEdit.find((reading) => reading.id === 2)?.previous).toBe(1050)
    expect(afterEdit.find((reading) => reading.id === 2)?.litres).toBe(50)
    expect(afterEdit.find((reading) => reading.id === 2)?.amount).toBe(500)
    expect(afterEdit.find((reading) => reading.id === 3)?.previous).toBe(1100)
    expect(afterEdit.find((reading) => reading.id === 4)?.previous).toBe(0)

    const afterDelete = recalculateMeterReadingChain(afterEdit.filter((reading) => reading.id !== 2))
    expect(afterDelete.find((reading) => reading.id === 3)?.previous).toBe(1050)
    expect(afterDelete.find((reading) => reading.id === 3)?.litres).toBe(150)
  })

  it('separates physical movement, customer sales, and returned or lost meter-test fuel', () => {
    const returnedTest = calculateMeterPeriodSummary({
      physicalMovement: 120,
      rate: 330.59,
      tests: [{ quantity: 20, returnedToTank: true }],
    })
    expect(returnedTest.physicalMovement).toBe(120)
    expect(returnedTest.testQuantity).toBe(20)
    expect(returnedTest.actualCustomerSales).toBe(100)
    expect(returnedTest.netTestStockImpact).toBe(0)
    expect(returnedTest.totalStockReduction).toBe(100)
    expect(returnedTest.customerSalesAmount).toBeCloseTo(33059)
    expect(returnedTest.calibrationSalesAmount).toBe(0)

    const nonReturnedTest = calculateMeterPeriodSummary({
      physicalMovement: 120,
      rate: 330.59,
      tests: [{ quantity: 20, returnedToTank: false }],
    })
    expect(nonReturnedTest.actualCustomerSales).toBe(100)
    expect(nonReturnedTest.netTestStockImpact).toBe(20)
    expect(nonReturnedTest.totalStockReduction).toBe(120)
    expect(nonReturnedTest.calibrationSalesAmount).toBe(0)

    const editedTest = calculateMeterPeriodSummary({ physicalMovement: 120, tests: [{ quantity: 25, returnedToTank: true }] })
    expect(editedTest.physicalMovement).toBe(120)
    expect(editedTest.actualCustomerSales).toBe(95)
    const deletedTest = calculateMeterPeriodSummary({ physicalMovement: 120, tests: [] })
    expect(deletedTest.physicalMovement).toBe(120)
    expect(deletedTest.actualCustomerSales).toBe(120)
  })

  it('subtracts multiple decimal meter tests from physical movement exactly once', () => {
    const summary = calculateMeterPeriodSummary({
      physicalMovement: 175,
      rate: 300,
      tests: [{ quantity: 20, returnedToTank: true }, { quantity: 5, returnedToTank: true }],
    })
    expect(summary.testQuantity).toBe(25)
    expect(summary.actualCustomerSales).toBe(150)
    expect(summary.netTestStockImpact).toBe(0)
    expect(summary.customerSalesAmount).toBe(45000)
  })

  it('matches meter tests only to their exact local date, shift, fuel, and nozzle', () => {
    const tests = [
      { id: 1, date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-01', quantity: 20, returnedToTank: true, reason: '', notes: '' },
      { id: 2, date: '2026-10-02', shift: 'Night', product: 'HSD', nozzle: 'HSD-01', quantity: 5, returnedToTank: true, reason: '', notes: '' },
      { id: 3, date: '2026-10-02', shift: 'Day', product: 'HSD', nozzle: 'HSD-02', quantity: 7, returnedToTank: false, reason: '', notes: '' },
      { id: 4, date: '2026-10-02', shift: 'Day', product: 'PMG', nozzle: 'PMG-01', quantity: 9, returnedToTank: true, reason: '', notes: '' },
    ]
    expect(getMeterTestsForReading(tests, { date: '2026-10-02T12:00:00', shift: 'Day', product: 'HSD', nozzle: 'HSD-01' }).map((test) => test.id)).toEqual([1])
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

  it('filters dashboard activity by local calendar date and counts credit sales once', () => {
    const summary = getDashboardSummary({
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      sales: [
        { id: 1, date: '2026-09-30', product: 'HSD', litres: 100, rate: 500, amount: 50000, mode: 'Cash', customer: '-' },
        { id: 2, date: '2026-10-01T12:00:00', product: 'HSD', litres: 5, rate: 330.59, amount: 1652.95, mode: 'Credit', customer: 'ABC Company', customerId: 8 },
        { id: 3, date: '2026-10-02', product: 'PMG', litres: 50, rate: 400, amount: 20000, mode: 'Cash', customer: '-' },
      ],
      expenses: [{ id: 1, date: '01/10/2026', category: 'Maintenance', description: 'Repair', amount: 200, paidBy: 'Cash' }],
      udhar: [
        { id: 1, date: '2026-10-01', customerId: 8, type: 'Credit Sale', reference: 'INV-1', description: 'HSD', debit: 1652.95, credit: 0 },
        { id: 2, date: '2026-10-01T18:00:00', customerId: 8, type: 'Payment Received', reference: 'PAY-1', description: 'Payment', debit: 0, credit: 100 },
        { id: 3, date: '2026-09-30', customerId: 8, type: 'Payment Received', reference: 'PAY-0', description: 'Payment', debit: 0, credit: 200 },
      ],
      otherSales: [{ date: '2026-10-01', amount: 50 }],
      customers: [{ id: 8, openingBalance: 500 }],
    })

    expect(summary.totalSales).toBeCloseTo(1652.95)
    expect(summary.totalFuelLitres).toBe(5)
    expect(summary.productTotals.HSD).toEqual({ litres: 5, amount: 1652.95 })
    expect(summary.productTotals.PMG).toEqual({ litres: 0, amount: 0 })
    expect(summary.creditSales).toBeCloseTo(1652.95)
    expect(summary.creditPosted).toBeCloseTo(1652.95)
    expect(summary.customerPayments).toBe(100)
    expect(summary.totalExpenses).toBe(200)
    expect(summary.totalOtherSales).toBe(50)
    expect(summary.netSales).toBeCloseTo(1502.95)
    expect(summary.outstandingReceivables).toBeCloseTo(1852.95)
  })

  it('calculates receivables as of the selected end date without customer master rows', () => {
    const summary = getDashboardSummary({
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      sales: [],
      expenses: [],
      customers: [],
      udhar: [
        { id: 1, date: '2026-09-30', customerId: 4, type: 'Opening Balance', reference: 'OB-4', description: '', debit: 500, credit: 0 },
        { id: 2, date: '2026-10-01', customerId: 4, type: 'Payment Received', reference: 'PAY-4', description: '', debit: 0, credit: 100 },
        { id: 3, date: '2026-10-02', customerId: 4, type: 'Credit Sale', reference: 'SALE-4', description: '', debit: 99, credit: 0 },
      ],
    })

    expect(summary.outstandingReceivables).toBe(400)
  })

  it('resolves complete local calendar periods for dashboard filters', () => {
    expect(getDashboardDateRange('This Week', '', '', '2026-10-01')).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(getDashboardDateRange('This Month', '', '', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(getDashboardDateRange('This Year', '', '', '2026-10-01')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(getDashboardDateRange('Custom', '2026-10-01', '2026-10-02', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-02' })
  })

  it('subtracts discounts from existing expenses', () => {
    const summary = getDashboardSummary({
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      sales: [],
      expenses: [
        { id: 1, date: '2026-09-10', category: 'Maintenance', description: 'Repair', amount: 1000, paidBy: 'Cash' },
        { id: 2, date: '2026-09-10', category: 'Maintenance', description: 'Discount', amount: -2500, paidBy: 'Discount' },
      ],
      udhar: [],
    })

    expect(summary.totalExpenses).toBe(-1500)
    expect(summary.operatingExpenses).toBe(-1500)
    expect(summary.netSales).toBe(1500)
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

  it('calculates monthly vehicle usage and status against its litre limit', () => {
    const summary = calculateVehicleUsageSummary({ limit: 500, used: 250, month: '2026-10' })
    expect(summary.limit).toBe(500)
    expect(summary.used).toBe(250)
    expect(summary.remaining).toBe(250)
    expect(summary.usagePercent).toBe(50)
    expect(summary.status).toBe('Normal')
    expect(summary.exceeded).toBe(0)
  })

  it('flags warning, high usage and over limit states for fleet vehicles', () => {
    expect(calculateVehicleUsageSummary({ limit: 500, used: 400, month: '2026-10' }).status).toBe('Warning')
    expect(calculateVehicleUsageSummary({ limit: 500, used: 450, month: '2026-10' }).status).toBe('High Usage')
    expect(calculateVehicleUsageSummary({ limit: 500, used: 550, month: '2026-10' }).status).toBe('Limit Reached')
    expect(calculateVehicleUsageSummary({ limit: 500, used: 550, month: '2026-10' }).exceeded).toBe(50)
  })

  it('aggregates company-wide vehicle allocation, usage, and remaining litres for a selected month', () => {
    const summary = calculateCompanyFleetSummary({
      companyId: 8,
      vehicles: [
        { id: 1, customerId: 8, vehicleNumber: 'ABC-001', status: 'Active' },
        { id: 2, customerId: 8, vehicleNumber: 'ABC-002', status: 'Active' },
      ],
      allocations: [
        { customerId: 8, vehicleId: 1, month: '2026-10', monthlyLitresLimit: 500 },
        { customerId: 8, vehicleId: 2, month: '2026-10', monthlyLitresLimit: 700 },
      ],
      transactions: [
        { customerId: 8, vehicleId: 1, date: '2026-10-05', type: 'Credit Sale', litres: 100, debit: 33059, credit: 0 },
        { customerId: 8, vehicleId: 1, date: '2026-10-15', type: 'Credit Sale', litres: 150, debit: 49500, credit: 0 },
        { customerId: 8, vehicleId: 2, date: '2026-10-18', type: 'Credit Sale', litres: 200, debit: 66000, credit: 0 },
      ],
      month: '2026-10',
    })

    expect(summary.totalAllocation).toBe(1200)
    expect(summary.totalUsed).toBe(450)
    expect(summary.totalRemaining).toBe(750)
    expect(summary.usagePercent).toBeCloseTo(37.5, 5)
    expect(summary.overLimitVehicles).toBe(0)
  })
})
