/* 抓取应用的一组输出快照，用于重构前后逐字节比对。
 * 覆盖：纯文本产物（请假条、CSV、ICS）和几处代表性的 innerHTML。
 * 纯文本对空白敏感，是缩进类改动最容易悄悄弄坏的地方。 */
const SNAPSHOT_SCRIPT = `(async () => {
  try {
    Object.keys(state.records).forEach(key => delete state.records[key]);
    state.records["2026-09-16"] = {status: "annual", leaveType: "年假", reason: "家庭安排", note: ["第一行", "第二行"].join(String.fromCharCode(10)), updatedAt: "2026-09-16T01:02:03.000Z"};
    state.records["2026-09-17"] = {status: "work", note: "完成上线检查", overtime: {hours: 2.5, rate: 2, reason: "上线", updatedAt: "2026-09-17T01:02:03.000Z"}, updatedAt: "2026-09-17T01:02:03.000Z"};
    state.settings.salary = 30000;
    state.settings.deduction = 3000;
    state.salary = {...state.salary, monthlySalary: 30000, fixedDeductions: 3000, estimatedTax: 1200, specialDeductions: 1500, taxMode: "cumulative"};
    state.settings.annualQuota = 10;
    state.settings.applicantName = "测试用户";
    currentYear = 2026; currentMonth = 9;

    await render();

    openLeaveGenerator({start: "2026-09-16", end: "2026-09-16", applicant: "测试用户"});
    generateLeaveDoc();

    const stats = calculateStats(2026, 9);
    const snapshot = calculateSalarySnapshot(stats, 2026, 9);

    // 每项单独捕错：某一项报错不应该让整份快照失败，否则看不出是哪里坏了。
    const probes = {
        leaveDoc: () => document.getElementById("leaveOutput").value,
        salaryReceipt: () => JSON.stringify(buildSalaryReceipt({stats, ...snapshot}, 2026, 9)),
        salaryHtml: () => document.getElementById("salaryResult").innerHTML,
        statsMonthHtml: () => document.getElementById("monthStats").innerHTML,
        statsYearHtml: () => document.getElementById("yearStats").innerHTML,
        quotaHtml: () => document.getElementById("quotaSummary").innerHTML,
        calendarHtml: () => document.getElementById("calendarGrid").innerHTML,
        alertsHtml: () => document.getElementById("homeAlerts").innerHTML,
        stats: () => JSON.stringify(stats),
        salarySnapshot: () => JSON.stringify(snapshot),
        dayInfo: () => JSON.stringify(["2026-09-16", "2026-10-01", "2026-02-15", "2026-09-20"].map(d => getDayInfo(fromISO(d)))),
        lunar: () => JSON.stringify(["2026-01-01", "2026-02-17", "2026-06-19"].map(d => getLunarText(fromISO(d)))),
        solarTerms: () => JSON.stringify(["2026-04-05", "2026-12-21"].map(d => getSolarTermText(fromISO(d)))),
        tickets: () => JSON.stringify(getTicketReminders(2026)),
        quota: () => JSON.stringify(calculateQuotaBalances(2026, 10, 3)),
        ics: () => XiuliIcs.generateIcs({records: state.records, statusLabels: STATUS_LABELS, include: {leave: true, overtime: true, notes: true}}),
        heatmap: () => statsHeatmapHtml("month", getMonthDates(2026, 9), stats),
        yearChart: () => yearLeaveChartHtml(calculateStats(2026)),
        csvExportShape: () => CSV_HEADERS.join("|") + "||" + CSV_REQUIRED_HEADERS.join("|"),
        modalHtml: () => { openModal("2026-09-16"); const html = document.getElementById("dayModal").innerHTML; closeModal(); return html; },
        globals: () => ["XiuliIcs", "XiuliPayroll", "RestCalI18n", "RestCalOnboardingView", "RestCalProductTour"].filter(k => window[k]).join(","),
        // 2.1.1 及以前的存档把工资/额度/购票字段平铺在 settings 里。去掉镜像写入后，
        // 这条加载期回退是老用户升级不丢数据的唯一保障。
        legacyMigration: () => {
            const legacy = {records: {}, settings: {
                salary: 12345, deduction: 678, estimatedTax: 90, specialDeductions: 111,
                taxMode: "cumulative", payday: 20,
                annualExpireRule: "next-06-30", compExpireRule: "year-end",
                ticketAdvanceDays: 21, ticketReminderTime: "08:30"
            }};
            const saved = localStorage.getItem(STORAGE_KEY);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
            const migrated = loadState();
            if (saved === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, saved);
            return [
                migrated.salary.monthlySalary, migrated.salary.fixedDeductions, migrated.salary.estimatedTax,
                migrated.salary.specialDeductions, migrated.salary.taxMode, migrated.salary.payday,
                migrated.quotaRules.annualExpireRule, migrated.quotaRules.compExpireRule,
                migrated.ticketPreferences.advanceDays, migrated.ticketPreferences.reminderTime
            ].join("|");
        },
        // 设置页输入 → syncSettingsFromInputs → saveState → loadState → fillSettingsInputs 的完整往返。
        // 工资类字段只剩 state.salary 一份存储后，这条链路断了就是“设置存不下”。
        settingsRoundTrip: () => {
            els.salaryInput.value = "26800";
            els.deductionInput.value = "2450";
            els.estimatedTaxInput.value = "930";
            if (els.taxCalculationMode) els.taxCalculationMode.value = "cumulative";
            if (els.annualExpireRule) els.annualExpireRule.value = "next-06-30";
            els.paydayInput.value = "15";
            syncSettingsFromInputs();
            saveState();
            const reloaded = loadState();
            applyUserData(reloaded);
            return [
                els.salaryInput.value, els.deductionInput.value, els.estimatedTaxInput.value,
                els.taxCalculationMode ? els.taxCalculationMode.value : "-",
                els.annualExpireRule ? els.annualExpireRule.value : "-",
                els.paydayInput.value
            ].join("|");
        },
        reachableFunctions: () => [
            render, renderStats, renderSalary, calculateStats, getDayInfo, saveState, loadState,
            bindEvents, init, exportCsv, parseCsv, webdavRequest, syncGoogleCalendar, openOnboarding,
            getLunarText, getSolarTermText, getTicketReminders, calculateQuotaBalances, showToast
        ].filter(fn => typeof fn === "function").length + "/19"
    };

    const out = {};
    for (const [key, run] of Object.entries(probes)) {
        try { out[key] = run(); } catch (error) { out[key] = "__ERROR__ " + error.message; }
    }
    return out;
  } catch (error) {
    return {__fatal: String(error && error.stack || error)};
  }
})()`;
module.exports = {SNAPSHOT_SCRIPT};
