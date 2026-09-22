/* 休历 · RestCal —— Google 日历、邮件、请假条生成与弹窗记录保存
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function fillIntegrationInputs() {
    const google = state.integrations.googleCalendar;
    els.googleCalendarAutoSync.checked = google.autoSync !== false;
    document.querySelectorAll("[data-google-category]").forEach(input => {
        input.checked = google.include[input.dataset.googleCategory] !== false;
        if (input.dataset.googleCategory === "work" && google.include.work !== true) input.checked = false;
    });
    els.defaultRecipientEmail.value = state.integrations.email.defaultRecipient || "";
    els.googleClientId.value = google.clientId || "";
}

function saveIntegrationPreferences() {
    const google = state.integrations.googleCalendar;
    google.autoSync = els.googleCalendarAutoSync.checked;
    google.include = Object.fromEntries([...document.querySelectorAll("[data-google-category]")]
        .map(input => [input.dataset.googleCategory, input.checked]));
    state.integrations.email.defaultRecipient = els.defaultRecipientEmail.value.trim();
    saveState();
}

async function refreshGoogleConnection() {
    if (!window.xiuliGoogleCalendar) {
        googleConnection = {connected: false, unavailable: true};
        renderGoogleConnection();
        return;
    }
    try {
        googleConnection = await window.xiuliGoogleCalendar.status();
    } catch (error) {
        googleConnection = {connected: false, error: error.message};
    }
    renderGoogleConnection();
}

function renderGoogleConnection() {
    const connected = Boolean(googleConnection.connected);
    els.googleCalendarBadge.textContent = connected ? "已连接" : googleConnection.unavailable ? "桌面版可用" : "未连接";
    els.googleCalendarBadge.classList.toggle("connected", connected);
    els.googleCalendarOptions.hidden = !connected;
    els.googleCalendarConnect.hidden = connected;
    els.googleCalendarSync.hidden = !connected;
    els.googleCalendarDisconnect.hidden = !connected;
    if (connected) {
        const last = googleConnection.lastSyncedAt ? ` · 上次同步 ${formatSyncTime(googleConnection.lastSyncedAt)}` : "";
        els.googleCalendarMeta.textContent = `${googleConnection.email || "Google 账号"}${last}`;
    } else {
        els.googleCalendarMeta.textContent = googleConnection.unavailable
            ? "自动同步目前支持休历桌面版；仍可使用下方日历文件导出"
            : "单向同步到专属的「休历」日历，不改动其他日程";
    }
}

function formatSyncTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}).format(date);
}

function openGoogleConfig() {
    if (!window.xiuliGoogleCalendar) {
        showToast("Google 自动同步目前支持休历桌面版", "error", {duration: 5000});
        return;
    }
    els.googleConfigStatus.textContent = "";
    openBackdrop(els.googleConfigModal);
    els.googleClientId.focus({preventScroll: true});
}

function closeGoogleConfig() {
    closeBackdrop(els.googleConfigModal);
}

async function connectGoogleCalendar() {
    const clientId = els.googleClientId.value.trim();
    const clientSecret = els.googleClientSecret ? els.googleClientSecret.value.trim() : "";
    if (!clientId) {
        els.googleConfigStatus.textContent = "请填写 Google OAuth 客户端 ID。";
        return;
    }
    els.googleConfigContinue.disabled = true;
    els.googleConfigStatus.textContent = "正在打开系统浏览器，请完成 Google 授权…";
    try {
        googleConnection = await window.xiuliGoogleCalendar.connect(clientId, clientSecret);
        // 只把客户端 ID 存进本地状态用于回填；密钥只由主进程加密保存，
        // 不进 localStorage，也就不会进 CSV / WebDAV 备份。
        state.integrations.googleCalendar.clientId = clientId;
        saveState();
        if (els.googleClientSecret) els.googleClientSecret.value = "";
        closeGoogleConfig();
        renderGoogleConnection();
        showToast("Google 日历已连接");
        await syncGoogleCalendar({announce: true, force: true});
    } catch (error) {
        els.googleConfigStatus.textContent = `连接失败：${error.message || "未知错误"}`;
    } finally {
        els.googleConfigContinue.disabled = false;
    }
}

async function disconnectGoogleCalendar() {
    const confirmed = await showConfirm({
        title: "断开 Google 日历？",
        message: "休历将停止后续同步；已经建好的「休历」日历及其中的事项会保留在 Google 账号里。",
        confirmText: "断开连接"
    });
    if (!confirmed) return;
    try {
        await window.xiuliGoogleCalendar.disconnect();
        googleConnection = {connected: false};
        lastGoogleSyncSignature = "";
        renderGoogleConnection();
        showToast("已断开 Google 日历");
    } catch (error) {
        showToast(`断开失败：${error.message || "未知错误"}`, "error");
    }
}

function googleCalendarEvents() {
    const include = state.integrations.googleCalendar.include;
    return Object.entries(state.records).sort(([a], [b]) => a.localeCompare(b)).flatMap(([iso, record]) => {
        const parts = [];
        if (LEAVE_STATUSES.includes(record.status) && include.leave) parts.push(STATUS_LABELS[record.status]);
        if (record.status === "work" && include.work) parts.push("出勤");
        if (record.overtime && include.overtime) parts.push(`加班${record.overtime.hours ? ` ${record.overtime.hours} 小时` : ""}`);
        if (!parts.length && record.note && include.notes) parts.push("休历备注");
        if (!parts.length) return [];
        const descriptions = [];
        if (record.reason) descriptions.push(`原因：${record.reason}`);
        if (record.overtime?.reason) descriptions.push(`加班说明：${record.overtime.reason}`);
        if (record.note && include.notes) descriptions.push(`备注：${record.note}`);
        descriptions.push("由休历单向同步");
        return [{
            id: `restcal${iso.replaceAll("-", "")}`,
            summary: parts.join(" · "),
            description: descriptions.join("\n"),
            start: {date: iso},
            end: {date: toISO(addDays(fromISO(iso), 1))},
            transparency: "transparent",
            visibility: "private",
            extendedProperties: {private: {restcalDate: iso, restcalManaged: "true"}}
        }];
    });
}

function googleSyncSignature(events) {
    return JSON.stringify(events.map(event => [event.id, event.summary, event.description]));
}

function scheduleGoogleSync() {
    if (!googleConnection.connected || !state.integrations.googleCalendar.autoSync) return;
    window.clearTimeout(googleSyncTimer);
    googleSyncTimer = window.setTimeout(() => syncGoogleCalendar(), 900);
}

// 同一时刻只允许一次同步。记录变化会在 900ms 后自动触发同步，要是上一次还在路上，
// 两个同步会各自读一份授权文件：都看到没有 calendarId 就会各建一个日历，或者后一个
// 把前一个刚写入的事项当成残留删掉。刚连接完的首次同步窗口最大。
let googleSyncInFlight = null;

async function syncGoogleCalendar({announce = false, force = false} = {}) {
    if (!window.xiuliGoogleCalendar || !googleConnection.connected) return;
    if (googleSyncInFlight) {
        // 等前一次做完再跑，不并发。
        try { await googleSyncInFlight; } catch { /* 前一次的错误已经报过了 */ }
    }
    const events = googleCalendarEvents();
    const signature = googleSyncSignature(events);
    if (!force && signature === lastGoogleSyncSignature) return;
    els.googleCalendarSync.disabled = true;
    els.googleCalendarFeedback.textContent = "正在同步…";
    const run = (async () => {
        const result = await window.xiuliGoogleCalendar.sync(events);
        lastGoogleSyncSignature = signature;
        googleConnection.lastSyncedAt = result.lastSyncedAt;
        return result;
    })();
    googleSyncInFlight = run;
    try {
        const result = await run;
        els.googleCalendarFeedback.textContent = `已同步 ${result.synced} 条事项`;
        renderGoogleConnection();
        if (announce) showToast(`Google 日历同步完成，共 ${result.synced} 条`);
    } catch (error) {
        els.googleCalendarFeedback.textContent = `同步失败：${error.message || "未知错误"}`;
        if (announce) showToast(els.googleCalendarFeedback.textContent, "error", {duration: 6000});
    } finally {
        if (googleSyncInFlight === run) googleSyncInFlight = null;
        els.googleCalendarSync.disabled = false;
    }
}

