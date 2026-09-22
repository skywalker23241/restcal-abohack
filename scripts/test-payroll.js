/* 工资与个税核算的回归测试。
 *
 * 这是全项目「算错代价最高」的一块，而以前它直接读设置页的输入框，
 * 离开浏览器就跑不起来。核算移到 public/assets/js/payroll.js 后可以用
 * 普通 node 驱动，这里把税法规则和边界条件固定下来。
 */

const assert = require("node:assert/strict");

require("../public/assets/js/payroll.js");
const {monthlySnapshot, DEFAULT_LEAVE_RATES, TAX_THRESHOLD} = global.XiuliPayroll;

const EPSILON = 1e-9;
const near = (actual, expected, message) =>
    assert.ok(
        Math.abs(actual - expected) < EPSILON,
        `${message}：期望 ${expected}，实际 ${actual}`
    );

// 一个月的统计，只包含 payroll 用得到的字段。
function stats(expectedWorkdays, leave = {}) {
    return {
        expectedWorkdays,
        leaveByStatus: {personal: 0, sick: 0, annual: 0, comp: 0, ...leave}
    };
}

// 一个典型的满勤月：月薪 30000、五险一金 3000、专项扣除 1500，
// 应纳税所得额 = 30000 - 3000 - 5000 - 1500 = 20500。
const FULL_MONTH = stats(22);
const CUMULATIVE_BASE = {
    salary: 30000,
    fixedDeductions: 3000,
    specialDeductions: 1500,
    taxMode: "cumulative"
};
const MONTHLY_TAXABLE = 20500;

// 起征点是税法常量，预期值是据此算出来的，先把它钉住。
assert.equal(TAX_THRESHOLD, 5000);
near(
    CUMULATIVE_BASE.salary - CUMULATIVE_BASE.fixedDeductions - TAX_THRESHOLD - CUMULATIVE_BASE.specialDeductions,
    MONTHLY_TAXABLE,
    "测试自身的应纳税所得额前提"
);

// 默认扣薪比例是 app.html 的 DEFAULT_RATES 唯一来源，改动会直接影响界面。
assert.deepEqual(DEFAULT_LEAVE_RATES, {personal: 100, sick: 50, annual: 0, comp: 0});

// 返回的字段被 app.html 的 buildSalaryReceipt 解构，改名会静默弄坏工资条。
{
    const snapshot = monthlySnapshot({stats: FULL_MONTH, salary: 30000});
    assert.deepEqual(Object.keys(snapshot).sort(), [
        "actual", "daily", "deduction", "estimatedTax", "isCumulative", "leaveDeduction", "salary", "taxDetails"
    ]);
}

// 1. 固定个税模式：日薪按应出勤折算，各类请假按各自比例扣款。
{
    const snapshot = monthlySnapshot({
        stats: stats(22, {personal: 1, sick: 2, annual: 1}),
        salary: 30000,
        fixedDeductions: 3000,
        estimatedTax: 1000,
        taxMode: "simple"
    });

    const daily = 30000 / 22;
    near(snapshot.daily, daily, "日薪");
    // 事假 1 天×100% + 病假 2 天×50% + 年假 1 天×0% = 2 个日薪
    near(snapshot.leaveDeduction, daily * 2, "请假扣款");
    near(snapshot.actual, 30000 - daily * 2 - 3000 - 1000, "实际到手");
    assert.equal(snapshot.isCumulative, false);
    assert.equal(snapshot.taxDetails, null);
    near(snapshot.estimatedTax, 1000, "固定模式下个税原样使用");
}

// 2. 应出勤为 0（整月节假日/未配置工作制）不得算出 NaN 或 Infinity。
{
    const snapshot = monthlySnapshot({
        stats: stats(0, {personal: 3}),
        salary: 30000,
        fixedDeductions: 3000,
        estimatedTax: 500
    });
    near(snapshot.daily, 0, "应出勤 0 时日薪");
    near(snapshot.leaveDeduction, 0, "应出勤 0 时请假扣款");
    near(snapshot.actual, 30000 - 3000 - 500, "应出勤 0 时到手");
    assert.ok(Number.isFinite(snapshot.actual));
}

// 3. 累计预扣 · 1 月：没有前期累计，落在 3% 档。
{
    const snapshot = monthlySnapshot({...CUMULATIVE_BASE, stats: FULL_MONTH, priorMonthStats: []});

    assert.equal(snapshot.isCumulative, true);
    near(snapshot.taxDetails.cumulativeTaxableTotal, MONTHLY_TAXABLE, "1 月累计应纳税所得额");
    near(snapshot.taxDetails.cumulativeTaxPaidPrior, 0, "1 月无前期已预扣");
    near(snapshot.estimatedTax, MONTHLY_TAXABLE * 0.03, "1 月个税");
    assert.equal(snapshot.taxDetails.taxRate, 3);
    near(snapshot.actual, 30000 - 3000 - 615, "1 月到手");
}

