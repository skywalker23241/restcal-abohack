/* 休历 · RestCal —— 统计与概览模块、首页提醒、工资条、假期额度、购票提醒
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function renderStats() {
    const monthStats = calculateStats(currentYear, currentMonth);
    const yearStats = calculateStats(currentYear);
    renderMonthSummary(monthStats);
    const monthStatsTitle = document.getElementById("monthStatsTitle");
    if (monthStatsTitle) monthStatsTitle.textContent = `${currentYear}年${currentMonth}月`;
    const yearStatsTitle = document.getElementById("yearStatsTitle");
    if (yearStatsTitle) yearStatsTitle.textContent = `${currentYear}年`;
    els.monthStats.innerHTML = statsHeatmapHtml("month", getMonthDates(currentYear, currentMonth), monthStats);
    els.yearStats.innerHTML = yearStatsMode === "months"
        ? yearLeaveChartHtml(yearStats)
        : statsHeatmapHtml("year", getYearDates(currentYear), yearStats);
    renderQuotaSummary(yearStats);
}

function setStatsPeriodMode(mode) {
    if (!["month", "year"].includes(mode)) return;
    statsPeriodMode = mode;
    const isMonth = mode === "month";
    els.monthStatsPanel.hidden = !isMonth;
    els.yearStatsPanel.hidden = isMonth;
    els.statsPeriodMode.querySelectorAll(".seg-btn").forEach(button => {
        const active = button.dataset.statsPeriod === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function overviewModuleMetadata(english = getLanguage() === "en") {
    const rows = [
        ["attendance", "calendar-check", "请假 / 出勤", "Leave / attendance", "跟随所选月份", "Selected month"],
        ["annualQuota", "chart-donut", "剩余年假", "Annual leave left", "跟随所选年份", "Selected year"],
        ["leaveDeduction", "coins", "请假每日扣款", "Daily leave deduction", "跟随所选月份", "Selected month"],
        ["estimatedSalary", "wallet", "预计实发", "Estimated pay", "跟随所选月份", "Selected month"],
        ["nextHoliday", "confetti", "距下个节假日", "Next holiday in", "从今天起算", "From today"],
        ["ticketSale", "train", "火车票开售", "Ticket sale", "从今天起算", "From today"],
        ["payday", "money", "发薪日", "Payday", "从今天起算", "From today"],
        ["overtime", "clock-countdown", "本月加班", "Overtime", "跟随所选月份", "Selected month"],
        ["habit", "fire", "习惯打卡", "Habit check-in", "今天", "Today"]
    ];
    return Object.fromEntries(rows.map(([id, icon, zh, en, zhDesc, enDesc]) => [
        id, {id, icon, label: english ? en : zh, description: english ? enDesc : zhDesc}
    ]));
}

function nextPayday(day) {
    if (!day) return null;
    const build = (year, month) => new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
    let result = build(today.getFullYear(), today.getMonth());
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (result < todayStart) result = build(today.getFullYear(), today.getMonth() + 1);
    return result;
}

function nextTicketSaleReminder() {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return [today.getFullYear(), today.getFullYear() + 1]
        .flatMap(year => calendarApi.years.has(year) ? getTicketReminders(year) : [])
        .find(item => item.departure >= start) || null;
}

function getOverviewModuleItems(monthStats) {
    const english = getLanguage() === "en";
    const meta = overviewModuleMetadata(english);
    const salary = calculateSalarySnapshot(monthStats, currentYear, currentMonth);
    const holiday = findNextHoliday();
    const holidayName = holiday ? (window.RestCalI18n?.t(holiday.name) || holiday.name) : "";
    const annualQuota = cleanNumber(els.annualQuotaInput.value);
    const annual = calculateQuotaBalances(currentYear, annualQuota, cleanNumber(els.compQuotaInput.value)).annual;
    const annualLeft = Math.max(0, annual.total - annual.used);
    const ticket = nextTicketSaleReminder();
    const ticketDays = ticket ? diffDays(today, ticket.saleDate) : 0;
    const payday = nextPayday(state.salary?.payday);
    const paydayDays = payday ? diffDays(today, payday) : 0;
    const habitDone = habitCheckinCountForDate(toISO(today));
    const streak = Math.max(0, ...state.habits.map(habit => habitStreak(habit.id)));
    const daysText = value => `${value} ${english ? "days" : "天"}`;
    return {
        attendance: {...meta.attendance, value: daysText(`${monthStats.totalLeave} / ${monthStats.actualWorkdays}`), compact: english ? `${monthStats.totalLeave} leave · ${monthStats.actualWorkdays} attended` : `${monthStats.totalLeave} 请假 · ${monthStats.actualWorkdays} 出勤`, meta: english ? "Selected month: leave / marked attendance" : "所选月份：请假天数 / 已标记出勤天数", action: "stats"},
        annualQuota: {...meta.annualQuota, value: annualQuota ? daysText(roundQuota(annualLeft)) : (english ? "Not set" : "未设置"), compact: annualQuota ? (english ? `${roundQuota(annualLeft)} days annual leave left` : `${roundQuota(annualLeft)} 天年假可用`) : (english ? "Set annual leave quota" : "设置年假额度"), meta: annualQuota ? `${roundQuota(annual.total)} 天额度，已用 ${roundQuota(annual.used)} 天` : "", action: "settings:quota"},
        leaveDeduction: {...meta.leaveDeduction, value: salary.salary ? formatMoney(salary.leaveDeduction) : (english ? "Not set" : "未设置"), compact: salary.salary ? (english ? `${formatMoney(salary.leaveDeduction)} deducted` : `${formatMoney(salary.leaveDeduction)} 请假扣款`) : (english ? "Set salary" : "设置薪资"), meta: salary.salary ? (english ? `Daily pay ${formatMoney(salary.daily)} before leave-type rate` : `日薪 ${formatMoney(salary.daily)}，再按请假类型比例计算`) : "", action: salary.salary ? "salaryReceipt" : "settings:salary"},
        estimatedSalary: {...meta.estimatedSalary, value: salary.salary ? formatMoney(salary.actual) : (english ? "Not set" : "未设置"), compact: salary.salary ? (english ? `${formatMoney(salary.actual)} estimated pay` : `预计实发 ${formatMoney(salary.actual)}`) : (english ? "Set salary" : "设置薪资"), meta: english ? "Estimated pay for the selected month" : "所选月份预计实发工资", action: salary.salary ? "salaryReceipt" : "settings:salary"},
        nextHoliday: {...meta.nextHoliday, value: holiday ? (holiday.days ? daysText(holiday.days) : (english ? "Today" : "今天")) : (english ? "No holidays" : "无假"), compact: holiday ? `${holidayName} · ${holiday.days ? (english ? `in ${holiday.days} days` : `还有 ${holiday.days} 天`) : (english ? "today" : "今天")}` : (english ? "No upcoming holidays" : "暂无后续假期"), meta: holiday ? `${holidayName} · ${formatMonthDay(holiday.date)}` : (english ? "No upcoming holidays in published schedules" : "已发布安排中暂无后续假期"), action: holiday ? `date:${toISO(holiday.date)}` : ""},
        ticketSale: {...meta.ticketSale, value: ticket ? (ticketDays > 0 ? daysText(ticketDays) : ticketDays === 0 ? (english ? "Today" : "今天") : (english ? "On sale" : "已开售")) : (english ? "No data" : "暂无数据"), compact: ticket ? `${window.RestCalI18n?.t(ticket.name) || ticket.name}${ticket.tripLabel} · ${ticketDays > 0 ? (english ? `${ticketDays} days` : `${ticketDays} 天后`) : ticketDays === 0 ? (english ? "today" : "今天开售") : (english ? "on sale" : "已开售")}` : (english ? "No ticket reminders" : "暂无购票提醒"), meta: ticket ? `${formatMonthDay(ticket.saleDate)} 开售 · ${formatMonthDay(ticket.departure)} 出行` : "", action: "ticket"},
        payday: {...meta.payday, value: payday ? (paydayDays ? daysText(paydayDays) : (english ? "Today" : "今天")) : (english ? "Not set" : "未设置"), compact: payday ? (paydayDays ? (english ? `${paydayDays} days to payday` : `距发薪日 ${paydayDays} 天`) : (english ? "Payday · today" : "今天发薪")) : (english ? "Set payday" : "设置发薪日"), meta: payday ? formatMonthDay(payday) : "", action: "settings:salary"},
        overtime: {...meta.overtime, value: english ? `${roundQuota(monthStats.overtimeHours)} hours` : `${roundQuota(monthStats.overtimeHours)} 小时`, compact: english ? `${roundQuota(monthStats.overtimeHours)} overtime hours` : `本月加班 ${roundQuota(monthStats.overtimeHours)} 小时`, meta: english ? `${monthStats.overtimeDays} recorded days` : `所选月份 ${monthStats.overtimeDays} 天有加班记录`, action: "stats"},
        habit: {...meta.habit, value: state.habits.length ? `${habitDone} / ${state.habits.length}` : (english ? "Not set" : "未设置"), compact: state.habits.length ? (english ? `${habitDone}/${state.habits.length} today · ${streak}-day streak` : `今日 ${habitDone}/${state.habits.length} · 连续 ${streak} 天`) : (english ? "Add a habit" : "添加习惯"), meta: english ? "Today's check-ins / active habits" : "今日完成数 / 当前习惯数", action: "habit"}
    };
}

function overviewCardHtml(item, preview = false) {
    const inner = `<span class="overview-label">${escapeHtml(item.label)}</span><strong class="overview-value">${escapeHtml(item.value)}</strong><span class="overview-compact">${escapeHtml(item.compact)}</span>`;
    const title = item.meta ? ` title="${escapeHtml(item.meta)}"` : "";
    return item.action && !preview
        ? `<button class="overview-item is-action" data-overview-action="${escapeHtml(item.action)}" type="button"${title}>${inner}</button>`
        : `<div class="overview-item"${title}>${inner}</div>`;
}

function renderMonthSummary(monthStats) {
    const items = getOverviewModuleItems(monthStats);
    const count = state.dashboard.overviewModules.length;
    els.monthSummary.style.setProperty("--overview-count", String(Math.max(1, count)));
    els.monthSummary.dataset.count = String(count);
    els.monthSummary.innerHTML = count
        ? state.dashboard.overviewModules.map(id => items[id]).filter(Boolean).map(item => overviewCardHtml(item)).join("")
        : overviewEmptyHtml();
}

function renderOverviewUnavailable() {
    const english = getLanguage() === "en";
    const meta = overviewModuleMetadata(english);
    const count = state.dashboard.overviewModules.length;
    els.monthSummary.style.setProperty("--overview-count", String(Math.max(1, count)));
    els.monthSummary.dataset.count = String(count);
    els.monthSummary.innerHTML = count
        ? state.dashboard.overviewModules.map(id => {
            const item = meta[id] || meta.attendance;
            return overviewCardHtml({...item, value: english ? "Unavailable" : "待发布", compact: `${item.label} · ${english ? "unavailable" : "待发布"}`});
        }).join("")
        : overviewEmptyHtml();
}

function overviewEmptyHtml() {
    const english = getLanguage() === "en";
    return `
        <button class="overview-empty" type="button" data-overview-add-modules>
            <i class="ph ph-plus-circle icon" aria-hidden="true"></i>
            <span>${english ? "Click to add modules" : "点击添加模块"}</span>
        </button>
    `;
}

function renderOverviewCustomizer() {
    const selected = state.dashboard.overviewModules;
    const meta = overviewModuleMetadata();
    const stats = calculateStats(currentYear, currentMonth);
    const items = getOverviewModuleItems(stats);
    els.overviewCustomizerPreview.classList.toggle("is-empty", selected.length === 0);
    els.overviewCustomizerPreview.innerHTML = selected.length
        ? selected.map(id => overviewCardHtml(items[id], true)).join("")
        : overviewEmptyHtml();
    els.overviewCustomizerCount.textContent = `${selected.length} / 3`;
    els.overviewCustomizerList.innerHTML = OVERVIEW_MODULE_IDS.map(id => {
        const item = meta[id];
        const index = selected.indexOf(id);
        const active = index >= 0;
        const actions = active
            ? `
                <button class="btn ghost icon-only" type="button" data-overview-move="up" data-overview-id="${id}" aria-label="上移 ${escapeHtml(item.label)}" title="上移" ${index === 0 ? "disabled" : ""}><i class="ph ph-arrow-up icon" aria-hidden="true"></i></button>
                <button class="btn ghost icon-only" type="button" data-overview-move="down" data-overview-id="${id}" aria-label="下移 ${escapeHtml(item.label)}" title="下移" ${index === selected.length - 1 ? "disabled" : ""}><i class="ph ph-arrow-down icon" aria-hidden="true"></i></button>
                <button class="btn ghost overview-module-toggle" type="button" data-overview-remove="${id}">移除</button>
            `
            : `<button class="btn overview-module-toggle" type="button" data-overview-add="${id}" ${selected.length >= 3 ? "disabled" : ""}>添加</button>`;
        return `
            <div class="overview-module-row${active ? " is-selected" : ""}">
                <span class="overview-module-icon" aria-hidden="true"><i class="ph ph-${item.icon} icon"></i></span>
                <span class="overview-module-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.description)}</small></span>
                <span class="overview-module-actions">${actions}</span>
            </div>
        `;
    }).join("");
    window.RestCalI18n?.apply?.(els.overviewCustomizeModal);
}

function openOverviewCustomizer() {
    els.overviewCustomizerStatus.textContent = "";
    renderOverviewCustomizer();
    openBackdrop(els.overviewCustomizeModal);
    modalReturnFocus.set(els.overviewCustomizeModal, els.overviewCustomize);
    window.setTimeout(() => els.overviewCustomizerList.querySelector("button:not(:disabled)")?.focus({preventScroll: true}), 30);
}

function closeOverviewCustomizer() {
    closeBackdrop(els.overviewCustomizeModal);
}

function updateOverviewModules(next, message) {
    state.dashboard = normalizeDashboard({overviewModules: next});
    if (!saveState()) return;
    renderMonthSummary(calculateStats(currentYear, currentMonth));
    renderOverviewCustomizer();
    els.overviewCustomizerStatus.textContent = message;
}

function handleOverviewCustomizerClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const current = [...state.dashboard.overviewModules];
    if (button.dataset.overviewAdd) {
        if (current.length >= 3 || current.includes(button.dataset.overviewAdd)) return;
        current.push(button.dataset.overviewAdd);
        updateOverviewModules(current, "模块已添加");
        return;
    }
    if (button.dataset.overviewRemove) {
        updateOverviewModules(current.filter(id => id !== button.dataset.overviewRemove), "模块已移除");
        return;
    }
    if (button.dataset.overviewMove) {
        const index = current.indexOf(button.dataset.overviewId);
        const target = index + (button.dataset.overviewMove === "up" ? -1 : 1);
        if (index < 0 || target < 0 || target >= current.length) return;
        [current[index], current[target]] = [current[target], current[index]];
        updateOverviewModules(current, "顺序已更新");
    }
}

async function handleOverviewAction(action, trigger) {
    if (action === "stats") {
        setStatsPeriodMode("month");
        switchView("stats");
    } else if (action === "salaryReceipt") {
        await openReceiptModal("salary");
    } else if (action === "ticket") {
        toggleTicketTool(trigger);
    } else if (action === "habit") {
        openHabitTool(trigger);
    } else if (action.startsWith("settings:")) {
        openSettings(action.slice("settings:".length));
    } else if (action.startsWith("date:")) {
        await openRestcalDateLink(`restcal://day/${encodeURIComponent(action.slice("date:".length))}`);
    }
}

function findNextHoliday() {
    for (let offset = 0; offset <= 370; offset += 1) {
        const date = addDays(today, offset);
        const info = getDayInfo(date);
        if (info.isHoliday) {
            return {
                date,
                days: offset,
                name: info.holidayName || "节假日"
            };
        }
    }
    return null;
}

function renderHomeAlerts() {
    if (!els.homeAlerts) return;
    const alerts = [];
    const ticketPreferences = normalizeTicketPreferences(state.ticketPreferences, state.settings);
    getTicketReminders(today.getFullYear()).forEach(item => {
        const diff = diffDays(today, item.saleDate);
        if (diff < 0 || diff > Math.max(14, ticketPreferences.advanceDays)) return;
        alerts.push({
            tone: "info",
            icon: "train",
            text: diff === 0
                ? `${item.name}${item.tripLabel}火车票今天开售，计划出行 ${formatMonthDay(item.departure)}`
                : `${item.name}${item.tripLabel}火车票 ${diff} 天后开售（${formatMonthDay(item.saleDate)}）`,
            actionLabel: "查看",
            ticketReminder: true
        });
    });
    const annualQuota = cleanNumber(els.annualQuotaInput.value);
    if (annualQuota > 0 && calculateStats(today.getFullYear()).annualLeave >= annualQuota) {
        alerts.push({
            tone: "warn",
            icon: "warning-circle",
            text: "今年的年假额度已用完",
            actionLabel: "查看额度",
            settings: "quota"
        });
    } else if (annualQuota > 0) {
        const expRule = state.quotaRules?.annualExpireRule || "next-03-31";
        if (expRule !== "none") {
            let expYear = today.getFullYear();
            let expMonth = 3;
            let expDay = 31;
            if (expRule === "next-06-30") { expMonth = 6; expDay = 30; }
            else if (expRule === "current-12-31") { expMonth = 12; expDay = 31; }
            const expDate = new Date(expYear, expMonth - 1, expDay);
            const diff = diffDays(today, expDate);
            const targetYear = expRule.startsWith("next") && today.getMonth() < expMonth ? expYear - 1 : expYear;
            const remainingAnnual = Math.max(0, annualQuota - calculateStats(targetYear).annualLeave);
            if (diff >= 0 && diff <= 30 && remainingAnnual > 0) {
                alerts.push({
                    tone: "warn",
                    icon: "warning-circle",
                    text: `年假即将于 ${expMonth}月${expDay}日 清零，还剩 ${remainingAnnual} 天未使用`,
                    actionLabel: "去规划",
                    settings: "quota"
                });
            }
        }
    }
    if (isWebdavConfigured()) {
        const last = Date.parse(webdavConfig.lastBackupAt || "");
        const stale = !Number.isFinite(last) || Date.now() - last > 30 * 86400000;
        if (stale) {
            alerts.push({
                tone: "warn",
                icon: "cloud-arrow-up",
                text: webdavConfig.lastBackupAt ? "距上次云端备份已超过 30 天" : "已配置 WebDAV，但还没有云端备份",
                actionLabel: "去备份",
                settings: "webdav"
            });
        }
    }
    els.homeAlerts.hidden = alerts.length === 0;
    els.homeAlerts.innerHTML = alerts.map(alert => {
        const content = `
            <i class="ph ph-${alert.icon} icon" aria-hidden="true"></i>
            <span class="alert-text">${escapeHtml(alert.text)}</span>`;
        if (alert.ticketReminder) return `
            <button class="alert-row alert-row-action ${alert.tone}" data-open-ticket-reminders type="button" aria-haspopup="dialog" aria-controls="ticketToolPanel">
                ${content}
                <span class="alert-link">${escapeHtml(alert.actionLabel)}<i class="ph ph-caret-right icon" aria-hidden="true"></i></span>
            </button>`;
        return `
            <div class="alert-row ${alert.tone}">
                ${content}
                ${alert.nav ? `<button class="btn ghost compact-btn" data-nav="${alert.nav}" type="button">${escapeHtml(alert.actionLabel)}</button>` : ""}
                ${alert.settings ? `<button class="btn ghost compact-btn" data-open-settings-dynamic="${alert.settings}" type="button">${escapeHtml(alert.actionLabel)}</button>` : ""}
            </div>`;
    }).join("");
}

function openRecentRecords() {
    renderRecentRecords();
    openBackdrop(els.recentRecordsPanel);
    modalReturnFocus.set(els.recentRecordsPanel, els.recentRecordsToggle);
    window.setTimeout(() => (els.recentRecords.querySelector("button") || els.closeRecentRecords).focus({preventScroll: true}), 30);
}

function closeRecentRecords() {
    closeBackdrop(els.recentRecordsPanel);
}

function renderRecentRecords() {
    if (!els.recentRecords) return;
    const entries = Object.entries(state.records)
        .filter(([, record]) => record?.status || record?.overtime || record?.note)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 6);
    if (!entries.length) {
        els.recentRecords.innerHTML = `<div class="empty-state">还没有记录，点击日历中的日期开始标记。</div>`;
        return;
    }
    els.recentRecords.innerHTML = entries.map(([iso, record]) => {
        const meta = [record.reason, record.overtime?.reason, record.overtime ? `${record.overtime.hours} 小时` : "", record.note].filter(Boolean).join(" · ");
        const label = record.status ? `${STATUS_LABELS[record.status] || ""}${record.overtime ? " + 加班" : ""}` : (record.overtime ? "加班" : "备注");
        return `
<button class="recent-row" type="button" data-record-date="${escapeHtml(iso)}">
  <span class="recent-date">${escapeHtml(iso)}</span>
  <span class="tag ${record.overtime && !record.status ? "overtime" : (record.status || "")}">${escapeHtml(label)}</span>
  <span class="recent-meta">${escapeHtml(meta || weekdayName(fromISO(iso)))}</span>
</button>
      `;
    }).join("");
}

function renderSetupBanner() {
    if (!els.welcomeCard) return;
    const show = !state.onboardingCompleted && !state.setupBannerDismissed;
    els.welcomeCard.hidden = !show;
    if (!show) return;
    const name = state.profile.name || state.settings.applicantName || "";
    els.welcomeTitle.textContent = name ? `${name}，完成初始设置` : "完成初始设置";
}

function renderGuideEntry() {
    els.guideToggle.hidden = !state.onboardingCompleted;
}

function renderDataStatus() {
    if (!els.dataStatusLine) return;
    const count = Object.keys(state.records).length;
    els.dataStatusLine.textContent = count ? `共 ${count} 条记录` : "暂无记录";
}

function renderSalary() {
    const stats = calculateStats(currentYear, currentMonth);
    const salary = calculateSalarySnapshot(stats, currentYear, currentMonth);
    currentSalaryReceipt = buildSalaryReceipt({stats, ...salary}, currentYear, currentMonth);
    els.salaryResult.innerHTML = receiptHtml(currentSalaryReceipt);
}

// 核算本身在 assets/js/payroll.js，这里只负责把已保存的设置和日历统计嗂进去。
// year / month 不给默认值：漏传会把另一个月的累计预扣算到当前月头上。
function calculateSalarySnapshot(stats, year, month) {
    const taxMode = state.salary?.taxMode || "simple";
    const salary = cleanNumber(state.salary?.monthlySalary);
    // 累计预扣要求本年 1..month-1 逐月的统计；其他情况不必白算。
    const needsPriorMonths = taxMode === "cumulative" && salary > 0;
    return XiuliPayroll.monthlySnapshot({
        stats,
        salary,
        fixedDeductions: cleanNumber(state.salary?.fixedDeductions),
        estimatedTax: cleanNumber(state.salary?.estimatedTax),
        specialDeductions: cleanNumber(state.salary?.specialDeductions),
        taxMode,
        rates: getSalaryRates(),
        priorMonthStats: needsPriorMonths
            ? Array.from({length: month - 1}, (_, index) => calculateStats(year, index + 1))
            : []
    });
}

function buildSalaryReceipt({stats, salary, deduction, estimatedTax, isCumulative, taxDetails, daily, leaveDeduction, actual}, year, month) {
    const monthText = `${year}-${String(month).padStart(2, "0")}`;
    const deductionItems = [
        {label: "请假扣款", value: formatMoney(leaveDeduction)},
        {label: "五险一金", value: formatMoney(deduction)}
    ];

    if (isCumulative && taxDetails) {
        deductionItems.push({label: "专项扣除", value: formatMoney(taxDetails.specialDeductions)});
        deductionItems.push({label: `个税预扣 (${taxDetails.taxRate}%)`, value: formatMoney(estimatedTax)});
    } else {
        deductionItems.push({label: "个税预估", value: formatMoney(estimatedTax)});
    }
    deductionItems.push({label: "实际到手", value: formatMoney(actual), strong: true});

    return {
        kind: "salary",
        title: "工资条",
        subtitle: `${monthText} · THERMAL PRINT`,
        filename: `工资条-${monthText}`,
        sections: [
            [
                {label: "月薪", value: formatMoney(salary)},
                {label: "五险一金", value: formatMoney(deduction)},
                {label: "日薪", value: formatMoney(daily)}
            ],
            [
                {label: "应出勤", value: `${stats.expectedWorkdays} 天`},
                {label: "已出勤", value: `${stats.actualWorkdays} 天`},
                {label: "请假合计", value: `${stats.totalLeave} 天`},
                {label: "事假 / 病假", value: `${stats.personalLeave} / ${stats.sickLeave} 天`},
                {label: "年假 / 调休", value: `${stats.annualLeave} / ${stats.compLeave} 天`},
                {label: "加班工时", value: `${stats.overtimeHours || 0} 小时 (${stats.overtimeDays || 0} 天)`}
            ],
            deductionItems
        ],
        footer: [toISO(new Date()), "仅供个人核算"]
    };
}

function renderQuotaSummary(yearStats) {
    const annualQuota = cleanNumber(els.annualQuotaInput.value);
    const baseCompQuota = cleanNumber(els.compQuotaInput.value);
    const balances = calculateQuotaBalances(currentYear, annualQuota, baseCompQuota);
    els.quotaSummary.innerHTML = [
        quotaLine("年假", balances.annual.used, balances.annual.total, false, balances.annual.carry),
        quotaLine("调休", balances.comp.used, balances.comp.total, false, balances.comp.earned)
    ].join("");
    if (els.settingsQuotaStatus) {
        els.settingsQuotaStatus.innerHTML = [
            quotaLine("年假", balances.annual.used, balances.annual.total, true, balances.annual.carry),
            quotaLine("调休", balances.comp.used, balances.comp.total, true, balances.comp.earned)
        ].join("");
    }
}

function calculateQuotaBalances(year, annualQuota, baseCompQuota) {
    const reference = year === today.getFullYear() ? new Date(today) : new Date(year, 11, 31, 23, 59, 59);
    const annualRule = state.quotaRules?.annualExpireRule || "next-03-31";
    const compRule = state.quotaRules?.compExpireRule || "none";
    const current = calculateStats(year);
    const previous = calculateStats(year - 1);
    const beforeExpiry = ruleCarriesIntoDate(annualRule, reference, year);
    const annualCarry = beforeExpiry ? Math.max(0, annualQuota - previous.annualLeave) : 0;
    const annualUsed = annualRule === "none"
        ? countStatusThrough("annual", reference)
        : current.annualLeave;
    const annualTotal = annualRule === "none" ? annualQuota : annualQuota + annualCarry;

    let compEarned;
    let compUsed;
    if (compRule === "none") {
        compEarned = sumOvertimeThrough(reference);
        compUsed = countStatusThrough("comp", reference);
    } else {
        const carry = ruleCarriesIntoDate(compRule, reference, year)
            ? Math.max(0, previous.overtimeCompEarned - previous.compLeave)
            : 0;
        compEarned = current.overtimeCompEarned + carry;
        compUsed = current.compLeave;
    }

    return {
        annual: {used: roundQuota(annualUsed), total: roundQuota(annualTotal), carry: roundQuota(annualCarry)},
        comp: {used: roundQuota(compUsed), total: roundQuota(baseCompQuota + compEarned), earned: roundQuota(compEarned)}
    };
}

function ruleCarriesIntoDate(rule, reference, year) {
    if (!rule.startsWith("next-")) return false;
    const [, monthText, dayText] = rule.match(/^next-(\d{2})-(\d{2})$/) || [];
    if (!monthText) return false;
    return reference <= new Date(year, Number(monthText) - 1, Number(dayText), 23, 59, 59);
}

function countStatusThrough(status, reference) {
    const end = toISO(reference);
    return Object.entries(state.records).reduce((sum, [iso, record]) => sum + (iso <= end && record?.status === status ? 1 : 0), 0);
}

function sumOvertimeThrough(reference) {
    const end = toISO(reference);
    const dailyHours = Number(state.workSchedule?.dailyWorkHours) || 8;
    return Object.entries(state.records).reduce((sum, [iso, record]) => {
        if (iso > end || !record?.overtime) return sum;
        return sum + ((Number(record.overtime.hours) || 0) / dailyHours) * (Number(record.overtime.rate) || 1);
    }, 0);
}

function roundQuota(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function quotaLine(label, used, quota, inSettings = false, extraEarned = 0) {
    if (quota <= 0) {
        if (inSettings) {
            return `
  <div class="quota-item quota-empty">
    <div class="quota-text"><strong>${label}额度未设置</strong></div>
    <div class="quota-help">填写上方额度后，会自动计算已用和剩余天数。</div>
  </div>
`;
        }
        return `
  <div class="quota-item quota-empty">
    <div class="quota-text"><strong>${label}额度未设置</strong></div>
    <div class="quota-help">设置后可自动计算已用和剩余额度。</div>
    <button class="btn ghost compact-btn" data-open-settings-dynamic="quota" type="button">设置${label}额度</button>
  </div>
`;
    }
    const remaining = Math.max(0, quota - used);
    const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
    const extraLabel = label === "调休" ? "加班折算" : "上期结转";
    const extraBadge = extraEarned > 0 ? ` <small style="color:var(--muted);font-weight:normal;">(含${extraLabel} +${extraEarned} 天)</small>` : "";
    return `
<div class="quota-item">
  <div class="quota-text"><strong>${label}</strong>：已用 ${used} 天 / 额度 ${quota} 天${extraBadge} / 剩余 ${remaining} 天</div>
  <div class="quota-meter"><span style="width:${percent}%"></span></div>
</div>
      `;
}

function renderTicketReminders() {
    const reminders = getTicketReminders(currentYear);
    const ticketPreferences = normalizeTicketPreferences(state.ticketPreferences, state.settings);
    const nextTrip = reminders.find(item => diffDays(new Date(), item.departure) >= 0);
    document.getElementById("flightBookingLink").innerHTML = airlineSelectorMarkup(nextTrip?.tripType || "outbound", nextTrip?.departure || today);
    document.getElementById("ticketBookingLink").href = build12306Url(nextTrip?.tripType || "outbound", nextTrip?.departure || today) || "https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc";
    const departureLabel = ticketPreferences.departureRule === "holiday-eve" ? "假期前一天晚上" : "假期首日";
    const returnLabel = ticketPreferences.returnRule === "holiday-next" ? "假期结束后一天" : "假期最后一天";
    if (els.ticketGuideText) {
        els.ticketGuideText.textContent = getLanguage() === "en" ? `${ticketPreferences.advanceDays} days ahead · ${ticketPreferences.reminderTime} reminder · Check 12306` : `提前 ${ticketPreferences.advanceDays} 天 · ${ticketPreferences.reminderTime} 提醒 · 以 12306 为准`;
        els.ticketGuideText.title = getLanguage() === "en" ? `Outbound: ${ticketPreferences.departureRule === "holiday-eve" ? "day before holiday" : "first holiday day"}; return: ${ticketPreferences.returnRule === "holiday-next" ? "day after holiday" : "last holiday day"}. Actual sale times follow 12306.` : `去程按${departureLabel}、返程按${returnLabel}计算；实际起售时间以 12306 为准。`;
    }

    if (!reminders.length) {
        els.ticketToolHint.textContent = "本年度暂无购票提醒";
        els.ticketReminders.innerHTML = `<div class="empty-state">本年度暂无节假日火车票开售节点。</div>`;
        return;
    }

    const reference = new Date();
    const nextReminder = reminders.find(item => diffDays(reference, item.departure) >= 0);
    if (!nextReminder) {
        els.ticketToolHint.textContent = "本年度购票提醒均已结束";
    } else {
        const saleDiff = diffDays(reference, nextReminder.saleDate);
        els.ticketToolHint.textContent = saleDiff > 0
            ? `${nextReminder.name}${nextReminder.tripLabel}火车票 ${saleDiff} 天后开售（${formatMonthDay(nextReminder.saleDate)}）`
            : saleDiff === 0
                ? `${nextReminder.name}${nextReminder.tripLabel}火车票今天开售，计划出行 ${formatMonthDay(nextReminder.departure)}`
                : `${nextReminder.name}${nextReminder.tripLabel}火车票已开售，计划出行 ${formatMonthDay(nextReminder.departure)}`;
    }

    const tripsByHoliday = new Map();
    reminders.forEach(item => {
        const key = `${item.name}:${toISO(item.holidayStart || item.departure)}:${toISO(item.holidayEnd || item.departure)}`;
        if (!tripsByHoliday.has(key)) tripsByHoliday.set(key, {key, name: item.name, items: []});
        tripsByHoliday.get(key).items.push(item);
    });
    const trips = Array.from(tripsByHoliday.values()).map(trip => ({
        ...trip,
        items: trip.items.sort((a, b) => a.departure - b.departure || (a.tripType === "outbound" ? -1 : 1))
    }));
    const upcoming = trips.filter(trip => trip.items.some(item => diffDays(reference, item.departure) >= 0));
    const past = trips.filter(trip => trip.items.every(item => diffDays(reference, item.departure) < 0));
    const holidayIcon = name => {
        if (name.includes("元旦")) return "confetti";
        if (name.includes("春节")) return "gift";
        if (name.includes("清明")) return "plant";
        if (name.includes("劳动")) return "hammer";
        if (name.includes("端午")) return "sailboat";
        if (name.includes("中秋")) return "moon-stars";
        if (name.includes("国庆")) return "flag";
        return "ticket";
    };
    const holidayImage = name => {
        if (name.includes("元旦")) return '<img src="assets/images/holiday/new-years-day.png" alt="" loading="lazy" decoding="async">';
        if (name.includes("春节")) return '<img src="assets/images/holiday/spring-festival.png" alt="" loading="lazy" decoding="async">';
        if (name.includes("清明")) return '<img src="assets/images/holiday/qingming-festival.png" alt="" loading="lazy" decoding="async">';
        if (name.includes("劳动")) return '<img src="assets/images/holiday/labor-day.png" alt="" loading="lazy" decoding="async">';
        if (name.includes("端午")) return '<img src="assets/images/holiday/dragon-boat-festival.png" alt="" loading="lazy" decoding="async">';
        if (name.includes("中秋")) return '<img src="assets/images/holiday/mid-autumn-festival.png" alt="" loading="lazy" decoding="async">';
        if (name.includes("国庆")) return '<img src="assets/images/holiday/national-day.png" alt="" loading="lazy" decoding="async">';
        return "";
    };
    const tripLeg = item => item ? `<section class="ticket-trip-leg">
            <div class="ticket-trip-label"><i class="ph ph-${item.tripType === "return" ? "airplane-landing" : "airplane-takeoff"} icon" aria-hidden="true"></i><span>${item.tripLabel}</span></div>
            <div class="ticket-sale"><time datetime="${toISO(item.saleDate)}">${formatMonthDay(item.saleDate)}</time><span>${weekdayName(item.saleDate)} · 开售</span></div>
            <div class="ticket-departure"><span>出行日期</span><time datetime="${toISO(item.departure)}">${formatMonthDay(item.departure)}</time><small>${weekdayName(item.departure)}</small></div>
            ${build12306Url(item.tripType, item.departure) ? `<div class="ticket-route">${getTicketRoute(item.tripType).map(escapeHtml).join(" → ")}</div>` : ""}
            ${flightRouteMarkup(item.tripType, item.departure)}
        </section>` : "";
    const card = (trip, archived = false) => {
        const outbound = trip.items.find(item => item.tripType === "outbound");
        const returning = trip.items.find(item => item.tripType === "return");
        const imageMarkup = holidayImage(trip.name);
        const exportKey = trip.items.map(item => `${item.tripType}:${toISO(item.departure)}`).join(",");
        return `<article class="travel-ticket ${archived ? "is-past no-action" : ""}">
            <span class="holiday-art ${imageMarkup ? "has-image" : ""}" aria-hidden="true">${imageMarkup || `<i class="ph ph-${holidayIcon(trip.name)} icon"></i>`}</span>
            <div class="travel-ticket-main">
                <div class="travel-ticket-head"><h3>${escapeHtml(trip.name)}</h3><span class="ticket-status ${archived ? "is-muted" : "is-round-trip"}">${archived ? "已结束" : "往返提醒"}</span></div>
                <div class="ticket-trip-grid">
                    ${tripLeg(outbound)}
                    ${outbound && returning ? `<span class="ticket-trip-connector" aria-hidden="true"><i class="ph ph-train icon"></i></span>` : ""}
                    ${tripLeg(returning)}
                </div>
            </div>
            ${archived ? "" : `<div class="ticket-card-actions">${trip.items.map(item => {
                const url = build12306Url(item.tripType, item.departure);
                return url ? `<a class="btn primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${item.tripLabel} 12306</a>` : "";
            }).join("")}${trip.items.some(item => build12306Url(item.tripType, item.departure)) ? "" : `<button class="btn" type="button" data-open-settings-dynamic="tickets">设置往返地</button>`}<button class="btn ghost ticket-export-btn" type="button" data-ticket-export="${exportKey}">导出提醒</button></div>`}
        </article>`;
    };
    els.ticketReminders.innerHTML = `
        <div class="ticket-upcoming">${upcoming.length ? upcoming.map(item => card(item)).join("") : `<div class="ticket-list-empty">暂无待出发行程</div>`}</div>
        ${past.length ? `<details class="ticket-history"><summary><span>已结束的出行</span><span class="ticket-history-count">${past.length}</span><span class="ticket-history-toggle" aria-hidden="true"><i class="ph ph-caret-down icon"></i></span></summary><div class="ticket-upcoming ticket-history-list">${past.map(item => card(item, true)).join("")}</div></details>` : ""}
    `;
}

function toggleTicketTool(trigger = els.ticketToolToggle) {
    renderTicketReminders();
    openBackdrop(els.ticketToolPanel);
    modalReturnFocus.set(els.ticketToolPanel, trigger);
    document.getElementById("closeTicketTool").focus({preventScroll: true});
}
