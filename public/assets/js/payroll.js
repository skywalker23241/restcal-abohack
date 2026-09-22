/**
 * 休历 · RestCal - 工资与个税核算
 *
 * 纯计算：不读 DOM、不读全局状态，所有输入显式传入，所以可以用
 * `node scripts/test-payroll.js` 直接验证。累计预扣需要本年前几个月的统计，
 * 由调用方作为 priorMonthStats 传进来，模块本身不认识日历。
 *
 * stats 的形状来自 app.html 的 calculateStats()，这里只用到两个字段：
 *   expectedWorkdays  当月应出勤天数
 *   leaveByStatus     {personal, sick, annual, comp} 各类请假天数
 */
(function (global) {
    "use strict";

    // 起征点与七级超额累进预扣率表（《个人所得税法》居民个人工资薪金所得）。
    // limit 是累计应纳税所得额的上界，quick 是速算扣除数。
    const TAX_THRESHOLD = 5000;
    const TAX_BRACKETS = Object.freeze([
        {limit: 36000, rate: 0.03, quick: 0},
        {limit: 144000, rate: 0.10, quick: 2520},
        {limit: 300000, rate: 0.20, quick: 16920},
        {limit: 420000, rate: 0.25, quick: 31920},
        {limit: 660000, rate: 0.30, quick: 52920},
        {limit: 960000, rate: 0.35, quick: 85920},
        {limit: Infinity, rate: 0.45, quick: 181920}
    ].map(Object.freeze));

    // 各类请假的默认扣薪比例（%）。这张表同时定义了「哪些状态会扣薪」。
    // 冻结：app.html 的 DEFAULT_RATES 直接引用它，不应该被谁改掉。
    const DEFAULT_LEAVE_RATES = Object.freeze({personal: 100, sick: 50, annual: 0, comp: 0});
    const LEAVE_RATE_KEYS = Object.keys(DEFAULT_LEAVE_RATES);

    function positive(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 0;
    }

    function percent(value, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(100, Math.max(0, number));
    }

    function normalizeRates(rates) {
        const source = rates && typeof rates === "object" ? rates : {};
        const result = {};
        for (const key of LEAVE_RATE_KEYS) {
            result[key] = percent(source[key], DEFAULT_LEAVE_RATES[key]);
        }
        return result;
    }

    // 日薪按当月应出勤天数折算：同样的月薪，应出勤越多日薪越低。
    function dailyRate(salary, expectedWorkdays) {
        return expectedWorkdays > 0 ? salary / expectedWorkdays : 0;
    }

    function leaveDeductionFor(stats, daily, rates) {
        const leave = stats?.leaveByStatus || {};
        return LEAVE_RATE_KEYS.reduce(
            (sum, key) => sum + daily * (Number(leave[key]) || 0) * (rates[key] / 100),
            0
        );
    }

    function taxableIncome(gross, fixedDeductions, specialDeductions) {
        return Math.max(0, gross - fixedDeductions - TAX_THRESHOLD - specialDeductions);
    }

    // 税额按累计应纳税所得额套档，而不是按单月——这正是累计预扣法与
    // 按月代扣的区别，也是年中「税后工资越来越少」的原因。
    function taxOn(cumulativeTaxable) {
        if (cumulativeTaxable <= 0) return {tax: 0, bracket: TAX_BRACKETS[0]};
        const bracket = TAX_BRACKETS.find(item => cumulativeTaxable <= item.limit) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
        return {tax: Math.max(0, cumulativeTaxable * bracket.rate - bracket.quick), bracket};
    }

    // 累计预扣：先算到本月为止的累计税额，再减去前几个月已预扣的部分。
    // 前几个月按当前月薪回推（休历不保存历史工资），所以调薪后的估算会有偏差。
    function cumulativeTax({priorMonthStats, salary, fixedDeductions, specialDeductions, rates, currentLeaveDeduction}) {
        let cumulativeTaxablePrior = 0;
        for (const monthStats of priorMonthStats || []) {
            const daily = dailyRate(salary, monthStats.expectedWorkdays);
            const monthLeaveDeduction = leaveDeductionFor(monthStats, daily, rates);
            const monthGross = Math.max(0, salary - monthLeaveDeduction);
            cumulativeTaxablePrior += taxableIncome(monthGross, fixedDeductions, specialDeductions);
        }
        const paidPrior = taxOn(cumulativeTaxablePrior).tax;

        const currentGross = Math.max(0, salary - currentLeaveDeduction);
        const cumulativeTaxableTotal = cumulativeTaxablePrior + taxableIncome(currentGross, fixedDeductions, specialDeductions);
        const total = taxOn(cumulativeTaxableTotal);

        return {
            currentMonthTax: Math.max(0, total.tax - paidPrior),
            cumulativeTaxTotal: total.tax,
            cumulativeTaxPaidPrior: paidPrior,
            cumulativeTaxableTotal,
            taxRate: total.bracket.rate * 100,
            specialDeductions
        };
    }

    /**
     * 核算一个月的工资。
     *
     * @param {object}   input
     * @param {object}   input.stats             当月统计
     * @param {number}   input.salary            月薪
     * @param {number}   input.fixedDeductions   五险一金等固定扣除
     * @param {number}   input.estimatedTax      固定个税预估（simple 模式）
     * @param {number}   input.specialDeductions 专项附加扣除（cumulative 模式）
     * @param {string}   input.taxMode           "simple" | "cumulative"
     * @param {object}   input.rates             各类请假扣薪比例（%）
     * @param {object[]} input.priorMonthStats   cumulative 模式下本年 1..month-1 的统计
     */
    function monthlySnapshot({
        stats,
        salary,
        fixedDeductions,
        estimatedTax,
        specialDeductions,
        taxMode,
        rates,
        priorMonthStats
    } = {}) {
        const monthlySalary = positive(salary);
        const deduction = positive(fixedDeductions);
        const special = positive(specialDeductions);
        const normalizedRates = normalizeRates(rates);
        const isCumulative = taxMode === "cumulative";

        const daily = dailyRate(monthlySalary, stats?.expectedWorkdays);
        const leaveDeduction = leaveDeductionFor(stats, daily, normalizedRates);

        let tax = positive(estimatedTax);
        let taxDetails = null;
        // 月薪未填时累计预扣算不出东西，回退到用户填的固定预估。
        if (isCumulative && monthlySalary > 0) {
            taxDetails = cumulativeTax({
                priorMonthStats,
                salary: monthlySalary,
                fixedDeductions: deduction,
                specialDeductions: special,
                rates: normalizedRates,
                currentLeaveDeduction: leaveDeduction
            });
            tax = taxDetails.currentMonthTax;
        }

        return {
            salary: monthlySalary,
            deduction,
            estimatedTax: tax,
            isCumulative,
            taxDetails,
            daily,
            leaveDeduction,
            actual: Math.max(0, monthlySalary - leaveDeduction - deduction - tax)
        };
    }

    global.XiuliPayroll = {
        TAX_THRESHOLD,
        TAX_BRACKETS,
        DEFAULT_LEAVE_RATES,
        monthlySnapshot
    };
})(typeof window !== "undefined" ? window : global);