async function emailCurrentLeaveDoc() {
    if (!currentLeaveReceipt) generateLeaveDoc();
    if (!currentLeaveReceipt) return;
    const to = state.integrations.email.defaultRecipient || "";
    const payload = {to, subject: currentLeaveReceipt.emailSubject || "请假申请", body: currentLeaveReceipt.body || els.leaveOutput.value};
    try {
        if (window.xiuliMail?.compose) {
            const result = await window.xiuliMail.compose(payload);
            if (result?.error) throw new Error(result.error);
        } else {
            window.location.href = `mailto:${encodeURIComponent(to)}?${new URLSearchParams({subject: payload.subject, body: payload.body}).toString()}`;
        }
        showToast("已打开默认邮箱");
    } catch (error) {
        showToast(`无法打开邮箱：${error.message || "未知错误"}`, "error", {duration: 6000});
    }
}

function resetLeaveGeneratorForm(preset = {}) {
    const defaultType = preset.type || preset.status || "personal";
    els.leaveApplicantDoc.value = preset.applicant ?? state.settings.applicantName ?? "";
    els.leaveRecipientDoc.value = preset.recipient ?? state.settings.leaveRecipient ?? "";
    els.leaveTypeForDoc.value = defaultType;
    els.leaveStart.value = preset.start || toISO(new Date(currentYear, currentMonth - 1, 1));
    els.leaveEnd.value = preset.end || els.leaveStart.value;
    els.leaveReasonDoc.value = preset.reason ?? defaultLeaveReason(defaultType);
    els.leaveHandoffDoc.value = preset.handoff ?? state.settings.leaveHandoff ?? "";
    clearLeaveReceiptPreview();
}

