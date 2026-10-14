/* 休历 · RestCal —— 通用工具函数与应用状态的加载、规范化、保存
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function tag(text, cls) {
    return `<span class="tag ${cls}">${escapeHtml(text)}</span>`;
}

function weekdayName(date) {
    return (getLanguage() === "en"
        ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"])[date.getDay()];
}

function formatMoney(value) {
    return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency: "CNY",
        maximumFractionDigits: 2
    }).format(Number.isFinite(value) ? value : 0);
}

function formatMonthDay(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function diffDays(start, end) {
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.ceil((endDate - startDate) / 86400000);
}

function cleanNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function cleanPercent(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(100, Math.max(0, number));
}

function settingNumber(key, fallback = 0) {
    return state.settings[key] === undefined || state.settings[key] === ""
        ? fallback
        : cleanNumber(state.settings[key]);
}

// 读已保存的设置而不是输入框：设置页的每次 input 都会先 syncSettingsFromInputs()
// 再重算，两者结果一致；但读状态让核算不再取决于某个 DOM 节点是否存在。
function getSalaryRates() {
    return {
        personal: cleanPercent(state.settings.personalRate, DEFAULT_RATES.personal),
        sick: cleanPercent(state.settings.sickRate, DEFAULT_RATES.sick),
        annual: cleanPercent(state.settings.annualRate, DEFAULT_RATES.annual),
        comp: cleanPercent(state.settings.compRate, DEFAULT_RATES.comp)
    };
}

function rangeDates(start, end) {
    const result = [];
    let cursor = fromISO(start);
    const finish = fromISO(end);
    while (cursor <= finish) {
        result.push(toISO(cursor));
        cursor = addDays(cursor, 1);
    }
    return result;
}

function addDays(date, amount) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    copy.setDate(copy.getDate() + amount);
    return copy;
}

function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function fromISO(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function isValidISODate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = fromISO(value);
    return toISO(date) === value;
}

function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        const next = normalized[i + 1];
        if (char === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === "," && !inQuotes) {
            row.push(cell);
            cell = "";
        } else if (char === "\n" && !inQuotes) {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }
    row.push(cell);
    if (row.some(item => item.length)) rows.push(row);
    return rows;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return structuredState({records: {}, settings: {}});
        const parsed = JSON.parse(raw);
        const result = structuredState({
            records: parsed.records && typeof parsed.records === "object" ? parsed.records : {},
            settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}
        }, parsed);
        // 已有旧版本数据默认视为已跳过引导，避免升级时打断原有使用。
        if (!Object.prototype.hasOwnProperty.call(parsed, "onboardingCompleted") && !Object.prototype.hasOwnProperty.call(parsed, "onboardingSkipped") && (Object.keys(result.records).length || Object.keys(result.settings).length)) result.onboardingSkipped = true;
        return result;
    } catch {
        return structuredState({records: {}, settings: {}});
    }
}

function structuredState(base, source = {}) {
    const settings = base.settings || {};
    const workSchedule = {...DEFAULT_USER_DATA.workSchedule, ...(source.workSchedule || {}), restDays: Array.isArray(source.workSchedule?.restDays) ? source.workSchedule.restDays : [0, 6]};
    const legacyHabits = source.habit?.name ? [{id: "habit-legacy", name: source.habit.name, createdAt: source.habit.createdAt}] : [];
    const habits = normalizeHabits(Array.isArray(source.habits) ? source.habits : legacyHabits);
    // 没有 schemaVersion：迁移不靠版本号分支，而是每次加载都无条件跑一遍规范化：
    // 每一个字段都有默认值与旧字段回退（如 source.salary?.monthlySalary ?? settings.salary）。
    // 这比版本号更耐跌——手改过、截断过、或来自更新版本的备份都能吃下。
    const result = {
        records: normalizeRecords(base.records || {}, workSchedule),
        settings,
        profile: {...DEFAULT_USER_DATA.profile, ...(source.profile || {}), name: source.profile?.name ?? settings.applicantName ?? ""},
        workSchedule,
        salary: {
            ...DEFAULT_USER_DATA.salary,
            ...(source.salary || {}),
            monthlySalary: source.salary?.monthlySalary ?? settings.salary ?? 0,
            fixedDeductions: source.salary?.fixedDeductions ?? settings.deduction ?? 0,
            estimatedTax: source.salary?.estimatedTax ?? settings.estimatedTax ?? 0,
            specialDeductions: source.salary?.specialDeductions ?? settings.specialDeductions ?? 0,
            taxMode: source.salary?.taxMode ?? settings.taxMode ?? "simple",
            payday: source.salary?.payday ?? settings.payday ?? null
        },
        quotaRules: {
            ...DEFAULT_USER_DATA.quotaRules,
            ...(source.quotaRules || {}),
            annualExpireRule: source.quotaRules?.annualExpireRule ?? settings.annualExpireRule ?? "next-03-31",
            compExpireRule: source.quotaRules?.compExpireRule ?? settings.compExpireRule ?? "none"
        },
        ticketPreferences: normalizeTicketPreferences(source.ticketPreferences, settings),
        integrations: normalizeIntegrations(source.integrations),
        dashboard: normalizeDashboard(source.dashboard),
        habits,
        habitCheckins: normalizeHabitCheckins(source.habitCheckins, habits),
        onboardingCompleted: Boolean(source.onboardingCompleted),
        onboardingSkipped: Boolean(source.onboardingSkipped),
        productTourSeenVersion: Math.max(0, Number(source.productTourSeenVersion) || 0),
        setupBannerDismissed: Boolean(source.setupBannerDismissed)
    };
    return result;
}

function normalizeDashboard(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const requested = Array.isArray(source.overviewModules) ? source.overviewModules : DEFAULT_OVERVIEW_MODULES;
    const overviewModules = [...new Set(requested)]
        .filter(id => OVERVIEW_MODULE_IDS.includes(id))
        .slice(0, 3);
    return {
        version: 1,
        overviewModules
    };
}

function normalizeIntegrations(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const googleSource = source.googleCalendar && typeof source.googleCalendar === "object" ? source.googleCalendar : {};
    const includeSource = googleSource.include && typeof googleSource.include === "object" ? googleSource.include : {};
    const emailSource = source.email && typeof source.email === "object" ? source.email : {};
    return {
        googleCalendar: {
            autoSync: googleSource.autoSync !== false,
            clientId: typeof googleSource.clientId === "string" ? googleSource.clientId.slice(0, 300) : "",
            include: {
                leave: includeSource.leave !== false,
                overtime: includeSource.overtime !== false,
                work: includeSource.work === true,
                notes: includeSource.notes !== false
            }
        },
        email: {
            defaultRecipient: typeof emailSource.defaultRecipient === "string" ? emailSource.defaultRecipient.slice(0, 320) : ""
        }
    };
}

function normalizeTicketPreferences(value = {}, legacySettings = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const departureRule = source.departureRule ?? legacySettings.ticketDepartureRule;
    const returnRule = source.returnRule ?? legacySettings.ticketReturnRule;
    const reminderTime = source.reminderTime ?? legacySettings.ticketReminderTime;
    const advanceDays = source.advanceDays ?? legacySettings.ticketAdvanceDays;
    return {
        origin: typeof source.origin === "string" ? source.origin.trim().slice(0, 40) : "",
        destination: typeof source.destination === "string" ? source.destination.trim().slice(0, 40) : "",
        flightOrigin: typeof source.flightOrigin === "string" && Object.hasOwn(window.RESTCAL_AIRPORTS || {}, source.flightOrigin.trim()) ? source.flightOrigin.trim() : "",
        flightDestination: typeof source.flightDestination === "string" && Object.hasOwn(window.RESTCAL_AIRPORTS || {}, source.flightDestination.trim()) && source.flightDestination.trim() !== (typeof source.flightOrigin === "string" ? source.flightOrigin.trim() : "") ? source.flightDestination.trim() : "",
        transfers: Array.isArray(source.transfers) ? [...new Set(source.transfers.filter(name => typeof name === "string").map(name => name.trim().slice(0, 40)).filter(name => name && name !== (typeof source.origin === "string" ? source.origin.trim() : "") && name !== (typeof source.destination === "string" ? source.destination.trim() : "") && Object.hasOwn(window.RESTCAL_RAILWAY_STATIONS || {}, name)))] : [],
        departureRule: ["holiday-start", "holiday-eve"].includes(departureRule) ? departureRule : DEFAULT_USER_DATA.ticketPreferences.departureRule,
        returnRule: ["holiday-end", "holiday-next"].includes(returnRule) ? returnRule : DEFAULT_USER_DATA.ticketPreferences.returnRule,
        reminderTime: isValidReminderTime(reminderTime) ? reminderTime : DEFAULT_USER_DATA.ticketPreferences.reminderTime,
        advanceDays: clampInt(advanceDays, 1, 60, DEFAULT_USER_DATA.ticketPreferences.advanceDays)
    };
}

function isValidReminderTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
    return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function normalizeHabits(habits) {
    const normalized = [];
    const ids = new Set();
    for (const value of habits || []) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const name = typeof value.name === "string" ? value.name.trim().slice(0, 40) : "";
        let id = typeof value.id === "string" ? value.id.trim().slice(0, 80) : "";
        if (!name) continue;
        if (!id || ids.has(id)) id = `habit-${Date.now().toString(36)}-${normalized.length}`;
        ids.add(id);
        const icon = HABIT_ICONS.some(item => item.id === value.icon) ? value.icon : "flag";
        normalized.push({id, name, icon, createdAt: typeof value.createdAt === "string" ? value.createdAt : ""});
    }
    return normalized;
}

function normalizeHabitCheckins(checkins, habits = []) {
    const normalized = {};
    habits.forEach(habit => { normalized[habit.id] = {}; });
    const entries = Object.entries(checkins || {});
    const isLegacy = entries.some(([key]) => isValidISODate(key));
    if (isLegacy && habits[0]) {
        entries.forEach(([iso, value]) => {
            if (isValidISODate(iso) && value) normalized[habits[0].id][iso] = typeof value === "string" ? value : new Date().toISOString();
        });
        return normalized;
    }
    const validIds = new Set(habits.map(habit => habit.id));
    for (const [habitId, dates] of entries) {
        if (!validIds.has(habitId) || !dates || typeof dates !== "object" || Array.isArray(dates)) continue;
        for (const [iso, value] of Object.entries(dates)) {
            if (!isValidISODate(iso) || !value) continue;
            normalized[habitId][iso] = typeof value === "string" ? value : new Date().toISOString();
        }
    }
    return normalized;
}

function normalizeRecords(records, workSchedule = DEFAULT_USER_DATA.workSchedule) {
    const normalized = {};
    for (const [iso, value] of Object.entries(records || {})) {
        if (!isValidISODate(iso) || !value || typeof value !== "object" || Array.isArray(value)) continue;
        const record = {...value};
        if (record.status === "overtime") {
            record.overtime = {
                hours: clampNumber(record.overtimeHours, 0.5, 24, 8),
                rate: clampNumber(record.overtimeRate, 0.1, 10, 1),
                reason: typeof record.reason === "string" ? record.reason : "",
                updatedAt: record.updatedAt || ""
            };
            record.status = inferLegacyOvertimeBaseStatus(iso, workSchedule);
            record.leaveType = "";
            record.reason = "";
            delete record.overtimeHours;
            delete record.overtimeRate;
        } else if (record.overtime && typeof record.overtime === "object") {
            record.overtime = {
                hours: clampNumber(record.overtime.hours, 0.5, 24, 2),
                rate: clampNumber(record.overtime.rate, 0.1, 10, 1),
                reason: typeof record.overtime.reason === "string" ? record.overtime.reason : "",
                updatedAt: typeof record.overtime.updatedAt === "string" ? record.overtime.updatedAt : (record.updatedAt || "")
            };
        }
        normalized[iso] = record;
    }
    return normalized;
}

function inferLegacyOvertimeBaseStatus(iso, workSchedule) {
    const date = fromISO(iso);
    const yearData = HOLIDAY_DATA[date.getFullYear()];
    if (yearData?.holidays?.some(item => item.date === iso)) return "";
    if (yearData?.makeupWorkdays?.some(item => item.date === iso)) return "work";
    const restDays = Array.isArray(workSchedule?.restDays) ? workSchedule.restDays : [0, 6];
    return restDays.includes(date.getDay()) ? "" : "work";
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        scheduleGoogleSync();
        return true;
    } catch (error) {
        // 存储被禁用或空间不足时，保留当前会话状态，并明确告知用户。
        showToast("本次修改仅保存在当前会话，无法写入本地存储", "error", {duration: 6000});
        return false;
    }
}
