/* 休历 · RestCal —— WebDAV 配置与同步、备份快照、首次设置向导
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

// ---- WebDav 云备份 ----
// 凭据独立存放在 WEBDAV_KEY，不进 state，因此既不会上传到云端，
// 也不会在「从云端恢复」时被覆盖。
function loadWebDavConfig() {
    try {
        const parsed = JSON.parse(localStorage.getItem(WEBDAV_KEY) || "{}");
        return {
            url: typeof parsed.url === "string" ? parsed.url : "",
            username: typeof parsed.username === "string" ? parsed.username : "",
            password: typeof parsed.password === "string" ? parsed.password : "",
            lastBackupAt: typeof parsed.lastBackupAt === "string" ? parsed.lastBackupAt : "",
            lastVerifiedAt: typeof parsed.lastVerifiedAt === "string" ? parsed.lastVerifiedAt : ""
        };
    } catch {
        return {url: "", username: "", password: "", lastBackupAt: "", lastVerifiedAt: ""};
    }
}

function isWebdavConfigured() {
    return Boolean(webdavConfig.url.trim() && webdavConfig.username && webdavConfig.password);
}

function formatBackupTime(iso) {
    const time = Date.parse(iso || "");
    if (!Number.isFinite(time)) return "";
    const date = new Date(time);
    const sameDay = isSameDate(date, new Date());
    const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return sameDay ? `今天 ${clock}` : `${toISO(date)} ${clock}`;
}

function renderWebdavCard() {
    if (!els.webdavBadge) return;
    const configured = isWebdavConfigured();
    const verified = configured && webdavConfig.lastVerifiedAt;
    els.webdavBadge.textContent = verified ? "已连接" : configured ? "已配置" : "未配置";
    els.webdavBadge.classList.toggle("ok", Boolean(verified));
    els.webdavBadge.classList.toggle("neutral", configured && !verified);
    const backupText = webdavConfig.lastBackupAt
        ? `上次备份：${formatBackupTime(webdavConfig.lastBackupAt)}`
        : "上次备份：暂无";
    els.webdavMeta.textContent = configured ? backupText : "跨设备备份和恢复 RestCal 数据。";
    els.webdavUpload.hidden = !configured;
    els.webdavDownload.hidden = !configured;
    els.webdavConfigure.textContent = configured ? "管理配置" : "配置 WebDAV";
    if (els.toolsWebdavHint) {
        els.toolsWebdavHint.textContent = configured ? backupText : "跨设备备份和恢复数据";
    }
}

function saveWebDavConfig() {
    try {
        localStorage.setItem(WEBDAV_KEY, JSON.stringify(webdavConfig));
    } catch { }
}

function syncWebDavConfigFromInputs() {
    webdavConfig.url = els.webdavUrl.value.trim();
    webdavConfig.username = els.webdavUsername.value.trim();
    webdavConfig.password = els.webdavPassword.value;
    saveWebDavConfig();
}

function isConfiguredWorkday(date, info = getDayInfo(date)) {
    if (info.isHoliday) return false;
    if (info.makeupName) return true;
    const restDays = Array.isArray(state.workSchedule?.restDays) ? state.workSchedule.restDays : [0, 6];
    return !restDays.includes(date.getDay());
}

function openOnboarding(reset = false) {
    if (!window.RestCalOnboardingView) {
        showToast("首次设置模块暂不可用，请刷新后重试", "error");
        return;
    }
    if (reset) onboardingDraft = userDataSnapshot();
    else onboardingDraft = onboardingDraft || userDataSnapshot();
    onboardingStep = 0;
    els.onboardingBackdrop.classList.add("open");
    openBackdrops.add(els.onboardingBackdrop);
    updateScrollLock();
    renderOnboardingStep();
}

function closeOnboarding() {
    els.onboardingBackdrop.classList.remove("open");
    openBackdrops.delete(els.onboardingBackdrop);
    updateScrollLock();
}

function userDataSnapshot() {
    return JSON.parse(JSON.stringify({profile: state.profile, workSchedule: state.workSchedule, salary: state.salary, ticketPreferences: state.ticketPreferences, dashboard: state.dashboard}));
}

function backupUserDataSnapshot() {
    return JSON.parse(JSON.stringify({
        settings: state.settings,
        profile: state.profile,
        workSchedule: state.workSchedule,
        salary: state.salary,
        quotaRules: state.quotaRules,
        ticketPreferences: state.ticketPreferences,
        dashboard: state.dashboard,
        habits: state.habits,
        habitCheckins: state.habitCheckins,
        preferences: {
            theme: getThemePreference(),
            language: window.RestCalI18n?.getLanguage() || "zh"
        },
        onboardingCompleted: state.onboardingCompleted,
        onboardingSkipped: state.onboardingSkipped,
        productTourSeenVersion: state.productTourSeenVersion
    }));
}

function restoreUserDataBackup(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    let restored = false;
    if (data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)) {
        state.settings = {...state.settings, ...data.settings};
        restored = true;
    }
    if (data.profile && typeof data.profile === "object" && !Array.isArray(data.profile)) {
        state.profile = {...DEFAULT_USER_DATA.profile, ...state.profile, ...data.profile};
        restored = true;
    }
    if (data.workSchedule && typeof data.workSchedule === "object" && !Array.isArray(data.workSchedule)) {
        const restDays = Array.isArray(data.workSchedule.restDays) ? data.workSchedule.restDays : state.workSchedule.restDays;
        state.workSchedule = {...DEFAULT_USER_DATA.workSchedule, ...state.workSchedule, ...data.workSchedule, restDays};
        restored = true;
    }
    if (data.salary && typeof data.salary === "object" && !Array.isArray(data.salary)) {
        state.salary = {...DEFAULT_USER_DATA.salary, ...state.salary, ...data.salary};
        restored = true;
    }
    if (data.quotaRules && typeof data.quotaRules === "object" && !Array.isArray(data.quotaRules)) {
        state.quotaRules = {...DEFAULT_USER_DATA.quotaRules, ...state.quotaRules, ...data.quotaRules};
        restored = true;
    } else if (data.settings && typeof data.settings === "object") {
        state.quotaRules = {
            // 2.1.1 及以前的备份把额度规则放在 settings 里，这里保留读取以便恢复旧备份。
            annualExpireRule: data.settings.annualExpireRule || state.quotaRules.annualExpireRule,
            compExpireRule: data.settings.compExpireRule || state.quotaRules.compExpireRule
        };
    }
    if (data.ticketPreferences && typeof data.ticketPreferences === "object" && !Array.isArray(data.ticketPreferences)) {
        state.ticketPreferences = normalizeTicketPreferences(data.ticketPreferences, data.settings || {});
        restored = true;
    } else if (data.settings && typeof data.settings === "object") {
        state.ticketPreferences = normalizeTicketPreferences({}, data.settings);
    }
    if (data.dashboard && typeof data.dashboard === "object" && !Array.isArray(data.dashboard)) {
        state.dashboard = normalizeDashboard(data.dashboard);
        restored = true;
    }
    if (Array.isArray(data.habits) || data.habit?.name) {
        const legacyHabit = data.habit?.name ? [{id: "habit-legacy", name: data.habit.name, createdAt: data.habit.createdAt}] : [];
        state.habits = normalizeHabits(Array.isArray(data.habits) ? data.habits : legacyHabit);
        restored = true;
    }
    if (data.habitCheckins && typeof data.habitCheckins === "object" && !Array.isArray(data.habitCheckins)) {
        state.habitCheckins = {...state.habitCheckins, ...normalizeHabitCheckins(data.habitCheckins, state.habits)};
        restored = true;
    }
    if (data.preferences && typeof data.preferences === "object" && !Array.isArray(data.preferences)) {
        if (THEME_SEQUENCE.includes(data.preferences.theme)) {
            try { localStorage.setItem(THEME_KEY, data.preferences.theme); } catch { }
            applyTheme(data.preferences.theme);
            restored = true;
        }
        if (["zh", "en"].includes(data.preferences.language)) {
            window.RestCalI18n?.setLanguage(data.preferences.language);
            restored = true;
        }
    }
    if (typeof data.onboardingCompleted === "boolean") {
        state.onboardingCompleted = data.onboardingCompleted;
        restored = true;
    }
    if (typeof data.onboardingSkipped === "boolean") {
        state.onboardingSkipped = data.onboardingSkipped;
        restored = true;
    }
    if (Number.isFinite(Number(data.productTourSeenVersion))) {
        state.productTourSeenVersion = Math.max(0, Number(data.productTourSeenVersion));
        restored = true;
    }
    return restored;
}

function renderOnboardingStep() {
    const step = RestCalOnboardingView.steps[onboardingStep];
    const isLastStep = onboardingStep === RestCalOnboardingView.steps.length - 1;
    els.onboardingStepLabel.textContent = `${onboardingStep + 1} / ${RestCalOnboardingView.steps.length}`;
    els.onboardingProgress.style.width = `${((onboardingStep + 1) / RestCalOnboardingView.steps.length) * 100}%`;
    els.onboardingBack.hidden = onboardingStep === 0;
    els.onboardingSkip.hidden = false;
    els.onboardingSkip.textContent = isLastStep ? "稍后再设置" : "暂时跳过";
    els.onboardingNext.textContent = onboardingStep === 0 ? "开始设置" : isLastStep ? "完成并进入 RestCal" : "下一步";
    els.onboardingContent.innerHTML = RestCalOnboardingView.markup(step);
    if (step.kind === "profile") {
        setInputValue("obName", onboardingDraft.profile.name);
        setInputValue("obCompany", onboardingDraft.profile.company);
        setInputValue("obHireDate", onboardingDraft.profile.hireDate);
        enhanceDateInput(document.getElementById("obHireDate"));
    } else if (step.kind === "schedule") {
        setInputValue("obWorkdays", onboardingDraft.workSchedule.workdaysPerWeek);
        setInputValue("obDailyHours", onboardingDraft.workSchedule.dailyWorkHours);
        setInputValue("obScheduleType", onboardingDraft.workSchedule.scheduleType);
        enhanceSelect(document.getElementById("obScheduleType"), "field");
        renderOnboardingRestDays();
    } else if (step.kind === "salary") {
        setInputValue("obSalary", onboardingDraft.salary.monthlySalary || "");
        setInputValue("obDeductions", onboardingDraft.salary.fixedDeductions || "");
        setInputValue("obTax", onboardingDraft.salary.estimatedTax || "");
        setInputValue("obPayday", onboardingDraft.salary.payday || "");
    } else if (step.kind === "tickets") {
        const preferences = normalizeTicketPreferences(onboardingDraft.ticketPreferences);
        setInputValue("obTicketDepartureRule", preferences.departureRule);
        setInputValue("obTicketReturnRule", preferences.returnRule);
        setInputValue("obTicketAdvanceDays", preferences.advanceDays);
        setInputValue("obTicketReminderTime", preferences.reminderTime);
        enhanceSelect(document.getElementById("obTicketDepartureRule"), "field");
        enhanceSelect(document.getElementById("obTicketReturnRule"), "field");
        enhanceSelect(document.getElementById("obTicketReminderTime"), "field");
    } else if (step.kind === "summary") renderOnboardingSummary();
    els.onboardingContent.querySelector("input,select")?.focus({preventScroll: true});
}

function setInputValue(id, value) { const input = document.getElementById(id); if (input) input.value = value ?? ""; }
function syncOnboardingDraft() {
    const value = id => document.getElementById(id)?.value ?? "";
    if (RestCalOnboardingView.steps[onboardingStep].kind === "profile") onboardingDraft.profile = {name: value("obName").trim(), company: value("obCompany").trim(), hireDate: value("obHireDate")};
    if (RestCalOnboardingView.steps[onboardingStep].kind === "schedule") onboardingDraft.workSchedule = {workdaysPerWeek: clampInt(value("obWorkdays"), 1, 7, 5), dailyWorkHours: clampNumber(value("obDailyHours"), 0.5, 24, 8), scheduleType: value("obScheduleType") || "standard", restDays: [...document.querySelectorAll("#obRestDays input:checked")].map(input => Number(input.value))};
    if (RestCalOnboardingView.steps[onboardingStep].kind === "salary") onboardingDraft.salary = {monthlySalary: nonNegativeNumber(value("obSalary")), fixedDeductions: nonNegativeNumber(value("obDeductions")), estimatedTax: nonNegativeNumber(value("obTax")), payday: value("obPayday") ? clampInt(value("obPayday"), 1, 31, 10) : null};
    if (RestCalOnboardingView.steps[onboardingStep].kind === "tickets") onboardingDraft.ticketPreferences = normalizeTicketPreferences({departureRule: value("obTicketDepartureRule"), returnRule: value("obTicketReturnRule"), advanceDays: value("obTicketAdvanceDays"), reminderTime: value("obTicketReminderTime")});
}
function renderOnboardingRestDays() { const host = document.getElementById("obRestDays"); if (!host) return; host.innerHTML = RestCalOnboardingView.restDayOptions(onboardingDraft.workSchedule.restDays); }
function renderOnboardingSummary() { const host = document.getElementById("onboardingSummary"); if (!host) return; const d = onboardingDraft; const ticket = normalizeTicketPreferences(d.ticketPreferences); const departure = ticket.departureRule === "holiday-eve" ? "假期前一天晚上" : "假期首日"; const returnDay = ticket.returnRule === "holiday-next" ? "假期结束后一天" : "假期最后一天"; host.innerHTML = `<div class="onboarding-summary-row"><span>个人</span><strong>${escapeHtml(d.profile.name || "未填写")}</strong></div><div class="onboarding-summary-row"><span>工作制度</span><strong>每周 ${d.workSchedule.workdaysPerWeek} 天 · 每天 ${d.workSchedule.dailyWorkHours} 小时</strong></div><div class="onboarding-summary-row"><span>工资</span><strong>${d.salary.monthlySalary ? formatMoney(d.salary.monthlySalary) + " / 月" : "未填写"}</strong></div><div class="onboarding-summary-row"><span>购票提醒</span><strong>去程：${departure} · 返程：${returnDay} · 提前 ${ticket.advanceDays} 天 · ${ticket.reminderTime}</strong></div>`; }
async function nextOnboardingStep() {
    syncOnboardingDraft();
    if (!validateOnboardingStep()) return;
    if (onboardingStep < RestCalOnboardingView.steps.length - 1) {
        onboardingStep += 1;
        renderOnboardingStep();
        return;
    }
    applyUserData(onboardingDraft);
    state.onboardingCompleted = true;
    state.onboardingSkipped = false;
    saveState();
    closeOnboarding();
    await render();
    showToast("设置已保存，欢迎来到 RestCal");
    if (state.productTourSeenVersion < PRODUCT_TOUR_VERSION) {
        window.setTimeout(openGuide, 260);
    }
}
function validateOnboardingStep() {
    const kind = RestCalOnboardingView.steps[onboardingStep].kind;
    if (kind === "welcome" || kind === "profile" || kind === "summary") return true;
    const checks = kind === "schedule"
        ? [["obWorkdays", 1, 7, "每周工作天数应为 1–7"], ["obDailyHours", 0.5, 24, "每日工作时长应为 0.5–24 小时"]]
        : kind === "tickets"
            ? [["obTicketAdvanceDays", 1, 60, "提前售卖天数应为 1–60"]]
            : [["obSalary", 0, Infinity, "月薪不能为负数"], ["obDeductions", 0, Infinity, "固定扣除不能为负数"], ["obTax", 0, Infinity, "个税预估不能为负数"], ["obPayday", 1, 31, "发薪日应为 1–31"]];
    let valid = true;
    checks.forEach(([id, min, max, message]) => { const input = document.getElementById(id); const raw = input?.value.trim() || ""; const value = Number(raw); const error = document.getElementById(`${id}Error`); const invalid = raw !== "" && (!Number.isFinite(value) || value < min || value > max); if (error) error.textContent = invalid ? message : ""; input?.classList.toggle("invalid", invalid); if (invalid) valid = false; });
    return valid;
}
function skipOnboarding() { state.onboardingSkipped = true; state.onboardingCompleted = false; saveState(); closeOnboarding(); renderSetupBanner(); showToast("已跳过设置，之后可在设置中重新打开"); }
function applyUserData(data) { state.profile = {...DEFAULT_USER_DATA.profile, ...data.profile}; state.workSchedule = {...DEFAULT_USER_DATA.workSchedule, ...data.workSchedule, restDays: Array.isArray(data.workSchedule.restDays) ? data.workSchedule.restDays : [0, 6]}; state.salary = {...DEFAULT_USER_DATA.salary, ...data.salary}; state.ticketPreferences = normalizeTicketPreferences(data.ticketPreferences, data.settings || {}); state.dashboard = normalizeDashboard(data.dashboard); Object.assign(state.settings, {salary: state.salary.monthlySalary, deduction: state.salary.fixedDeductions, estimatedTax: state.salary.estimatedTax, payday: state.salary.payday, applicantName: state.profile.name, ticketDepartureRule: state.ticketPreferences.departureRule, ticketReturnRule: state.ticketPreferences.returnRule, ticketReminderTime: state.ticketPreferences.reminderTime, ticketAdvanceDays: state.ticketPreferences.advanceDays}); fillSettingsInputs(); renderRestDaysPicker(); }
function clampInt(value, min, max, fallback) { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function clampNumber(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function nonNegativeNumber(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function renderRestDaysPicker() { if (els.restDaysPicker && window.RestCalOnboardingView) els.restDaysPicker.innerHTML = RestCalOnboardingView.restDayOptions(state.workSchedule.restDays); }

// 目录地址（确保末尾带 /）；若用户直接填了 .json 文件路径则原样返回。
function webdavBaseUrl() {
    const base = webdavConfig.url.trim();
    if (!base) return "";
    if (/\.json($|\?)/i.test(base)) return base;
    return base.replace(/\/+$/, "") + "/";
}

// 备份文件的完整地址。
function webdavTargetUrl() {
    const base = webdavConfig.url.trim();
    if (!base) return "";
    if (/\.json($|\?)/i.test(base)) return base;
    return base.replace(/\/+$/, "") + "/" + encodeURIComponent(WEBDAV_FILENAME);
}

// 备份文件所在目录（PUT 前用它确保目录存在）。
function webdavParentUrl() {
    const target = webdavTargetUrl();
    const i = target.lastIndexOf("/");
    return i >= 0 ? target.slice(0, i + 1) : target;
}

function webdavAuthHeader() {
    // 先 UTF-8 编码再 base64，兼容含中文/特殊字符的密码。
    return "Basic " + btoa(unescape(encodeURIComponent(`${webdavConfig.username}:${webdavConfig.password}`)));
}

// 桌面版走主进程，Android APK 走原生 OkHttp（支持 PROPFIND、MKCOL 等 WebDAV
// 方法且不受浏览器 CORS 限制），网页/PWA 才走同源服务端代理。
async function webdavRequest(method, {url, headers = {}, body} = {}) {
    const target = url || webdavTargetUrl();
    if (!target) throw new Error("请先填写服务器地址");
    const reqHeaders = {Authorization: webdavAuthHeader(), ...headers};
    const payload = {method, url: target, headers: reqHeaders, body};
    if (window.xiuliDav?.request) {
        return await window.xiuliDav.request(payload);
    }
    const nativeWebDav = window.Capacitor?.Plugins?.WebDav;
    if (document.documentElement.classList.contains("android-shell") && nativeWebDav?.request) {
        try {
            const result = await nativeWebDav.request(payload);
            if (!result || typeof result.status !== "number") {
                throw new Error("原生 WebDAV 响应格式不正确");
            }
            return result;
        } catch (error) {
            const message = error?.message || String(error || "未知网络错误");
            throw new Error(message);
        }
    }
    // 网页/PWA：通过服务端代理转发，绕过 WebDAV 服务器的跨域限制。
    const proxyUrl = WEBDAV_PROXY_URL;
    let res;
    try {
        res = await fetch(proxyUrl, {
            method: "POST",
            headers: {"Content-Type": "application/json", "X-Xiuli-Proxy": "1"},
            body: JSON.stringify(payload)
        });
    } catch {
        throw new Error("无法访问本站的 WebDAV 服务，请稍后重试。");
    }

    let result;
    try {
        result = await res.json();
    } catch {
        if (res.status === 404) {
            throw new Error("本站尚未启用 WebDAV 服务，请确认网站已通过 Netlify 部署且 Functions 部署成功。");
        }
        throw new Error(`WebDAV 代理返回了无法识别的响应（HTTP ${res.status}）。`);
    }
    if (!res.ok) throw new Error(result.error || `WebDAV 代理请求失败（HTTP ${res.status}）`);
    if (!result || typeof result.status !== "number") throw new Error("WebDAV 代理响应格式不正确，请更新 Worker 代码。");
    return result;
}

function webdavErrorText(status) {
    if (status === 401 || status === 403) return "用户名或密码（建议用应用专用密码）不正确";
    if (status === 404) return "地址不存在，请检查服务器地址";
    if (status === 405) return "服务器不支持该操作";
    if (status === 409) return "目标目录不存在，请填写一个已存在的目录";
    if (!status) return "无法连接服务器";
    return `请求失败（${status}）`;
}

// 在友好提示后附上服务器返回的真实状态与内容片段，便于定位问题（坚果云等常在响应体里说明原因）。
function describeWebdavFailure(res) {
    const snippet = (res.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    return `${webdavErrorText(res.status)}（HTTP ${res.status}${snippet ? "：" + snippet : ""}）`;
}

// 按 updatedAt 取较新者合并，避免用较旧的云端记录覆盖本机的新修改。
function mergeRecords(local, remote) {
    const merged = {...local};
    let added = 0;
    let updated = 0;
    for (const iso of Object.keys(remote)) {
        const incoming = remote[iso];
        if (!incoming || typeof incoming !== "object") continue;
        const current = merged[iso];
        if (!current) {
            merged[iso] = incoming;
            added += 1;
            continue;
        }
        const localTime = Date.parse(current.updatedAt) || 0;
        const remoteTime = Date.parse(incoming.updatedAt) || 0;
        if (remoteTime >= localTime) {
            merged[iso] = incoming;
            updated += 1;
        }
    }
    return {merged, added, updated};
}

function setWebdavStatus(text) {
    els.webdavStatus.textContent = text;
    if (els.webdavConfigStatus) els.webdavConfigStatus.textContent = text;
}

function setWebdavBusy(busy) {
    [els.webdavTest, els.webdavUpload, els.webdavDownload].forEach(btn => {
        btn.disabled = busy;
    });
}

function ensureWebdavConfigured() {
    if (!isWebdavConfigured()) {
        setWebdavStatus("请先填写服务器地址、用户名和密码。");
        openWebdavConfigModal();
        return false;
    }
    return true;
}

async function runWebdavTest() {
    if (!ensureWebdavConfigured()) return;
    setWebdavBusy(true);
    setWebdavStatus("正在测试连接…");
    try {
        const res = await webdavRequest("PROPFIND", {
            url: webdavBaseUrl(),
            headers: {Depth: "0", "Content-Type": "application/xml; charset=utf-8"},
            body: '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
        });
        if (res.ok || res.status === 207) {
            webdavConfig.lastVerifiedAt = new Date().toISOString();
            saveWebDavConfig();
            renderWebdavCard();
            setWebdavStatus("连接成功，可以备份。");
            showToast("WebDAV 连接成功");
        } else if (res.status === 404) {
            webdavConfig.lastVerifiedAt = new Date().toISOString();
            saveWebDavConfig();
            renderWebdavCard();
            setWebdavStatus("连接正常，但目标目录还不存在，首次「立即备份」会自动创建。");
        } else {
            setWebdavStatus("连接失败：" + describeWebdavFailure(res));
            showToast("WebDAV 连接失败，请检查配置", "error");
        }
    } catch (error) {
        setWebdavStatus("连接失败：" + error.message);
        showToast("WebDAV 连接失败，请检查配置", "error");
    } finally {
        setWebdavBusy(false);
    }
}

async function runWebdavUpload() {
    if (!ensureWebdavConfigured()) return;
    syncSettingsFromInputs();
    saveState();
    setWebdavBusy(true);
    setWebdavStatus("正在上传备份…");
    const markBackupDone = () => {
        const now = new Date().toISOString();
        webdavConfig.lastBackupAt = now;
        webdavConfig.lastVerifiedAt = now;
        saveWebDavConfig();
        renderWebdavCard();
        renderHomeAlerts();
    };
    try {
        const payload = JSON.stringify({
            app: "xiuli",
            version: 4,
            exportedAt: new Date().toISOString(),
            records: state.records,
            ...backupUserDataSnapshot()
        });
        const res = await webdavRequest("PUT", {
            headers: {"Content-Type": "application/json; charset=utf-8"},
            body: payload
        });
        if (res.ok) {
            const count = Object.keys(state.records).length;
            markBackupDone();
            setWebdavStatus(`上传成功：已备份 ${count} 条记录和全部用户设置（${new Date().toLocaleString()}）。`);
            showToast("云端备份成功");
        } else if (res.status === 404 || res.status === 409) {
            // 多数情况是目标目录不存在：先尝试创建目录，再重试一次 PUT。
            await webdavRequest("MKCOL", {url: webdavParentUrl()}).catch(() => {});
            const retry = await webdavRequest("PUT", {
                headers: {"Content-Type": "application/json; charset=utf-8"},
                body: payload
            });
            if (retry.ok) {
                const count = Object.keys(state.records).length;
                markBackupDone();
                setWebdavStatus(`上传成功：已备份 ${count} 条记录和全部用户设置（${new Date().toLocaleString()}）。`);
                showToast("云端备份成功");
            } else {
                setWebdavStatus("上传失败：" + describeWebdavFailure(retry));
                showToast("云端备份失败，请查看状态说明", "error");
            }
        } else {
            setWebdavStatus("上传失败：" + describeWebdavFailure(res));
            showToast("云端备份失败，请查看状态说明", "error");
        }
    } catch (error) {
        setWebdavStatus("上传失败：" + error.message);
        showToast("云端备份失败，请查看状态说明", "error");
    } finally {
        setWebdavBusy(false);
    }
}

async function runWebdavDownload() {
    if (!ensureWebdavConfigured()) return;
    const ok = await showConfirm({
        title: "从云端恢复数据？",
        message: "云端记录将与本机记录合并，同一天以较新的修改为准，不会删除本机已有记录。",
        confirmText: "开始恢复"
    });
    if (!ok) return;
    setWebdavBusy(true);
    setWebdavStatus("正在从云端恢复…");
    try {
        const res = await webdavRequest("GET", {headers: {"Cache-Control": "no-cache"}});
        if (res.status === 404) {
            setWebdavStatus("云端还没有备份文件，请先点「立即备份」。");
            return;
        }
        if (!res.ok) {
            setWebdavStatus("恢复失败：" + describeWebdavFailure(res));
            showToast("云端恢复失败，请查看状态说明", "error");
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(res.body);
        } catch {
            setWebdavStatus("恢复失败：云端文件格式无法识别。");
            showToast("云端恢复失败，文件格式无法识别", "error");
            return;
        }
        const remoteRecords = parsed && typeof parsed.records === "object" && parsed.records ? parsed.records : null;
        if (!remoteRecords) {
            setWebdavStatus("恢复失败：云端文件缺少记录数据。");
            showToast("云端恢复失败，文件缺少记录数据", "error");
            return;
        }
        const normalizedRemoteRecords = normalizeRecords(remoteRecords, parsed.workSchedule || state.workSchedule);
        const {merged, added, updated} = mergeRecords(state.records, normalizedRemoteRecords);
        state.records = merged;
        const restoredUserData = restoreUserDataBackup(parsed.userData || parsed);
        webdavConfig.lastVerifiedAt = new Date().toISOString();
        saveWebDavConfig();
        saveState();
        fillSettingsInputs();
        await render();
        setWebdavStatus(`恢复成功：新增 ${added} 条，更新 ${updated} 条${restoredUserData ? "，用户设置已恢复" : ""}。`);
        showToast("云端数据恢复成功");
    } catch (error) {
        setWebdavStatus("恢复失败：" + error.message);
        showToast("云端恢复失败，请查看状态说明", "error");
    } finally {
        setWebdavBusy(false);
    }
}