function openLeaveGenerator(preset = {}) {
    resetLeaveGeneratorForm(preset);
    openBackdrop(els.leaveGeneratorModal);
    els.leaveStart.focus({preventScroll: true});
}

function closeLeaveGenerator() {
    closeBackdrop(els.leaveGeneratorModal);
}

function clearLeaveReceiptPreview() {
    currentLeaveReceipt = null;
    els.emailLeaveDoc.disabled = true;
    if (!els.leaveReceipt) return;
    els.leaveReceipt.classList.add("empty");
    els.leaveReceipt.innerHTML = `<div class="receipt-empty">填写左侧信息后点击生成</div>`;
    els.leaveOutput.value = "";
}

function downloadLeaveReceiptImage() {
    if (!currentLeaveReceipt) {
        generateLeaveDoc();
    }
    if (!currentLeaveReceipt) return;
    currentReceipt = currentLeaveReceipt;
    downloadCurrentReceiptImage();
}

function renderModalHabits() {
    els.modalHabits.hidden = !state.habits.length;
    if (!state.habits.length) {
        els.modalHabitList.innerHTML = "";
        return;
    }
    els.modalHabitList.innerHTML = state.habits.map(habit => {
        const done = pendingHabitCheckins.has(habit.id);
        return `<button class="habit-check-row" type="button" data-modal-habit-id="${escapeHtml(habit.id)}" aria-pressed="${done}">
            <span class="habit-check-mark" aria-hidden="true"><i class="ph ph-check icon"></i></span>
            <span class="habit-check-copy"><strong>${escapeHtml(habit.name)}</strong></span>
            <span class="habit-check-state">${done ? "已打卡" : "打卡"}</span>
        </button>`;
    }).join("");
}

function togglePendingHabit(habitId) {
    if (!activeDate || !state.habits.some(habit => habit.id === habitId)) return;
    if (pendingHabitCheckins.has(habitId)) pendingHabitCheckins.delete(habitId);
    else pendingHabitCheckins.add(habitId);
    habitTouched = true;
    renderModalHabits();
    els.modalSave.disabled = false;
}

