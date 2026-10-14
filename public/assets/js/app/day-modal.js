/* 休历 · RestCal —— 日期弹窗、深链与系统日历、设置读写、toast/确认、新手引导巡览
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function openModal(iso) {
    const date = fromISO(iso);
    const info = getDayInfo(date);
    const record = state.records[iso] || {};
    const scheduledWorkday = isConfiguredWorkday(date, info);
    const restDay = !scheduledWorkday;
    dayModalBackdropPress = false;
    activeDate = iso;
    selectedDate = iso;
    pendingStatus = record.status || (scheduledWorkday ? "work" : "");
    pendingOvertime = Boolean(record.overtime);
    overtimeTouched = false;
    pendingHabitCheckins = new Set(checkedHabitsForDate(iso).map(habit => habit.id));
    habitTouched = false;
    document.querySelectorAll(".day-card.selected").forEach(card => card.classList.remove("selected"));
    document.querySelector(`[data-date="${iso}"]`)?.classList.add("selected");
    renderModalHeading(date, info);
    els.modalStartDate.value = iso;
    els.modalEndDate.value = iso;
    els.modalReason.value = record.reason || "";
    els.modalNote.value = record.note || "";
    els.modalNote.disabled = false;
    document.querySelectorAll("[data-action]").forEach(button => {
        const isOvertime = button.dataset.action === "overtime";
        button.disabled = false;
        button.classList.toggle("active", isOvertime ? pendingOvertime : button.dataset.action === pendingStatus);
    });
    if (els.modalOvertimeHours) els.modalOvertimeHours.value = String(record.overtime?.hours || 2);
    if (els.modalOvertimeRate) els.modalOvertimeRate.value = String(record.overtime?.rate || 1);
    if (els.modalOvertimeScope) els.modalOvertimeScope.value = scheduledWorkday ? "workdays" : "rest-days";
    if (els.modalOvertimeReason) els.modalOvertimeReason.value = record.overtime?.reason || "";
    renderModalHabits();
    updateReasonFieldVisibility(pendingStatus);
    els.modalSave.disabled = false;
    els.modalClear.hidden = !record.status && !record.reason && !record.note && !record.overtime && !pendingHabitCheckins.size;
    els.modalAdvanced.open = restDay || Boolean(record.note);
    if (els.modalRangeNotice) els.modalRangeNotice.textContent = "应用到所选范围内的每一天，包括周末和节假日。";
    updateModalDocButton();
    openBackdrop(els.dayModal);
    const initialFocus = restDay
        ? els.modalNote
        : els.dayModal.querySelector(".action-btn:not(:disabled)");
    initialFocus?.focus({preventScroll: true});
}

function modalSubtitleText(date, info) {
    const parts = [toISO(date), getLunarText(date)];
    if (info.holidayName) parts.push(info.holidayName);
    if (info.makeupName) parts.push(info.makeupName);
    if (!info.holidayName && !info.makeupName && info.isWeekend) parts.push("周末");
    return parts.filter(Boolean).join(" · ");
}

function renderModalHeading(date, info) {
    els.modalTitle.textContent = getLanguage() === "en"
        ? `${new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric"}).format(date)} · ${weekdayName(date)}`
        : `${date.getMonth() + 1}月${date.getDate()}日 ${weekdayName(date)}`;
    els.modalSubtitle.textContent = modalSubtitleText(date, info);
}

function closeModal() {
    dayModalBackdropPress = false;
    activeDate = null;
    pendingStatus = null;
    pendingOvertime = false;
    overtimeTouched = false;
    pendingHabitCheckins = new Set();
    habitTouched = false;
    closeBackdrop(els.dayModal);
}

function restcalDateLink(iso) {
    return `restcal://day/${encodeURIComponent(iso)}`;
}

function parseRestcalDateLink(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    try {
        const url = new URL(rawUrl, location.href);
        let iso = url.searchParams.get("date") || "";
        if (url.protocol === "restcal:") {
            if (url.hostname !== "day") return "";
            iso = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/")[0] || "");
        }
        return isValidISODate(iso) ? iso : "";
    } catch {
        return "";
    }
}

async function openRestcalDateLink(rawUrl) {
    const iso = parseRestcalDateLink(rawUrl);
    if (!iso) return false;
    if (openBackdrops.size) {
        [...openBackdrops].forEach(closeBackdrop);
        await new Promise(resolve => window.setTimeout(resolve, 220));
    }
    const date = fromISO(iso);
    currentYear = date.getFullYear();
    currentMonth = date.getMonth() + 1;
    anchorDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    switchView("calendar");
    await render();
    if (!calendarApi.years.has(currentYear)) {
        showToast(`暂时无法打开 ${iso} 的日历数据`, "error");
        return false;
    }
    openModal(iso);
    return true;
}

async function initCalendarDeepLinks() {
    let opened = false;
    const receive = async payload => {
        const rawUrl = typeof payload === "string" ? payload : payload?.url;
        if (await openRestcalDateLink(rawUrl)) opened = true;
    };

    window.xiuliCalendar?.onDeepLink?.(receive);
    const nativeApp = window.Capacitor?.Plugins?.App;
    nativeApp?.addListener?.("appUrlOpen", receive);

    const initialUrls = [];
    if (/[?&]date=/.test(location.search)) initialUrls.push(location.href);
    try {
        const desktopUrl = await window.xiuliCalendar?.getLaunchUrl?.();
        if (desktopUrl) initialUrls.push(desktopUrl);
    } catch {}
    try {
        const launch = await nativeApp?.getLaunchUrl?.();
        if (launch?.url) initialUrls.push(launch.url);
    } catch {}
    for (const url of [...new Set(initialUrls)]) await receive(url);
    return opened;
}

function activeCalendarEvent() {
    const iso = activeDate;
    const status = pendingStatus && pendingStatus !== "clear" ? pendingStatus : "";
    const statusLabel = STATUS_LABELS[status] || "";
    const reason = LEAVE_STATUSES.includes(status) ? els.modalReason.value.trim() : "";
    const note = els.modalNote.value.trim();
    const overtimeHours = pendingOvertime ? Number(els.modalOvertimeHours?.value) || 0 : 0;
    const overtimeReason = pendingOvertime ? els.modalOvertimeReason?.value.trim() || "" : "";
    const labels = [statusLabel && `[${statusLabel}]`, pendingOvertime && `[加班 ${overtimeHours}小时]`].filter(Boolean);
    const link = restcalDateLink(iso);
    const description = [
        reason && `理由：${reason}`,
        overtimeReason && `加班事由：${overtimeReason}`,
        note && `备注：${note}`,
        `在休历中打开：${link}`
    ].filter(Boolean).join("\n");
    return {
        date: iso,
        uid: `restcal-day-${iso}@restcal.app`,
        restcalId: `day:${iso}`,
        summary: `${labels.join(" ") || "[休历]"}${reason ? ` ${reason}` : ""}`,
        description,
        url: link,
        transparent: !LEAVE_STATUSES.includes(status)
    };
}

function ticketCalendarEvent(item) {
    const saleDate = item.saleDate instanceof Date ? item.saleDate : fromISO(String(item.saleDate));
    const [hour, minute] = normalizeTicketPreferences(state.ticketPreferences, state.settings).reminderTime.split(":").map(Number);
    const startTime = Date.UTC(saleDate.getFullYear(), saleDate.getMonth(), saleDate.getDate(), hour - 8, minute);
    const tripLabel = item.tripType === "return" ? "返程" : "去程";
    const departure = item.departure instanceof Date ? item.departure : fromISO(String(item.departure));
    return {
        summary: `[抢票提醒] ${item.name}${tripLabel}火车票今日开售`,
        description: `计划${tripLabel}日：${toISO(departure)}。具体起售时间以出发站及车次为准。`,
        startTime,
        endTime: startTime + 30 * 60 * 1000,
        allDay: false
    };
}

async function addActiveDateToCalendar() {
    if (!activeDate || !window.XiuliIcs?.generateEventIcs) return;
    const event = activeCalendarEvent();
    const content = XiuliIcs.generateEventIcs(event);
    const filename = `RestCal-${event.date}.ics`;
    els.modalAddCalendar.disabled = true;
    try {
        const nativeCalendar = window.Capacitor?.Plugins?.Calendar;
        if (nativeCalendar?.addEvent) {
            const startTime = Date.parse(`${event.date}T00:00:00Z`);
            await nativeCalendar.addEvent({...event, startTime, endTime: startTime + 86400000, allDay: true});
            showToast("已打开系统日历，请确认保存");
            return;
        }
        if (window.xiuliCalendar?.addEvent) {
            const result = await window.xiuliCalendar.addEvent({content, filename});
            if (result?.error) throw new Error(result.error);
            showToast("已交给默认日历应用打开");
            return;
        }
        XiuliIcs.downloadIcs(content, filename);
        showToast("日历文件已下载，请在系统日历中打开");
    } catch (error) {
        showToast(`无法打开系统日历：${error.message || "未知错误"}`, "error", {duration: 6000});
    } finally {
        els.modalAddCalendar.disabled = false;
    }
}

// state.settings 只存没有结构化归宿的设置：扣薪比例、假期额度、请假条文案。
// 工资、额度规则、购票偏好归 state.salary / quotaRules / ticketPreferences，
// 这里不再写一份镜像——两处同义字段总会有一天对不上。旧存档里的镜像字段
// 仍由 core.js 的 structuredState() 在加载时读一次作为回退。
function syncSettingsFromInputs() {
    state.settings.personalRate = cleanPercent(els.personalRateInput.value, DEFAULT_RATES.personal);
    state.settings.sickRate = cleanPercent(els.sickRateInput.value, DEFAULT_RATES.sick);
    state.settings.annualRate = cleanPercent(els.annualRateInput.value, DEFAULT_RATES.annual);
    state.settings.compRate = cleanPercent(els.compRateInput.value, DEFAULT_RATES.comp);
    state.settings.annualQuota = cleanNumber(els.annualQuotaInput.value);
    state.settings.compQuota = cleanNumber(els.compQuotaInput.value);
    state.settings.applicantName = els.applicantName.value.trim();
    state.settings.leaveRecipient = els.leaveRecipientInput.value.trim();
    state.settings.personalReason = els.personalReasonInput.value.trim();
    state.settings.sickReason = els.sickReasonInput.value.trim();
    state.settings.leaveHandoff = els.leaveHandoffInput.value.trim();
    state.profile = {name: els.profileNameInput.value.trim(), company: els.companyInput.value.trim(), hireDate: els.hireDateInput.value};
    state.workSchedule = {workdaysPerWeek: clampInt(els.workdaysInput.value, 1, 7, 5), restDays: [...els.restDaysPicker.querySelectorAll("input:checked")].map(input => Number(input.value)), dailyWorkHours: clampNumber(els.dailyHoursInput.value, 0.5, 24, 8), scheduleType: els.scheduleTypeInput.value || "standard"};
    state.salary = {
        monthlySalary: cleanNumber(els.salaryInput.value),
        fixedDeductions: cleanNumber(els.deductionInput.value),
        estimatedTax: cleanNumber(els.estimatedTaxInput.value),
        specialDeductions: cleanNumber(els.specialDeductionInput?.value || 0),
        taxMode: els.taxCalculationMode?.value || "simple",
        payday: els.paydayInput.value ? clampInt(els.paydayInput.value, 1, 31, 10) : null
    };
    state.quotaRules = {
        annualExpireRule: els.annualExpireRule?.value || "next-03-31",
        compExpireRule: els.compExpireRule?.value || "none"
    };
    state.ticketPreferences = normalizeTicketPreferences({
        origin: els.ticketOrigin?.value,
        destination: els.ticketDestination?.value,
        transfers: readTicketTransfers(),
        flightOrigin: document.getElementById("flightOrigin").value,
        flightDestination: document.getElementById("flightDestination").value,
        departureRule: els.ticketDepartureRule?.value,
        returnRule: els.ticketReturnRule?.value,
        reminderTime: els.icsTicketTime?.value,
        advanceDays: els.ticketAdvanceDays?.value
    });
}

function fillSettingsInputs() {
    els.salaryInput.value = state.salary.monthlySalary || "";
    els.deductionInput.value = state.salary.fixedDeductions || "";
    els.estimatedTaxInput.value = state.salary.estimatedTax || "";
    if (els.specialDeductionInput) els.specialDeductionInput.value = state.salary.specialDeductions || "";
    if (els.taxCalculationMode) els.taxCalculationMode.value = state.salary.taxMode || "simple";
    if (els.annualExpireRule) els.annualExpireRule.value = state.quotaRules.annualExpireRule;
    if (els.compExpireRule) els.compExpireRule.value = state.quotaRules.compExpireRule;
    els.paydayInput.value = state.salary.payday || "";
    els.personalRateInput.value = settingNumber("personalRate", DEFAULT_RATES.personal);
    els.sickRateInput.value = settingNumber("sickRate", DEFAULT_RATES.sick);
    els.annualRateInput.value = settingNumber("annualRate", DEFAULT_RATES.annual);
    els.compRateInput.value = settingNumber("compRate", DEFAULT_RATES.comp);
    els.annualQuotaInput.value = state.settings.annualQuota || "";
    els.compQuotaInput.value = state.settings.compQuota || "";
    els.applicantName.value = state.settings.applicantName || "";
    els.leaveRecipientInput.value = state.settings.leaveRecipient || "";
    els.personalReasonInput.value = state.settings.personalReason || "";
    els.sickReasonInput.value = state.settings.sickReason || "";
    els.leaveHandoffInput.value = state.settings.leaveHandoff || "";
    els.profileNameInput.value = state.profile.name || state.settings.applicantName || "";
    els.companyInput.value = state.profile.company || "";
    els.hireDateInput.value = state.profile.hireDate || "";
    els.workdaysInput.value = state.workSchedule.workdaysPerWeek;
    els.dailyHoursInput.value = state.workSchedule.dailyWorkHours;
    els.scheduleTypeInput.value = state.workSchedule.scheduleType;
    if (els.ticketDepartureRule) els.ticketDepartureRule.value = state.ticketPreferences.departureRule;
    if (els.ticketOrigin) els.ticketOrigin.value = state.ticketPreferences.origin;
    if (els.ticketDestination) els.ticketDestination.value = state.ticketPreferences.destination;
    document.getElementById("flightOrigin").value = state.ticketPreferences.flightOrigin || "";
    document.getElementById("flightDestination").value = state.ticketPreferences.flightDestination || "";
    renderTicketTransferStations();
    renderTicketRouteQueries();
    renderFlightRoutePreview();
    if (els.ticketReturnRule) els.ticketReturnRule.value = state.ticketPreferences.returnRule;
    if (els.ticketAdvanceDays) els.ticketAdvanceDays.value = state.ticketPreferences.advanceDays;
    if (els.icsTicketTime) els.icsTicketTime.value = state.ticketPreferences.reminderTime;
    renderRestDaysPicker();
}

function showToast(message, tone = "success", options = {}) {
    const toast = document.createElement("div");
    const normalizedTone = tone === "danger" ? "error" : tone;
    const toastIcons = {
        success: "check-circle",
        error: "warning-circle",
        warning: "warning",
        info: "info"
    };
    toast.className = `toast ${normalizedTone}`;
    toast.setAttribute("role", normalizedTone === "error" ? "alert" : "status");
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<i class="ph ph-${toastIcons[normalizedTone] || toastIcons.info} icon"></i>`;
    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(text);
    let dismissed = false;
    let dismissTimer = 0;
    let remaining = options.duration || (options.actionLabel ? 6000 : 3200);
    let timerStartedAt = 0;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        window.clearTimeout(dismissTimer);
        toast.classList.remove("show");
        window.setTimeout(() => toast.remove(), 220);
    };
    const startDismissTimer = () => {
        if (dismissed) return;
        window.clearTimeout(dismissTimer);
        timerStartedAt = performance.now();
        dismissTimer = window.setTimeout(dismiss, remaining);
    };
    const pauseDismissTimer = () => {
        if (dismissed || !dismissTimer) return;
        window.clearTimeout(dismissTimer);
        dismissTimer = 0;
        remaining = Math.max(0, remaining - (performance.now() - timerStartedAt));
    };
    if (options.actionLabel && typeof options.onAction === "function") {
        const action = document.createElement("button");
        action.type = "button";
        action.className = "toast-action";
        action.textContent = options.actionLabel;
        action.addEventListener("click", () => {
            options.onAction();
            dismiss();
        });
        toast.appendChild(action);
    }
    toast.addEventListener("mouseenter", pauseDismissTimer);
    toast.addEventListener("mouseleave", startDismissTimer);
    els.toastRegion.appendChild(toast);
    window.setTimeout(() => toast.classList.add("show"), 10);
    startDismissTimer();
}

function showConfirm({title = "确认操作", message = "", confirmText = "确定", cancelText = "取消", danger = false} = {}) {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmOk.textContent = confirmText;
    els.confirmCancel.textContent = cancelText;
    els.confirmOk.classList.toggle("danger", danger);
    els.confirmOk.classList.toggle("primary", !danger);
    openBackdrop(els.confirmModal);
    window.setTimeout(() => els.confirmCancel.focus({preventScroll: true}), 30);
    return new Promise(resolve => {
        confirmResolver = resolve;
    });
}

function resolveConfirm(result) {
    if (!confirmResolver) return;
    const resolve = confirmResolver;
    confirmResolver = null;
    closeBackdrop(els.confirmModal);
    resolve(result);
}

function exportPersonalSettings() { syncSettingsFromInputs(); const blob = new Blob([JSON.stringify({profile: state.profile, workSchedule: state.workSchedule, salary: state.salary, ticketPreferences: state.ticketPreferences, dashboard: state.dashboard, habits: state.habits, habitCheckins: state.habitCheckins}, null, 2)], {type: "application/json"}); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "restcal-personal-settings.json"; link.click(); URL.revokeObjectURL(link.href); showToast("个人设置已导出"); }

async function clearPersonalSettings() {
    const ok = await showConfirm({
        title: "清除个人设置？",
        message: "将重置个人资料、工作制度和工资配置。请假记录不会被删除。",
        confirmText: "清除",
        danger: true
    });
    if (!ok) return;
    applyUserData(DEFAULT_USER_DATA);
    state.onboardingCompleted = false;
    state.onboardingSkipped = true;
    saveState();
    render();
    showToast("个人设置已清除");
}

async function clearAllData() {
    const ok = await showConfirm({
        title: "清除所有本地数据？",
        message: "将删除全部请假记录、个人与工资设置、主题与语言偏好以及 WebDAV 配置，且无法恢复。建议先导出 CSV 备份。",
        confirmText: "全部清除",
        danger: true
    });
    if (!ok) return;
    try { await window.xiuliGoogleCalendar?.disconnect(); } catch { }
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(WEBDAV_KEY);
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(PALETTE_KEY);
    localStorage.removeItem("restcal-language");
    window.location.reload();
}

function openSettings(group) {
    const requested = SETTINGS_GROUP_ALIASES[group] || group;
    const valid = requested && document.querySelector(`[data-settings-panel="${requested}"]`) ? requested : activeSettingsPanel;
    setSettingsPanel(valid);
    // 移动端：未指定分类时先展示目录，指定分类时直接进入二级页
    els.settingsPage?.classList.toggle("subpage-open", Boolean(group));
    renderDataStatus();
    renderWebdavCard();
    refreshGoogleConnection();
    syncAppearanceControls();
    openBackdrop(els.settingsModal);
    if (group === "webdav" && !isWebdavConfigured()) window.setTimeout(openWebdavConfigModal, 220);
}

function closeSettings() {
    closeBackdrop(els.settingsModal);
    els.settingsPage?.classList.remove("subpage-open");
}

function openWebdavConfigModal() {
    els.webdavUrl.value = webdavConfig.url || "";
    els.webdavUsername.value = webdavConfig.username || "";
    els.webdavPassword.value = webdavConfig.password || "";
    els.webdavConfigStatus.textContent = els.webdavStatus.textContent || "填写连接信息后可先测试连接。";
    openBackdrop(els.webdavConfigModal);
    window.setTimeout(() => els.webdavUrl.focus({preventScroll: true}), 30);
}

function closeWebdavConfigModal() {
    syncWebDavConfigFromInputs();
    renderWebdavCard();
    closeBackdrop(els.webdavConfigModal);
}

function firstVisible(selector) {
    return [...document.querySelectorAll(selector)].find(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }) || null;
}

function tourWorkdayCard() {
    return [...els.calendarGrid.querySelectorAll(".day-card.clickable:not(.outside)")].find(card => {
        const date = card.dataset.date ? fromISO(card.dataset.date) : null;
        return date && getDayInfo(date).isWorkday;
    }) || els.calendarGrid.querySelector(".day-card.clickable:not(.outside)");
}

function tourCalendarToolbarTargets() {
    return [
        enhancedSelects.get(els.yearSelect)?.box || els.yearSelect,
        enhancedSelects.get(els.monthSelect)?.box || els.monthSelect,
        els.todayBtn,
        document.querySelector("#viewCalendar .view-switcher"),
        ...els.monthSummary.children
    ].filter(Boolean);
}

function waitForTourTransition(ms = 220) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function initProductTour() {
    if (!window.RestCalProductTour) return;
    const {ProductTour} = window.RestCalProductTour;
    productTour = new ProductTour({
        steps: [
            {
                targets: tourCalendarToolbarTargets,
                section: "日历工作台",
                icon: "ph-calendar-blank",
                title: "从时间开始安排",
                text: "这里可以切换日、周、月、年视图，也能用年份、月份和“今天”快速定位。下方概览会同步汇总当前月份。",
                beforeEnter: async () => {
                    if (els.settingsModal.classList.contains("open")) closeSettings();
                    closeAllDateMenus();
                    if (els.dayModal.classList.contains("open")) closeModal();
                    switchView("calendar");
                    if (calendarMode !== "month") setCalendarMode("month");
                    await waitForTourTransition(80);
                }
            },
            {
                target: tourWorkdayCard,
                section: "记录",
                icon: "ph-pencil-simple-line",
                title: "点一天，完成记录",
                text: "选择任意日期，就能记录出勤、请假、加班、备注和习惯打卡。现在点一下高亮的工作日试试。",
                advanceOn: "target-click",
                beforeEnter: async () => {
                    if (els.settingsModal.classList.contains("open")) closeSettings();
                    closeAllDateMenus();
                    if (els.dayModal.classList.contains("open")) {
                        closeModal();
                        await waitForTourTransition();
                    }
                    switchView("calendar");
                    await render();
                }
            },
            {
                targets: () => document.querySelectorAll(".day-modal .action-grid-primary .action-btn"),
                section: "记录",
                icon: "ph-calendar-check",
                title: "状态、时长与批量标记",
                text: "选择当天状态和时长；“更多选项”可一次标记一段日期，并自动跳过周末和法定节假日。引导不会保存这条演示记录。",
                beforeEnter: async () => {
                    if (!els.dayModal.classList.contains("open")) {
                        const card = tourWorkdayCard();
                        if (card?.dataset.date) openModal(card.dataset.date);
                    }
                    els.modalAdvanced.open = false;
                    await waitForTourTransition(80);
                }
            },
            {
                target: () => firstVisible('.app-nav-btn[data-nav="stats"], .bottom-nav-btn[data-nav="stats"]'),
                section: "统计",
                icon: "ph-chart-bar",
                title: "让记录变成清晰统计",
                text: "统计页汇总月度与年度出勤、各类请假和剩余额度。点击“统计”查看。",
                advanceOn: "target-click",
                beforeEnter: async () => {
                    if (els.settingsModal.classList.contains("open")) {
                        closeSettings();
                        await waitForTourTransition();
                    }
                    closeAllDateMenus();
                    if (els.dayModal.classList.contains("open")) {
                        closeModal();
                        await waitForTourTransition();
                    }
                }
            },
            {
                target: () => firstVisible('.app-nav-btn[data-nav="tools"], .bottom-nav-btn[data-nav="tools"]'),
                section: "工具箱",
                icon: "ph-toolbox",
                title: "把记录继续用起来",
                text: "点击“工具”，进入工资核算、请假条、购票提醒、习惯打卡和日历导出。",
                advanceOn: "target-click",
                beforeEnter: async () => {
                    if (els.settingsModal.classList.contains("open")) {
                        closeSettings();
                        await waitForTourTransition();
                    }
                    closeAllDateMenus();
                    if (els.dayModal.classList.contains("open")) {
                        closeModal();
                        await waitForTourTransition();
                    }
                }
            },
            {
                targets: () => document.querySelectorAll(".tools-grid .tool-card"),
                section: "工具箱",
                icon: "ph-sparkle",
                title: "五个工具，覆盖高频场景",
                text: "出勤记录可直接核算工资、生成工资条和请假条；节假日可查看购票提醒，日常还能打卡并导出到系统日历。",
                beforeEnter: async () => {
                    if (els.settingsModal.classList.contains("open")) closeSettings();
                    switchView("tools");
                    await waitForTourTransition(80);
                }
            },
            {
                target: "#settingsToggle",
                section: "个性化",
                icon: "ph-sliders-horizontal",
                title: "先按你的工作方式设置",
                text: "在设置中填写工作制度、薪资、假期额度和购票习惯，统计与工资核算会据此自动调整。",
                advanceOn: "target-click",
                beforeEnter: async () => {
                    if (els.settingsModal.classList.contains("open")) {
                        closeSettings();
                        await waitForTourTransition();
                    }
                    switchView("tools");
                }
            },
            {
                target: ".settings-page",
                section: "安全与偏好",
                icon: "ph-shield-check",
                title: "数据由你掌控",
                text: "数据默认保存在当前设备。你可以导出 CSV、同步 WebDAV，也能随时切换主题和中英文界面。到这里，核心功能就认识完了。",
                beforeEnter: async () => {
                    if (!els.settingsModal.classList.contains("open")) openSettings();
                    els.settingsPage?.classList.remove("subpage-open");
                    await waitForTourTransition(240);
                }
            }
        ],
        onFinish: () => completeProductTour(false),
        onSkip: () => completeProductTour(true)
    });
}

function openGuide() {
    if (productTour?.active) return;
    openBackdrop(els.guideModal);
}

function closeGuide() {
    closeBackdrop(els.guideModal);
}

function dismissProductTourIntro() {
    state.productTourSeenVersion = PRODUCT_TOUR_VERSION;
    saveState();
    closeGuide();
}

async function startProductTour() {
    closeGuide();
    await waitForTourTransition();
    if (!productTour) {
        showToast("界面引导模块暂不可用，请刷新后重试", "error");
        return;
    }
    productTour.start();
}

function skipProductTour() {
    productTour?.skip();
}

function completeProductTour(skipped) {
    state.productTourSeenVersion = PRODUCT_TOUR_VERSION;
    saveState();
    closeAllDateMenus();
    if (els.dayModal.classList.contains("open")) closeModal();
    if (els.settingsModal.classList.contains("open")) closeSettings();
    switchView("calendar");
    showToast(skipped ? "已退出界面引导，可从右上角重新打开" : "界面引导已完成");
    if (!skipped) window.RestCalOnboardingView?.celebrate();
}
