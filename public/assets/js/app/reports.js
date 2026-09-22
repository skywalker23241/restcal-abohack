/* 休历 · RestCal —— 统计计算、ICS 导出、热力图与图表、票据渲染与导出、CSV
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function calculateStats(year, month) {
    const dates = month ? getMonthDates(year, month) : getYearDates(year);
    const stats = {
        expectedWorkdays: 0,
        actualWorkdays: 0,
        personalLeave: 0,
        sickLeave: 0,
        annualLeave: 0,
        compLeave: 0,
        totalLeave: 0,
        overtimeDays: 0,
        overtimeHours: 0,
        overtimeCompEarned: 0,
        holidayDays: 0,
        weekendDays: 0,
        attendedMarked: 0,
        leaveByStatus: {
            personal: 0,
            sick: 0,
            annual: 0,
            comp: 0
        }
    };

    dates.forEach(date => {
        const iso = toISO(date);
        const info = getDayInfo(date);
        const record = state.records[iso];
        if (info.isHoliday) stats.holidayDays += 1;
        if (info.isWeekend) stats.weekendDays += 1;
        if (record?.overtime) {
            stats.overtimeDays += 1;
            const hours = Number(record.overtime.hours) || 0;
            const rate = Number(record.overtime.rate) || 1;
            const dailyHours = Number(state.workSchedule?.dailyWorkHours) || 8;
            stats.overtimeHours += hours;
            stats.overtimeCompEarned += (hours / dailyHours) * rate;
        }
        if (isConfiguredWorkday(date, info)) {
            stats.expectedWorkdays += 1;
            if (LEAVE_STATUSES.includes(record?.status)) {
                stats.leaveByStatus[record.status] += 1;
            }
            if (record?.status === "work") stats.attendedMarked += 1;
        }
    });

    stats.personalLeave = stats.leaveByStatus.personal;
    stats.sickLeave = stats.leaveByStatus.sick;
    stats.annualLeave = stats.leaveByStatus.annual;
    stats.compLeave = stats.leaveByStatus.comp;
    stats.totalLeave = LEAVE_STATUSES.reduce((sum, status) => sum + stats.leaveByStatus[status], 0);
    stats.actualWorkdays = stats.attendedMarked;
    return stats;
}

function exportIcsFile(targetYear) {
    if (!window.XiuliIcs) {
        showToast("iCalendar 导出模块未加载", "danger");
        return;
    }
    const years = targetYear
        ? [targetYear]
        : Array.from(new Set(Object.keys(state.records).map(iso => Number(iso.slice(0, 4))).concat([currentYear]))).sort();

    const holidays = [];
    const makeups = [];
    const ticketReminders = [];

    years.forEach(yr => {
        const dates = getYearDates(yr);
        dates.forEach(d => {
            const info = getDayInfo(d);
            if (info.isHoliday && info.holidayName) {
                holidays.push({ date: d, name: info.holidayName });
            }
            if (info.isWorkday && info.makeupName) {
                makeups.push({ date: d, name: info.makeupName });
            }
        });
        try {
            getTicketReminders(yr).forEach(t => ticketReminders.push(t));
        } catch {}
    });

    const icsContent = XiuliIcs.generateIcs({
        records: state.records,
        holidays,
        makeups,
        ticketReminders,
        targetYear,
        statusLabels: STATUS_LABELS,
        include: Object.fromEntries([...document.querySelectorAll("[data-ics-category]")].map(input => [input.dataset.icsCategory, input.checked])),
        ticketReminderTime: els.icsTicketTime?.value || state.ticketPreferences.reminderTime,
        ticketAdvanceDays: state.ticketPreferences.advanceDays,
        eventUrlFor: ({date}) => restcalDateLink(date)
    });

    const filename = targetYear ? `RestCal-${targetYear}年度日历.ics` : `RestCal-全量日历.ics`;
    XiuliIcs.downloadIcs(icsContent, filename);
    showToast(`已成功导出 ${filename}`);
}

function statsHeatmapHtml(scope, dates, stats) {
    const cells = buildHeatCells(dates, scope === "year" || scope === "month");
    const annualQuota = cleanNumber(els.annualQuotaInput.value);
    const annualBalance = calculateQuotaBalances(currentYear, annualQuota, cleanNumber(els.compQuotaInput.value)).annual;
    const annualRemaining = annualQuota > 0 ? Math.max(0, annualBalance.total - annualBalance.used) : 0;
    const primary = scope === "month"
        ? [
            ["应出勤", stats.expectedWorkdays],
            ["已出勤", stats.actualWorkdays],
            ["事假", stats.personalLeave],
            ["病假", stats.sickLeave],
            ["调休", stats.compLeave],
            ["年假", stats.annualLeave],
            ["加班小时", roundQuota(stats.overtimeHours)],
            ["周末", stats.weekendDays],
            ["节假日", stats.holidayDays],
            ["剩余年假", annualRemaining]
        ]
        : [
            ["总请假", stats.totalLeave],
            ["事假", stats.personalLeave],
            ["病假", stats.sickLeave],
            ["年假", stats.annualLeave],
            ["调休", stats.compLeave],
            ["加班小时", roundQuota(stats.overtimeHours)],
            ["节假日", stats.holidayDays]
        ];

    const caption = scope === "month"
        ? "每个方块代表本月一天，按周排列完整展示。"
        : "每个方块代表全年一天，按周从左到右排列。";

    return `
<div class="summary-row ${scope}-summary-row">${primary.map(([label, value]) => summaryChip(label, value)).join("")}</div>
${scope === "month" ? statusDistributionHtml(stats) : ""}
  <div class="heat-shell ${scope}-shell">
    <div class="heatmap ${scope}" aria-label="${scope === "month" ? "月度" : "年度"}每日状态热力图">${cells}</div>
  </div>
${heatLegend()}
<div class="heat-caption">${caption}</div>
      `;
}

function statusDistributionHtml(stats) {
    const items = [
        {label: "已出勤", value: stats.actualWorkdays, color: "var(--heat-work)"},
        {label: "事假", value: stats.personalLeave, color: "var(--heat-personal)"},
        {label: "病假", value: stats.sickLeave, color: "var(--heat-sick)"},
        {label: "年假", value: stats.annualLeave, color: "var(--heat-annual)"},
        {label: "调休", value: stats.compLeave, color: "var(--heat-comp)"},
        {label: "周末", value: stats.weekendDays, color: "var(--heat-weekend)"},
        {label: "节假日", value: stats.holidayDays, color: "var(--heat-holiday)"}
    ].filter(item => item.value > 0);
    const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0));
    return `
<div class="status-distribution" aria-label="本月状态分布">
  <div class="distribution-bar">
    ${items.map(item => `<span class="distribution-segment" style="width:${(item.value / total) * 100}%;background:${item.color}" title="${item.label} ${item.value} 天"></span>`).join("")}
  </div>
  <div class="distribution-items">
    ${items.map(item => `<span class="distribution-item"><span class="distribution-dot" style="background:${item.color}"></span>${item.label} ${item.value}</span>`).join("")}
  </div>
</div>
      `;
}

function yearLeaveChartHtml(yearStats, compact = false) {
    const english = getLanguage() === "en";
    const monthly = [];
    for (let month = 1; month <= 12; month++) {
        const stats = calculateStats(currentYear, month);
        monthly.push({
            month,
            leave: stats.totalLeave,
            personal: stats.personalLeave,
            sick: stats.sickLeave,
            annual: stats.annualLeave,
            comp: stats.compLeave
        });
    }
    const maxLeave = Math.max(1, ...monthly.map(item => item.leave));
    const bars = monthly.map((item, index) => {
        const height = Math.max(4, Math.round((item.leave / maxLeave) * 100));
        const title = `${currentYear}-${String(item.month).padStart(2, "0")} 请假 ${item.leave} 天，事假 ${item.personal} 天，病假 ${item.sick} 天，年假 ${item.annual} 天，调休 ${item.comp} 天`;
        const barClass = ["bar", item.leave === 0 ? "zero" : "", item.month === currentMonth ? "current" : ""].filter(Boolean).join(" ");
        const valueClass = ["bar-value", item.leave === 0 ? "zero" : ""].filter(Boolean).join(" ");
        return `
  <div class="bar-wrap" style="--i:${index}" title="${escapeHtml(title)}">
    <div class="${barClass}" style="height:${height}%">
      <span class="${valueClass}">${item.leave}</span>
    </div>
  </div>
`;
    }).join("");
    const labels = monthly.map(item => `<span>${item.month}月</span>`).join("");

    if (compact) {
        return `
<div class="year-chart compact">
  <div class="chart-title">${english ? "Leave days by month" : "每月请假天数"} <span>${english ? `${currentYear} total: ${yearStats.totalLeave} days` : `${currentYear} 年合计 ${yearStats.totalLeave} 天`}</span></div>
  <div class="bar-area">${bars}</div>
  <div class="x-axis">${labels}</div>
</div>
      `;
    }

    return `
<div class="summary-row months-summary-row">
  ${summaryChip("总请假", yearStats.totalLeave)}
  ${summaryChip("已出勤", yearStats.actualWorkdays)}
  ${summaryChip("加班小时", roundQuota(yearStats.overtimeHours))}
  ${summaryChip("节假日", yearStats.holidayDays)}
  ${summaryChip("周末", yearStats.weekendDays)}
</div>
<div class="year-chart">
  <div class="chart-title">每月请假天数 <span>当前查看：${currentMonth}月</span></div>
  <div class="bar-area">${bars}</div>
  <div class="x-axis">${labels}</div>
  <div class="chart-note">横轴为月份，柱高表示当月请假天数；切换到“每一天”可查看全年每日状态热力图。</div>
</div>
      `;
}

function buildHeatCells(dates, alignByWeek) {
    if (!dates.length) return "";
    const cells = [];
    if (alignByWeek) {
        const offset = (dates[0].getDay() + 6) % 7;
        for (let i = 0; i < offset; i++) {
            cells.push(`<span class="heat-cell empty" aria-hidden="true"></span>`);
        }
    }

    dates.forEach(date => {
        const iso = toISO(date);
        const {cls, label} = getHeatCellState(date);
        cells.push(`<span class="heat-cell ${cls}" title="${escapeHtml(`${iso} ${label}`)}" aria-label="${escapeHtml(`${iso} ${label}`)}"></span>`);
    });
    return cells.join("");
}

function getHeatCellState(date) {
    const iso = toISO(date);
    const record = state.records[iso];
    const info = getDayInfo(date);
    if (record?.status) return {cls: record.status, label: STATUS_LABELS[record.status]};
    if (info.isHoliday) return {cls: "holiday", label: info.holidayName || "节假日"};
    if (info.makeupName) return {cls: "makeup", label: "调休上班"};
    if (info.isWeekend) return {cls: "weekend", label: "周末"};
    return {cls: "default", label: "工作日"};
}

function summaryChip(label, value) {
    return `<div class="summary-chip"><span>${label}</span><strong>${value}</strong></div>`;
}

function heatLegend() {
    return `
<div class="heat-legend">
  ${legendItem("default", "工作日")}
  ${legendItem("work", "出勤")}
  ${legendItem("personal", "事假")}
  ${legendItem("sick", "病假")}
  ${legendItem("annual", "年假")}
  ${legendItem("comp", "调休")}
  ${legendItem("holiday", "节假日")}
  ${legendItem("weekend", "周末")}
  ${legendItem("makeup", "调休")}
</div>
      `;
}

function legendItem(cls, label) {
    return `<span class="legend-item"><span class="legend-dot heat-cell ${cls}"></span>${label}</span>`;
}

function moneyRow(label, value, strong = false) {
    const amount = formatMoney(value);
    return `<div class="money-row"><span>${label}</span><${strong ? "strong" : "span"}>${amount}</${strong ? "strong" : "span"}></div>`;
}

function numberRow(label, value) {
    return `<div class="money-row"><span>${label}</span><span>${value} 天</span></div>`;
}

function receiptRow(label, value, strong = false) {
    const safeLabel = escapeHtml(label);
    const safeValue = escapeHtml(value);
    return `<div class="receipt-row ${strong ? "receipt-total" : ""}"><span>${safeLabel}</span><${strong ? "strong" : "span"}>${safeValue}</${strong ? "strong" : "span"}></div>`;
}

function receiptHtml(data) {
    return `<div class="receipt-preview ${data.kind}-receipt">${receiptInnerHtml(data)}</div>`;
}

function receiptInnerHtml(data) {
    return `
<div class="receipt-head">
  <div class="receipt-title">${escapeHtml(data.title)}</div>
  <div class="receipt-subtitle">${escapeHtml(data.subtitle)}</div>
</div>
${data.sections.map(section => `
  <div class="receipt-section">
    ${section.map(item => receiptRow(item.label, item.value, item.strong)).join("")}
  </div>
`).join("")}
${data.body ? `<div class="receipt-body">${escapeHtml(data.body)}</div>` : ""}
<div class="receipt-foot">
  <span>${escapeHtml(data.footer[0])}</span>
  <span>${escapeHtml(data.footer[1])}</span>
</div>
<div class="receipt-signature" aria-hidden="true"><img class="receipt-signature-mark" src="assets/icons/icon-192.png" alt=""></div>
      `;
}

async function openReceiptModal(type) {
    const isSalary = type === "salary";
    els.salaryReceiptPeriod.hidden = !isSalary;
    els.downloadReceipt.disabled = false;
    openBackdrop(els.receiptModal);
    if (isSalary) {
        const latest = salaryReceiptLatestPeriod();
        const initial = periodKey(currentYear, currentMonth) > latest
            ? latest
            : periodKey(currentYear, currentMonth);
        const initialPeriod = parsePeriod(initial);
        els.salaryReceiptYear.value = String(initialPeriod.year);
        els.salaryReceiptMonth.value = String(initialPeriod.month);
        updateSalaryReceiptMonthOptions();
        els.receiptModalTitle.textContent = "工资条";
        await updateSalaryReceiptPreview();
        return;
    }
    const data = currentLeaveReceipt;
    if (!data) {
        closeReceiptModal();
        return;
    }
    currentReceipt = data;
    els.receiptModalTitle.textContent = data.title;
    els.receiptModalBody.innerHTML = receiptHtml(data);
}

function salaryReceiptLatestPeriod() {
    return periodKey(today.getFullYear(), today.getMonth() + 1);
}

function periodKey(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

function parsePeriod(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    return year >= 2004 && month >= 1 && month <= 12 ? {year, month} : null;
}

async function updateSalaryReceiptPreview() {
    const period = selectedSalaryReceiptPeriod();
    if (!period) return;
    const version = ++salaryReceiptRenderVersion;
    const selectedKey = periodKey(period.year, period.month);
    els.salaryReceiptPrev.disabled = selectedKey <= "2004-01";
    els.salaryReceiptNext.disabled = selectedKey >= salaryReceiptLatestPeriod();
    els.downloadReceipt.disabled = true;
    els.receiptModalBody.innerHTML = `<div class="calendar-loading receipt-loading">正在核算 ${period.year} 年 ${period.month} 月工资…</div>`;
    await loadRemoteCalendarYear(period.year);
    const currentPeriod = selectedSalaryReceiptPeriod();
    if (version !== salaryReceiptRenderVersion
        || !currentPeriod
        || periodKey(currentPeriod.year, currentPeriod.month) !== selectedKey) return;
    if (!calendarApi.years.has(period.year)) {
        currentReceipt = null;
        els.receiptModalBody.innerHTML = `<div class="empty-state">${period.year} 年官方节假日数据尚未发布，暂不估算工资。</div>`;
        return;
    }
    const stats = calculateStats(period.year, period.month);
    const salary = calculateSalarySnapshot(stats, period.year, period.month);
    currentSalaryReceipt = buildSalaryReceipt({stats, ...salary}, period.year, period.month);
    currentReceipt = currentSalaryReceipt;
    els.receiptModalBody.innerHTML = receiptHtml(currentSalaryReceipt);
    els.downloadReceipt.disabled = false;
}

function shiftSalaryReceiptMonth(delta) {
    const period = selectedSalaryReceiptPeriod();
    if (!period) return;
    const shifted = new Date(period.year, period.month - 1 + delta, 1);
    const next = periodKey(shifted.getFullYear(), shifted.getMonth() + 1);
    if (next < "2004-01" || next > salaryReceiptLatestPeriod()) return;
    els.salaryReceiptYear.value = String(shifted.getFullYear());
    els.salaryReceiptMonth.value = String(shifted.getMonth() + 1);
    updateSalaryReceiptMonthOptions();
    return updateSalaryReceiptPreview();
}

function selectedSalaryReceiptPeriod() {
    return parsePeriod(periodKey(Number(els.salaryReceiptYear.value), Number(els.salaryReceiptMonth.value)));
}

function updateSalaryReceiptMonthOptions() {
    const selectedYear = Number(els.salaryReceiptYear.value);
    const latestMonth = selectedYear === today.getFullYear() ? today.getMonth() + 1 : 12;
    if (Number(els.salaryReceiptMonth.value) > latestMonth) {
        els.salaryReceiptMonth.value = String(latestMonth);
    }
    [...els.salaryReceiptMonth.options].forEach(option => {
        option.disabled = Number(option.value) > latestMonth;
    });
    syncEnhancedSelect(els.salaryReceiptMonth, true);
}

function closeReceiptModal() {
    salaryReceiptRenderVersion += 1;
    closeBackdrop(els.receiptModal);
}

async function downloadCurrentReceiptImage() {
    if (!currentReceipt) return;
    if (document.fonts?.ready) {
        await document.fonts.ready.catch(() => {});
    }
    const canvas = await receiptCanvas(currentReceipt);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${currentReceipt.filename}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function loadBrandIcon() {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = "assets/icons/icon-192.png";
    });
}

async function receiptCanvas(data) {
    const width = 720;
    const padding = 54;
    const contentWidth = width - padding * 2;
    const styles = getComputedStyle(document.documentElement);
    const displayFont = styles.getPropertyValue("--font-display").trim()
        || '"Bodoni Moda", "Noto Serif SC", "Songti SC", "STSong", "SimSun", Georgia, serif';
    const palette = {
        stage: styles.getPropertyValue("--receipt-stage").trim() || "#ebe4d8",
        paper: styles.getPropertyValue("--receipt-paper").trim() || "#fffaf1",
        ink: styles.getPropertyValue("--receipt-ink").trim() || "#2b211b",
        muted: styles.getPropertyValue("--receipt-muted").trim() || "#8a7c6b",
        line: styles.getPropertyValue("--receipt-line").trim() || "#dfd0bd",
        accent: styles.getPropertyValue("--receipt-accent").trim() || "#b4382a",
        accentSoft: styles.getPropertyValue("--receipt-accent-soft").trim() || "#f7e6df"
    };
    const probe = document.createElement("canvas");
    const ctx = probe.getContext("2d");
    ctx.font = `600 24px ${displayFont}`;
    const bodyLines = data.body ? wrapCanvasText(ctx, data.body, contentWidth) : [];
    const rowCount = data.sections.reduce((sum, section) => sum + section.length, 0);
    const height = 130 + data.sections.length * 36 + rowCount * 36 + bodyLines.length * 34 + 110;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");

    c.fillStyle = palette.stage;
    c.fillRect(0, 0, width, height);
    c.fillStyle = palette.paper;
    c.fillRect(22, 16, width - 44, height - 32);

    c.save();
    c.globalAlpha = 0.025;
    c.fillStyle = palette.ink;
    for (let y = 30; y < height - 30; y += 7) {
        c.fillRect(34, y, width - 68, 1);
    }
    c.restore();

    let y = 72;
    c.fillStyle = palette.ink;
    c.textAlign = "center";
    c.font = `700 36px ${displayFont}`;
    c.fillText(data.title, width / 2, y);
    y += 34;
    c.fillStyle = palette.muted;
    c.font = `600 20px ${displayFont}`;
    c.fillText(data.subtitle, width / 2, y);
    y += 28;
    drawDash(c, padding, y, contentWidth, palette.line);
    y += 34;

    data.sections.forEach(section => {
        c.textAlign = "left";
        section.forEach(item => {
            if (item.strong) {
                c.fillStyle = palette.accentSoft;
                roundRectPath(c, padding - 10, y - 27, contentWidth + 20, 42, 8);
                c.fill();
            }
            c.fillStyle = item.strong ? palette.accent : palette.muted;
            c.font = `600 22px ${displayFont}`;
            c.fillText(item.label, padding, y);
            c.fillStyle = item.strong ? palette.accent : palette.ink;
            c.textAlign = "right";
            c.font = `${item.strong ? "700" : "600"} 22px ${displayFont}`;
            c.fillText(String(item.value), width - padding, y);
            c.textAlign = "left";
            y += item.strong ? 44 : 36;
        });
        drawDash(c, padding, y - 12, contentWidth, palette.line);
        y += 22;
    });

    if (bodyLines.length) {
        c.fillStyle = palette.accentSoft;
        roundRectPath(c, padding - 10, y - 25, contentWidth + 20, bodyLines.length * 34 + 20, 8);
        c.fill();
        c.fillStyle = palette.accent;
        c.fillRect(padding - 10, y - 25, 4, bodyLines.length * 34 + 20);
        c.fillStyle = palette.ink;
        c.font = `600 22px ${displayFont}`;
        c.textAlign = "left";
        bodyLines.forEach(line => {
            c.fillText(line, padding, y);
            y += 34;
        });
        drawDash(c, padding, y - 12, contentWidth, palette.line);
        y += 22;
    }

    c.fillStyle = palette.muted;
    c.font = `600 19px ${displayFont}`;
    c.textAlign = "left";
    c.fillText(data.footer[0], padding, y);
    c.textAlign = "right";
    c.fillText(data.footer[1], width - padding, y);

    y += 48;
    const markSize = 30;
    const markX = (width - markSize) / 2;
    const lineY = y - markSize / 2;
    c.strokeStyle = palette.line;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(padding, lineY);
    c.lineTo(markX - 16, lineY);
    c.moveTo(markX + markSize + 16, lineY);
    c.lineTo(width - padding, lineY);
    c.stroke();
    const brandIcon = await loadBrandIcon().catch(() => null);
    if (brandIcon) {
        c.save();
        roundRectPath(c, markX, y - markSize, markSize, markSize, 8);
        c.clip();
        c.drawImage(brandIcon, markX, y - markSize, markSize, markSize);
        c.restore();
    }
    return canvas;
}

function drawDash(ctx, x, y, width, color = "#d4d4d8") {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
    ctx.restore();
}

function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function wrapCanvasText(ctx, text, maxWidth) {
    const lines = [];
    String(text).split("\n").forEach(paragraph => {
        let line = "";
        [...paragraph].forEach(char => {
            const test = line + char;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = char;
            } else {
                line = test;
            }
        });
        lines.push(line);
    });
    return lines;
}

function generateLeaveDoc() {
    const type = els.leaveTypeForDoc.value;
    const start = els.leaveStart.value;
    const end = els.leaveEnd.value || start;
    const english = getLanguage() === "en";
    const applicant = els.leaveApplicantDoc.value.trim() || "________";
    const recipient = els.leaveRecipientDoc.value.trim() || (english ? "Dear Manager" : "尊敬的领导");
    const handoff = els.leaveHandoffDoc.value.trim() || (english
        ? "I will arrange a complete handoff before my leave so the team's work can continue smoothly."
        : "请假期间我会提前安排好相关工作，确保不影响团队正常进度。");
    const reason = els.leaveReasonDoc.value.trim() || defaultLeaveReason(type);

    if (!isValidISODate(start) || !isValidISODate(end) || start > end) {
        els.leaveOutput.value = "请选择有效的开始日期和结束日期。";
        els.leaveReceipt.classList.add("empty");
        els.leaveReceipt.innerHTML = `<div class="receipt-empty">请选择有效的开始日期和结束日期</div>`;
        return;
    }

    const days = countLeaveDays(start, end, type);
    const applyDate = toISO(new Date());
    const body = leaveDocBody(type, start, end, days, reason, applicant, applyDate, recipient, handoff);

    els.leaveOutput.value = body;
    renderLeaveReceipt({type, start, end, days, reason, applicant, applyDate, body});
    syncSettingsFromInputs();
    state.settings.applicantName = applicant === "________" ? "" : applicant;
    state.settings.leaveRecipient = recipient;
    state.settings.leaveHandoff = handoff;
    els.applicantName.value = state.settings.applicantName;
    els.leaveRecipientInput.value = state.settings.leaveRecipient;
    els.leaveHandoffInput.value = state.settings.leaveHandoff;
    saveState();
}

function renderLeaveReceipt({type, start, end, days, reason, applicant, applyDate, body}) {
    const english = getLanguage() === "en";
    const englishTypes = {personal: "Personal leave", sick: "Sick leave", annual: "Annual leave", comp: "Comp leave"};
    const typeText = english ? (englishTypes[type] || "Personal leave") : (STATUS_LABELS[type] || "事假");
    currentLeaveReceipt = {
        kind: "leave",
        title: english ? "Leave note" : "请假条",
        subtitle: `${typeText} · THERMAL PRINT`,
        emailSubject: english
            ? `${applicant}'s ${typeText.toLowerCase()} request (${start}${end !== start ? ` to ${end}` : ""})`
            : `${applicant}的${typeText}申请（${start}${end !== start ? ` 至 ${end}` : ""}）`,
        filename: `${english ? "Leave-note" : "请假条"}-${applicant}-${applyDate}`,
        sections: [
            [
                {label: english ? "Applicant" : "申请人", value: applicant},
                {label: english ? "Leave type" : "请假类型", value: typeText},
                {label: english ? "Leave days" : "请假天数", value: english ? `${days} days` : `${days} 天`},
                {label: english ? "Request date" : "申请日期", value: applyDate},
                ...(reason ? [{label: english ? "Leave reason" : "请假理由", value: reason}] : [])
            ]
        ],
        body,
        footer: [english ? "Generated by RestCal" : "休历生成", applyDate]
    };
    els.leaveReceipt.classList.remove("empty");
    els.leaveReceipt.innerHTML = receiptInnerHtml(currentLeaveReceipt);
    currentReceipt = currentLeaveReceipt;
    els.emailLeaveDoc.disabled = false;
}

function leaveDocBody(type, start, end, days, reason, applicant, applyDate, recipient, handoff) {
    if (getLanguage() === "en") {
        const typeText = {personal: "personal leave", sick: "sick leave", annual: "annual leave", comp: "comp leave"}[type] || "personal leave";
        const dateRange = start === end ? `on ${start}` : `from ${start} to ${end}`;
        const reasonText = reason ? ` because ${reason}` : "";
        const handoffText = handoff ? ` ${handoff.replace(/[.!?]?$/, ".")}` : "";
        const recoveryText = type === "sick" ? " I will share updates on my recovery and minimize any impact on the team." : handoffText;
        return `${recipient}:\nHello,\nI am requesting ${typeText} ${dateRange} for ${days} ${days === 1 ? "day" : "days"}${reasonText}.${recoveryText}\nThank you for your consideration.\n\nApplicant: ${applicant}\nDate: ${applyDate}`;
    }
    if (type === "sick") {
        return `${recipient}：\n您好！\n因${reason}，需于${start}至${end}请病假，共${days}天。本人会根据实际情况及时同步恢复进度，并尽量减少对工作的影响。\n恳请批准，谢谢！\n\n申请人：${applicant}\n日期：${applyDate}`;
    }
    const typeText = STATUS_LABELS[type] || "事假";
    const reasonText = reason ? `因${reason}，` : "";
    return `${recipient}：\n您好！\n${reasonText}本人需于${start}至${end}请${typeText}，共${days}天。${handoff}\n恳请批准，谢谢！\n\n申请人：${applicant}\n日期：${applyDate}`;
}

function defaultLeaveReason(type) {
    const english = getLanguage() === "en";
    if (type === "sick") return state.settings.sickReason || (english ? "I am feeling unwell" : "身体不适");
    if (type === "personal") return state.settings.personalReason || (english ? "a personal matter" : "个人事务");
    return "";
}

function countLeaveDays(start, end, type) {
    const dates = rangeDates(start, end);
    const marked = dates.filter(iso => state.records[iso]?.status === type).length;
    if (marked > 0) return marked;
    return dates.filter(iso => getDayInfo(fromISO(iso)).isWorkday).length;
}

function exportCsv() {
    syncSettingsFromInputs();
    saveState();
    const rows = [[...CSV_HEADERS, CSV_USER_DATA_HEADER]];
    const userDataJson = JSON.stringify(backupUserDataSnapshot());
    let includesUserData = false;
    Object.keys(state.records).sort().forEach(iso => {
        const record = state.records[iso];
        const info = getDayInfo(fromISO(iso));
        rows.push([
            iso,
            STATUS_LABELS[record.status] || "",
            record.leaveType || "",
            record.reason || "",
            record.overtime?.hours ?? "",
            record.overtime?.rate ?? "",
            record.overtime?.reason || "",
            info.isHoliday ? "是" : "否",
            info.isWeekend ? "是" : "否",
            record.note || "",
            record.updatedAt || "",
            includesUserData ? "" : userDataJson
        ]);
        includesUserData = true;
    });
    if (!includesUserData) rows.push([...CSV_HEADERS.map(() => ""), userDataJson]);
    const csv = "\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `休历-完整备份-${toISO(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    els.csvNotice.textContent = "CSV 已导出。";
    renderDataStatus();
    showToast("CSV 已导出");
}

function importCsv(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = parseCsv(String(reader.result || ""));
            const {records: imported, userData} = validateImportedRows(parsed);
            state.records = {...state.records, ...imported};
            const restoredUserData = restoreUserDataBackup(userData);
            saveState();
            fillSettingsInputs();
            els.csvNotice.textContent = `导入成功：${Object.keys(imported).length} 条记录已合并${restoredUserData ? "，用户设置已恢复" : ""}。`;
            showToast(`导入成功：${Object.keys(imported).length} 条记录已合并`);
            render();
        } catch (error) {
            els.csvNotice.textContent = `导入失败：${error.message}`;
            showToast(`导入失败：${error.message}`, "error", {duration: 6000});
            openSettings("data");
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsText(file, "utf-8");
}

function validateImportedRows(rows) {
    if (rows.length < 2) throw new Error("CSV 内容为空。");
    const headers = rows[0].map(cell => cell.replace(/^\ufeff/, "").trim());
    const missing = CSV_REQUIRED_HEADERS.filter(header => !headers.includes(header));
    if (missing.length) throw new Error(`缺少字段：${missing.join("、")}。`);

    const index = Object.fromEntries(headers.map((header, i) => [header, i]));
    const imported = {};
    let userData = null;
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row.some(cell => cell.trim())) continue;
        const iso = (row[index["日期"]] || "").trim();
        const statusText = (row[index["状态"]] || "").trim();
        const overtimeHoursText = index["加班工时"] === undefined ? "" : (row[index["加班工时"]] || "").trim();
        const overtimeRateText = index["调休倍率"] === undefined ? "" : (row[index["调休倍率"]] || "").trim();
        const overtimeReason = index["加班事由"] === undefined ? "" : (row[index["加班事由"]] || "");
        const userDataText = index[CSV_USER_DATA_HEADER] === undefined ? "" : (row[index[CSV_USER_DATA_HEADER]] || "").trim();
        if (userDataText && !userData) {
            try {
                const parsedUserData = JSON.parse(userDataText);
                if (!parsedUserData || typeof parsedUserData !== "object" || Array.isArray(parsedUserData)) throw new Error();
                userData = parsedUserData;
            } catch {
                throw new Error(`第 ${i + 1} 行用户设置格式不正确。`);
            }
        }
        if (!iso && !statusText && userDataText) continue;
        if (!isValidISODate(iso)) throw new Error(`第 ${i + 1} 行日期格式不正确。`);
        const status = Object.entries(STATUS_LABELS).find(([, label]) => label === statusText)?.[0];
        const note = row[index["备注"]] || "";
        const overtimeHours = overtimeHoursText ? Number(overtimeHoursText) : null;
        if (overtimeHoursText && (!Number.isFinite(overtimeHours) || overtimeHours < 0.5 || overtimeHours > 24)) {
            throw new Error(`第 ${i + 1} 行加班工时应为 0.5–24 小时。`);
        }
        const overtime = overtimeHours ? {
            hours: overtimeHours,
            rate: overtimeRateText ? clampNumber(overtimeRateText, 0.1, 10, 1) : 1,
            reason: overtimeReason,
            updatedAt: index["更新时间"] === undefined ? "" : (row[index["更新时间"]] || "")
        } : null;
        if (!status) {
            if (statusText || (!note && !overtime)) throw new Error(`第 ${i + 1} 行状态必须是${Object.values(STATUS_LABELS).join("、")}，也可只填写备注或加班。`);
            imported[iso] = {
                status: "",
                leaveType: "",
                reason: "",
                note,
                ...(overtime ? {overtime} : {}),
                updatedAt: index["更新时间"] === undefined ? new Date().toISOString() : ((row[index["更新时间"]] || "").trim() || new Date().toISOString())
            };
            continue;
        }
        imported[iso] = {
            status,
            leaveType: row[index["请假类型"]] || (LEAVE_STATUSES.includes(status) ? STATUS_LABELS[status] : ""),
            reason: row[index["请假理由"]] || "",
            note,
            ...(overtime ? {overtime} : {}),
            updatedAt: index["更新时间"] === undefined ? new Date().toISOString() : ((row[index["更新时间"]] || "").trim() || new Date().toISOString())
        };
    }
    return {records: normalizeRecords(imported, userData?.workSchedule || state.workSchedule), userData};
}