function chooseStatus(status) {
    if (!activeDate) return;
    if (status === "overtime") {
        pendingOvertime = !pendingOvertime;
        overtimeTouched = true;
        document.querySelector('[data-action="overtime"]')?.classList.toggle("active", pendingOvertime);
        updateReasonFieldVisibility(pendingStatus);
        els.modalSave.disabled = false;
        return;
    }
    pendingStatus = status;
    document.querySelectorAll("[data-action]").forEach(button => {
        if (button.dataset.action !== "overtime") button.classList.toggle("active", button.dataset.action === status);
    });
    updateReasonFieldVisibility(status);
    updateModalDocButton();
    if (LEAVE_STATUSES.includes(status)) {
        const existingReason = els.modalReason.value.trim();
        els.leaveStart.value = activeDate;
        els.leaveEnd.value = activeDate;
        els.leaveTypeForDoc.value = status;
        if (existingReason) els.leaveReasonDoc.value = existingReason;
    }
}

function updateReasonFieldVisibility(status) {
    if (els.modalReasonField) {
        els.modalReasonField.hidden = !LEAVE_STATUSES.includes(status);
    }
    if (els.modalOvertimeField) {
        els.modalOvertimeField.hidden = !pendingOvertime;
    }
}

function clearActiveRecord() {
    if (!activeDate) return;
    // 默认只清除当前日期；展开「更多选项」并填写有效范围时按范围清除
    let start = activeDate;
    let end = activeDate;
    if (els.modalAdvanced.open) {
        const rawStart = els.modalStartDate.value;
        const rawEnd = els.modalEndDate.value;
        if (isValidISODate(rawStart) && isValidISODate(rawEnd) && rawStart <= rawEnd) {
            start = rawStart;
            end = rawEnd;
        }
    }
    const removed = {};
    const removedHabitCheckins = {};
    const dates = rangeDates(start, end);
    dates.forEach(iso => {
        if (state.records[iso]) {
            removed[iso] = state.records[iso];
            delete state.records[iso];
        }
        state.habits.forEach(habit => {
            if (!state.habitCheckins?.[habit.id]?.[iso]) return;
            removedHabitCheckins[habit.id] ||= {};
            removedHabitCheckins[habit.id][iso] = state.habitCheckins[habit.id][iso];
            delete state.habitCheckins[habit.id][iso];
        });
    });
    const removedHabitDates = Object.values(removedHabitCheckins).flatMap(checkins => Object.keys(checkins));
    const count = new Set([...Object.keys(removed), ...removedHabitDates]).size;
    saveState();
    closeModal();
    render();
    if (!count) return;
    showToast(`已清除 ${count} 条记录`, "success", {
        actionLabel: "撤销",
        onAction: () => {
            Object.assign(state.records, removed);
            Object.entries(removedHabitCheckins).forEach(([habitId, checkins]) => {
                state.habitCheckins[habitId] ||= {};
                Object.assign(state.habitCheckins[habitId], checkins);
            });
            saveState();
            render();
        }
    });
}

function updateModalDocButton() {
    const canGenerate = ["personal", "sick"].includes(pendingStatus);
    els.modalGenerateDoc.hidden = !canGenerate;
    els.modalGenerateDoc.disabled = !canGenerate;
}

function generateLeaveDocFromModal() {
    if (!["personal", "sick"].includes(pendingStatus)) return;
    const start = els.modalStartDate.value || activeDate;
    const end = els.modalEndDate.value || start;
    if (!isValidISODate(start) || !isValidISODate(end) || start > end) {
        els.modalSubtitle.textContent = "请选择有效的日期范围";
        return;
    }

    const reason = LEAVE_STATUSES.includes(pendingStatus) ? els.modalReason.value.trim() : "";
    els.leaveStart.value = start;
    els.leaveEnd.value = end;
    els.leaveTypeForDoc.value = pendingStatus;
    els.leaveReasonDoc.value = reason;
    saveModalRecord({keepOpen: true});
    openLeaveGenerator({
        type: pendingStatus,
        start,
        end,
        reason
    });
    generateLeaveDoc();
    closeModal();
}