// 4. 累计预扣 · 2 月：累计额跨过 36000，税率跳到 10%，当月税 = 累计税 - 已预扣。
//    这正是「同样的月薪，年中某个月税后工资突然变少」的那一个月。
{
    const snapshot = monthlySnapshot({...CUMULATIVE_BASE, stats: FULL_MONTH, priorMonthStats: [FULL_MONTH]});

    near(snapshot.taxDetails.cumulativeTaxableTotal, 41000, "2 月累计应纳税所得额");
    near(snapshot.taxDetails.cumulativeTaxPaidPrior, 615, "1 月已预扣");
    near(snapshot.taxDetails.cumulativeTaxTotal, 41000 * 0.1 - 2520, "两个月累计税额");
    near(snapshot.estimatedTax, 1580 - 615, "2 月当月个税");
    assert.equal(snapshot.taxDetails.taxRate, 10);
}

// 5. 累计预扣 · 7 月：税率已稳定在 10% 档内，当月税回到单月水平。
{
    const snapshot = monthlySnapshot({
        ...CUMULATIVE_BASE,
        stats: FULL_MONTH,
        priorMonthStats: Array.from({length: 6}, () => FULL_MONTH)
    });

    near(snapshot.taxDetails.cumulativeTaxableTotal, 143500, "7 月累计应纳税所得额");
    near(snapshot.taxDetails.cumulativeTaxPaidPrior, 123000 * 0.1 - 2520, "前 6 个月已预扣");
    near(snapshot.estimatedTax, 2050, "7 月当月个税");
}

// 6. 前期月份的数量必须影响结果。工资条弹窗曾经把选中月份的统计配上
//    当前月份的序号，这条断言就是那个错配的护栏。
{
    const january = monthlySnapshot({...CUMULATIVE_BASE, stats: FULL_MONTH, priorMonthStats: []});
    const july = monthlySnapshot({
        ...CUMULATIVE_BASE,
        stats: FULL_MONTH,
        priorMonthStats: Array.from({length: 6}, () => FULL_MONTH)
    });
    assert.notEqual(january.estimatedTax, july.estimatedTax, "不同月份的累计预扣结果应该不同");
}

// 7. 累计预扣模式但未填月薪：算不出东西，回退到用户填的固定预估。
{
    const snapshot = monthlySnapshot({
        stats: FULL_MONTH,
        salary: 0,
        estimatedTax: 800,
        taxMode: "cumulative"
    });
    assert.equal(snapshot.isCumulative, true, "模式标识不受月薪影响");
    assert.equal(snapshot.taxDetails, null);
    near(snapshot.estimatedTax, 800, "回退到固定预估");
    near(snapshot.actual, 0, "没有月薪时到手不得为负");
}

// 8. 收入低于起征点：不交税，也不得算出负数。
{
    const snapshot = monthlySnapshot({
        stats: FULL_MONTH,
        salary: 4000,
        taxMode: "cumulative",
        priorMonthStats: []
    });
    near(snapshot.taxDetails.cumulativeTaxableTotal, 0, "低于起征点时应纳税所得额");
    near(snapshot.estimatedTax, 0, "低于起征点时不交税");
    near(snapshot.actual, 4000, "低于起征点时全额到手");
}

// 9. 最高一档：超过 960000 适用 45% 与速算扣除数 181920。
{
    const snapshot = monthlySnapshot({
        stats: FULL_MONTH,
        salary: 1_000_000,
        taxMode: "cumulative",
        priorMonthStats: []
    });
    assert.equal(snapshot.taxDetails.taxRate, 45);
    near(snapshot.estimatedTax, 995_000 * 0.45 - 181_920, "最高档个税");
}

// 10. 扣薪比例的容错：超出 0–100 的被夹住，填不出数字的回退默认值。
{
    const snapshot = monthlySnapshot({
        stats: stats(20, {personal: 1, sick: 1, annual: 1, comp: 1}),
        salary: 20000,
        rates: {personal: 150, sick: undefined, annual: -10, comp: 30}
    });
    const daily = 20000 / 20;
    // personal 夹到 100%、sick 回退默认 50%、annual 夹到 0%、comp 取 30%
    near(snapshot.leaveDeduction, daily * (1 + 0.5 + 0 + 0.3), "比例夹持与回退");
}

// 11. 请假扣款超过月薪：应发与到手都以 0 封底，不得出现负数工资或负数税。
{
    const simple = monthlySnapshot({
        stats: stats(1, {personal: 10}),
        salary: 1000,
        taxMode: "simple"
    });
    near(simple.actual, 0, "超额请假时到手封底 0");

    const cumulative = monthlySnapshot({
        stats: stats(1, {personal: 10}),
        salary: 1000,
        taxMode: "cumulative",
        priorMonthStats: []
    });
    near(cumulative.taxDetails.cumulativeTaxableTotal, 0, "超额请假时应纳税所得额封底 0");
    near(cumulative.estimatedTax, 0, "超额请假时不交税");
}

// 12. 前期月份里的请假会拉低累计应纳税所得额，进而拉低当月预扣。
{
    const withLeave = monthlySnapshot({
        ...CUMULATIVE_BASE,
        stats: FULL_MONTH,
        priorMonthStats: [stats(22, {personal: 5})]
    });
    const withoutLeave = monthlySnapshot({
        ...CUMULATIVE_BASE,
        stats: FULL_MONTH,
        priorMonthStats: [FULL_MONTH]
    });
    assert.ok(
        withLeave.taxDetails.cumulativeTaxableTotal < withoutLeave.taxDetails.cumulativeTaxableTotal,
        "前期请假应该拉低累计应纳税所得额"
    );
}

console.log("Payroll tests passed");