function saveModalRecord(options = {}) {
    if (!activeDate) return;
    const start = els.modalStartDate.value || activeDate;
    const end = els.modalEndDate.value || start;
    if (!isValidISODate(start) || !isValidISODate(end) || start > end) {
        els.modalSubtitle.textContent = "请选择有效的日期范围";
        return;
    }
    const reason = LEAVE_STATUSES.includes(pendingStatus) ? els.modalReason.value.trim() : "";
    const note = els.modalNote.value.trim();
    const hasStatus = Boolean(pendingStatus && pendingStatus !== "clear");
    if (!hasStatus && !note && !pendingOvertime && !overtimeTouched && !habitTouched) return;
    const allDates = rangeDates(start, end);
    const statusDates = allDates;
    const overtimeScope = els.modalOvertimeScope?.value || "all";
    const overtimeDates = allDates.filter(iso => {
        const isWorkday = isConfiguredWorkday(fromISO(iso));
        if (overtimeScope === "workdays") return isWorkday;
        if (overtimeScope === "rest-days") return !isWorkday;
        return true;
    });
    if (!statusDates.length && !((pendingOvertime || overtimeTouched) && overtimeDates.length)) {
        els.modalSubtitle.textContent = "所选范围没有可记录的日期。";
        return;
    }
    const overtimeHours = Number(els.modalOvertimeHours?.value);
    const overtimeRate = Number(els.modalOvertimeRate?.value);
    if (pendingOvertime && (!Number.isFinite(overtimeHours) || overtimeHours < 0.5 || overtimeHours > 24)) {
        els.modalSubtitle.textContent = "加班工时应为 0.5–24 小时";
        return;
    }
    const updatedAt = new Date().toISOString();
    if (habitTouched) {
        state.habits.forEach(habit => {
            state.habitCheckins[habit.id] ||= {};
            if (pendingHabitCheckins.has(habit.id)) state.habitCheckins[habit.id][activeDate] ||= updatedAt;
            else delete state.habitCheckins[habit.id][activeDate];
        });
    }
    statusDates.forEach(iso => {
        const existing = state.records[iso] || {};
        if (!hasStatus && !note && !existing.status && !existing.reason && !existing.note) return;
        const next = {...existing, note, updatedAt};
        if (hasStatus) {
            next.status = pendingStatus;
            next.leaveType = LEAVE_STATUSES.includes(pendingStatus) ? STATUS_LABELS[pendingStatus] : "";
            next.reason = reason;
        }
        state.records[iso] = next;
    });

    if (pendingOvertime) {
        const overtimeReason = els.modalOvertimeReason?.value.trim() || "";
        overtimeDates.forEach(iso => {
            const existing = state.records[iso] || {};
            state.records[iso] = {
                ...existing,
                note: existing.note || (iso === activeDate ? note : ""),
                overtime: {hours: overtimeHours, rate: overtimeRate || 1, reason: overtimeReason, updatedAt},
                updatedAt
            };
        });
    } else if (overtimeTouched) {
        overtimeDates.forEach(iso => {
            const existing = state.records[iso];
            if (!existing?.overtime) return;
            const next = {...existing, updatedAt};
            delete next.overtime;
            if (!next.status && !next.reason && !next.note) delete state.records[iso];
            else state.records[iso] = next;
        });
    }

    if (LEAVE_STATUSES.includes(pendingStatus)) {
        els.leaveStart.value = start;
        els.leaveEnd.value = end;
        els.leaveTypeForDoc.value = pendingStatus;
        if (reason) els.leaveReasonDoc.value = reason;
    }

    if (!saveState()) return;
    if (!options.keepOpen) {
        closeModal();
        const changedDates = new Set([
            ...(hasStatus || note ? statusDates : []),
            ...(pendingOvertime || overtimeTouched ? overtimeDates : []),
            ...(habitTouched ? [activeDate] : [])
        ]).size;
        showToast(changedDates > 1 ? `已保存 ${changedDates} 天记录` : "记录已保存");
    }
    render();
}
