/* 休历 · RestCal —— 渲染入口、习惯打卡、月/周/日/年视图与每日一言
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

async function render() {
    const version = ++renderVersion;
    els.yearSelect.value = String(currentYear);
    els.monthSelect.value = String(currentMonth);
    syncEnhancedSelects();
    updateCalendarSource();
    if (!isCalendarDataReady()) {
        renderCalendarLoading("正在获取节假日、调休和农历数据...");
        await ensureCalendarDataForView();
        if (version !== renderVersion) return;
    }
    if (!calendarApi.years.has(currentYear)) {
        renderCalendarUnavailable(currentYear);
        renderHomeExtras();
        updateCalendarSource();
        return;
    }
    renderCalendarView();
    renderCalendarFooter();
    renderStats();
    renderSalary();
    updateSalaryReceiptButton();
    renderTicketReminders();
    renderHomeExtras();
    updateCalendarSource();
}

function renderHomeExtras() {
    renderSetupBanner();
    renderGuideEntry();
    renderHabitToolHint();
    renderHomeAlerts();
    renderRecentRecords();
    renderDataStatus();
    renderWebdavCard();
}

function isHabitChecked(habitId, iso) {
    return Boolean(state.habitCheckins?.[habitId]?.[iso]);
}

function checkedHabitsForDate(iso) {
    return state.habits.filter(habit => isHabitChecked(habit.id, iso));
}

function habitCheckinCountForDate(iso) {
    return checkedHabitsForDate(iso).length;
}

function habitMonthCount(habitId, year = currentYear, month = currentMonth) {
    const prefix = `${year}-${String(month).padStart(2, "0")}-`;
    return Object.keys(state.habitCheckins?.[habitId] || {}).filter(iso => iso.startsWith(prefix)).length;
}

function habitStreak(habitId, reference = today) {
    let cursor = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    if (!isHabitChecked(habitId, toISO(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (count < 3660 && isHabitChecked(habitId, toISO(cursor))) {
        count += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return count;
}

function renderHabitToolHint() {
    const count = state.habits.length;
    els.habitToolHint.textContent = count ? `${count} 个习惯 · 今日 ${habitCheckinCountForDate(toISO(today))}/${count}` : "新建习惯，记录每日完成";
}

function habitIconDefinition(iconId) {
    return HABIT_ICONS.find(icon => icon.id === iconId) || HABIT_ICONS[0];
}

function renderHabitIconMenu() {
    els.habitIconMenu.innerHTML = HABIT_ICONS.map(icon => `<button class="habit-icon-option" type="button" role="option" data-habit-icon="${icon.id}" aria-label="${icon.label}" aria-selected="${icon.id === selectedHabitIcon}"><i class="ph ph-${icon.icon} icon" aria-hidden="true"></i></button>`).join("");
}

function toggleHabitIconMenu() {
    if (!els.habitIconMenu.hidden) return closeHabitIconMenu();
    renderHabitIconMenu();
    els.habitIconMenu.hidden = false;
    els.habitIconToggle.setAttribute("aria-expanded", "true");
    window.RestCalI18n?.apply?.(els.habitIconMenu);
    window.setTimeout(() => els.habitIconMenu.querySelector('[aria-selected="true"]')?.focus({preventScroll: true}), 0);
}

function closeHabitIconMenu(returnFocus = false) {
    els.habitIconMenu.hidden = true;
    els.habitIconToggle.setAttribute("aria-expanded", "false");
    if (returnFocus) els.habitIconToggle.focus({preventScroll: true});
}

function selectHabitIcon(iconId) {
    const icon = habitIconDefinition(iconId);
    selectedHabitIcon = icon.id;
    els.habitIconPreview.className = `ph ph-${icon.icon} icon`;
    closeHabitIconMenu();
    els.habitNameCreate.focus({preventScroll: true});
}

function renderHabitTool() {
    renderHabitToolHint();
    const todayIso = toISO(today);
    const monthYear = today.getFullYear();
    const month = today.getMonth() + 1;
    const todayDone = habitCheckinCountForDate(todayIso);
    const totalMonthDone = state.habits.reduce((sum, habit) => sum + habitMonthCount(habit.id, monthYear, month), 0);
    const elapsedDays = today.getDate();
    const rate = state.habits.length ? Math.round(totalMonthDone / (state.habits.length * elapsedDays) * 100) : 0;
    document.getElementById("habitTodaySummary").textContent = `${todayDone} / ${state.habits.length}`;
    document.getElementById("habitStreakSummary").textContent = String(Math.max(0, ...state.habits.map(habit => habitStreak(habit.id))));
    document.getElementById("habitRateSummary").textContent = `${Math.min(100, rate)}%`;
    document.getElementById("habitCountLabel").textContent = `(${state.habits.length})`;
    if (!state.habits.length) {
        els.habitList.innerHTML = `<div class="habit-empty">暂无习惯，输入名称后新建</div>`;
        return;
    }
    els.habitList.innerHTML = state.habits.map(habit => {
        const done = isHabitChecked(habit.id, todayIso);
        const icon = habitIconDefinition(habit.icon);
        const dots = Array.from({length: 7}, (_, offset) => {
            const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + offset);
            return `<i class="${isHabitChecked(habit.id, toISO(date)) ? "is-done" : ""}"></i>`;
        }).join("");
        return `<div class="habit-item">
            <span class="habit-item-icon" aria-hidden="true"><i class="ph ph-${icon.icon} icon"></i></span>
            <span class="habit-item-copy"><strong>${escapeHtml(habit.name)}</strong><span class="habit-item-meta"><span class="habit-week-dots" aria-hidden="true">${dots}</span><span>本月 ${habitMonthCount(habit.id, monthYear, month)} 次 · 连续 ${habitStreak(habit.id)} 天</span></span></span>
            <button class="btn habit-today-btn${done ? " is-done" : ""}" type="button" data-habit-today="${escapeHtml(habit.id)}" aria-pressed="${done}">${done ? '<i class="ph ph-check icon" aria-hidden="true"></i> 已打卡' : "今日打卡"}</button>
            <button class="btn ghost habit-delete-btn" type="button" data-habit-delete="${escapeHtml(habit.id)}" aria-label="删除习惯 ${escapeHtml(habit.name)}" title="删除习惯"><i class="ph ph-dots-three icon" aria-hidden="true"></i></button>
        </div>`;
    }).join("");
    window.RestCalI18n?.apply?.(els.habitList);
}

function openHabitTool(trigger = els.habitToolToggle) {
    closeHabitIconMenu();
    renderHabitTool();
    openBackdrop(els.habitToolPanel);
    modalReturnFocus.set(els.habitToolPanel, trigger);
    (state.habits.length ? document.getElementById("closeHabitTool") : els.habitNameCreate).focus({preventScroll: true});
}

function createHabit(event) {
    event.preventDefault();
    const name = els.habitNameCreate.value.trim().slice(0, 40);
    if (!name) return els.habitNameCreate.focus();
    if (state.habits.some(habit => habit.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        showToast("这个习惯已经存在");
        return;
    }
    const id = globalThis.crypto?.randomUUID?.() || `habit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    state.habits.push({id, name, icon: selectedHabitIcon, createdAt: new Date().toISOString()});
    state.habitCheckins[id] = {};
    if (!saveState()) return;
    els.habitNameCreate.value = "";
    selectHabitIcon("flag");
    renderHabitTool();
    renderCalendarView();
}

async function handleHabitListClick(event) {
    const todayButton = event.target.closest("[data-habit-today]");
    if (todayButton) {
        const habitId = todayButton.dataset.habitToday;
        const iso = toISO(today);
        state.habitCheckins[habitId] ||= {};
        if (isHabitChecked(habitId, iso)) delete state.habitCheckins[habitId][iso];
        else state.habitCheckins[habitId][iso] = new Date().toISOString();
        if (!saveState()) return;
        renderHabitTool();
        renderCalendarView();
        return;
    }
    const deleteButton = event.target.closest("[data-habit-delete]");
    if (!deleteButton) return;
    const habit = state.habits.find(item => item.id === deleteButton.dataset.habitDelete);
    if (!habit) return;
    const ok = await showConfirm({title: "删除习惯？", message: `“${habit.name}”及其全部打卡记录都会被删除。`, confirmText: "删除", danger: true});
    if (!ok) return;
    state.habits = state.habits.filter(item => item.id !== habit.id);
    delete state.habitCheckins[habit.id];
    if (!saveState()) return;
    renderHabitTool();
    renderCalendarView();
}

function updateSalaryReceiptButton() {
    els.salaryReceiptLabel.textContent = "工资核算与工资条";
}

function settleDayPageTransition() {
    window.clearTimeout(dayPageTransitionTimer);
    dayPageTransitionTimer = 0;
    const pages = [...els.calendarGrid.querySelectorAll(".day-page")];
    const current = pages.at(-1) || null;
    pages.slice(0, -1).forEach(page => page.remove());
    current?.classList.remove(
        "is-page-entering",
        "is-page-leaving",
        "page-enter-forward",
        "page-enter-backward",
        "page-leave-forward",
        "page-leave-backward"
    );
    current?.style.removeProperty("animation");
    current?.removeAttribute("aria-hidden");
    els.calendarGrid.classList.remove("day-page-turning", "turn-forward", "turn-backward");
    return current;
}

function renderCalendarView() {
    hideNoteTooltip();
    if (calendarMode !== "day") settleDayPageTransition();
    const panel = document.querySelector(".calendar-panel");
    if (panel) {
        CAL_MODES.forEach(mode => panel.classList.toggle(`mode-${mode}`, mode === calendarMode));
    }
    els.calendarGrid.classList.toggle("week-mode", calendarMode === "week");
    els.calendarGrid.classList.toggle("day-mode", calendarMode === "day");
    els.calendarGrid.classList.toggle("year-mode", calendarMode === "year");
    if (calendarMode === "week") renderWeek();
    else if (calendarMode === "day") renderDay();
    else if (calendarMode === "year") renderYear();
    else renderCalendar();
}

// 单行副标签（月/周视图共用）。优先级：记录状态 > 补班 > 节假日 > 节气；
// 都未命中返回 null（月视图回退农历，周视图留空）。节假日只有连休首日
// 显示假名，后续日子显示节气或“休”——“休”不能进 i18n 词典（会误翻
// 品牌 logo 等同字文本节点），用 rest 标记走 CSS 伪元素按 :lang 输出。
function daySubInfo(date, info, record) {
    if (record?.status) {
        return record.status === "work"
            ? {text: record.overtime ? `加 ${record.overtime.hours}h` : "✓", kind: record.overtime ? "overtime" : "work"}
            : {text: STATUS_LABELS[record.status] || record.status, kind: record.status};
    }
    if (record?.overtime) return {text: `加 ${record.overtime.hours}h`, kind: "overtime"};
    if (info.makeupName) return {text: "班", kind: "makeup"};
    const solarTerm = getSolarTermText(date);
    if (info.isHoliday) {
        const prev = new Date(date);
        prev.setDate(prev.getDate() - 1);
        const prevInfo = getDayInfo(prev);
        const firstOfRun = !prevInfo.isHoliday || prevInfo.holidayName !== info.holidayName;
        const text = (firstOfRun && info.holidayName) || solarTerm || "";
        return {text, kind: "holiday", rest: !text};
    }
    if (solarTerm) return {text: solarTerm, kind: "term"};
    return null;
}

function daySubHtml(sub) {
    if (!sub) return `<span class="day-sub"></span>`;
    const content = sub.kind === "work" && sub.text === "✓"
        ? '<i class="ph ph-check icon" aria-hidden="true"></i>'
        : escapeHtml(sub.text);
    return `<span class="day-sub kind-${sub.kind}${sub.rest ? " rest-day" : ""}">${content}</span>`;
}

function showNoteTooltip(card) {
    const note = card?.dataset.note?.trim();
    if (!note || !els.noteTooltip) return;
    noteTooltipTarget = card;
    els.noteTooltip.textContent = note;
    els.noteTooltip.hidden = false;
    els.noteTooltip.classList.remove("visible");
    window.requestAnimationFrame(() => {
        if (noteTooltipTarget !== card) return;
        const markerRect = (card.querySelector(".note-marker") || card).getBoundingClientRect();
        const tooltipRect = els.noteTooltip.getBoundingClientRect();
        const edge = 10;
        let left = markerRect.right - tooltipRect.width;
        left = Math.max(edge, Math.min(left, window.innerWidth - tooltipRect.width - edge));
        let top = markerRect.top - tooltipRect.height - 10;
        let side = "top";
        if (top < edge) {
            top = markerRect.bottom + 10;
            side = "bottom";
        }
        if (top + tooltipRect.height > window.innerHeight - edge) {
            top = Math.max(edge, window.innerHeight - tooltipRect.height - edge);
        }
        els.noteTooltip.style.left = `${Math.round(left)}px`;
        els.noteTooltip.style.top = `${Math.round(top)}px`;
        els.noteTooltip.dataset.side = side;
        els.noteTooltip.classList.add("visible");
    });
}

function hideNoteTooltip(card) {
    if (card && noteTooltipTarget !== card) return;
    noteTooltipTarget = null;
    if (!els.noteTooltip) return;
    els.noteTooltip.classList.remove("visible");
    els.noteTooltip.hidden = true;
    els.noteTooltip.textContent = "";
}

function createDayCard(date, {outside = false, index = 0} = {}) {
    const iso = toISO(date);
    const info = getDayInfo(date);
    const record = state.records[iso];
    const card = document.createElement("button");
    card.style.setProperty("--i", index);
    card.className = [
        "day-card",
        outside ? "outside" : "",
        isSameDate(date, today) ? "today" : "",
        info.isHoliday ? "is-holiday" : "",
        info.isWeekend ? "is-weekend" : "",
        iso === selectedDate ? "selected" : "",
        record?.status ? `status-${record.status}` : "",
        record?.overtime ? "has-overtime" : "",
        record?.note ? "has-note" : "",
        habitCheckinCountForDate(iso) ? "habit-done" : "",
        "clickable"
    ].filter(Boolean).join(" ");
    card.dataset.date = iso;
    if (record?.note) card.dataset.note = record.note;
    card.type = "button";
    card.setAttribute("aria-label", dayAriaLabel(date, info, record));

    // 手机端月视图的出勤状态由日期格底色表达，保留农历文字，避免连续“✓”形成视觉噪音；
    // 桌面端日期格没有整格底色，仍需要“✓”标记出勤。
    const fallbackSub = {text: getLunarText(date), kind: "lunar"};
    const sub = isCompactMonthView() && record?.status === "work" && !record.overtime
        ? fallbackSub
        : daySubInfo(date, info, record) || fallbackSub;
    card.innerHTML = `
  <span class="solar">${date.getDate()}</span>
  ${daySubHtml(sub)}
  ${record?.note ? `<span class="note-marker" aria-hidden="true"><i class="ph ph-note icon"></i></span>` : ""}
  ${habitCheckinCountForDate(iso) ? `<span class="habit-marker" aria-hidden="true">${habitCheckinCountForDate(iso) > 1 ? habitCheckinCountForDate(iso) : '<i class="ph ph-check icon"></i>'}</span>` : ""}
`;
    return card;
}

function renderCalendar() {
    const days = getCalendarDays(currentYear, currentMonth);
    const fragment = document.createDocumentFragment();
    const calendarKey = `month-${currentYear}-${currentMonth}`;
    els.calendarGrid.classList.toggle("animate", calendarKey !== lastCalendarKey);
    lastCalendarKey = calendarKey;

    days.forEach((date, index) => {
        const inMonth = date.getFullYear() === currentYear && date.getMonth() + 1 === currentMonth;
        fragment.appendChild(createDayCard(date, {outside: !inMonth, index}));
    });
    els.calendarGrid.replaceChildren(fragment);
}

function renderWeek() {
    const start = new Date(anchorDate);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7); // 周一为一周起点
    const calendarKey = `week-${toISO(start)}`;
    els.calendarGrid.classList.toggle("animate", calendarKey !== lastCalendarKey);
    lastCalendarKey = calendarKey;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 7; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const iso = toISO(date);
        const info = getDayInfo(date);
        const record = state.records[iso];

        const row = document.createElement("button");
        row.type = "button";
        row.style.setProperty("--i", i);
        row.className = [
            "week-row",
            isSameDate(date, today) ? "today" : "",
            info.isWeekend ? "is-weekend" : "",
            info.isHoliday ? "is-holiday" : "",
            iso === selectedDate ? "selected" : "",
            record?.status ? `status-${record.status}` : "",
            record?.overtime ? "has-overtime" : "",
            record?.note ? "has-note" : "",
            habitCheckinCountForDate(iso) ? "habit-done" : "",
            "clickable"
        ].filter(Boolean).join(" ");
        row.dataset.date = iso;
        if (record?.note) row.dataset.note = record.note;
        row.setAttribute("aria-label", dayAriaLabel(date, info, record));

        const detail = [record?.reason, record?.overtime?.reason, record?.overtime ? `加班 ${record.overtime.hours} 小时` : ""].filter(Boolean).join(" · ");
        const isEmpty = !detail && !record?.note && !record?.status && !record?.overtime && !info.isHoliday && !info.isWeekend && !info.makeupName;
        const detailHtml = [
            detail ? `<span class="week-meta">${escapeHtml(detail)}</span>` : "",
            record?.note ? `<span class="week-note"><span>${escapeHtml(record.note)}</span></span>` : "",
            isEmpty ? `<em>未标记</em>` : ""
        ].filter(Boolean).join("");
        row.innerHTML = `
  <span class="week-lunar">${getLunarText(date)}</span>
  <strong class="solar">${date.getDate()}</strong>
  ${daySubHtml(daySubInfo(date, info, record))}
  <span class="week-detail">${detailHtml}</span>
  <span class="week-dow">${weekdayName(date)}</span>
  ${habitCheckinCountForDate(iso) ? `<span class="habit-marker" aria-hidden="true">${habitCheckinCountForDate(iso) > 1 ? habitCheckinCountForDate(iso) : '<i class="ph ph-check icon"></i>'}</span>` : ""}
`;
        fragment.appendChild(row);
    }
    els.calendarGrid.replaceChildren(fragment);
}

function getLanguage() {
    return window.RestCalI18n?.getLanguage() || "zh";
}

function getFallbackQuotes() {
    return getLanguage() === "en" ? FALLBACK_QUOTES_EN : FALLBACK_QUOTES_ZH;
}

function loadQuoteCache() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUOTE_CACHE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function saveQuoteCache(cache) {
    try {
        const keys = Object.keys(cache).sort();
        while (keys.length > QUOTE_CACHE_LIMIT) delete cache[keys.shift()];
        localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(cache));
    } catch {
        // 存储不可用时每日一言仅在当前会话生效
    }
}

function getCachedQuote(iso) {
    const entry = loadQuoteCache()[iso];
    return entry && entry.content ? entry : null;
}

function fallbackQuote(iso) {
    let hash = 0;
    for (const ch of iso) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const quotes = getFallbackQuotes();
    return quotes[hash % quotes.length];
}

async function fetchQuoteRaw(url, signal) {
    const res = await fetch(url, {signal});
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const quote = Array.isArray(data) ? data[0] : data;
    // 一言返回 {hitokoto, from_who, from}，Quotable 返回 {content, author}
    if (quote?.hitokoto) {
        const who = String(quote.from_who || "").trim();
        const work = String(quote.from || "").trim();
        const author = who && work && who !== work ? `${who}《${work}》`
            : who || (work ? `《${work}》` : "佚名");
        return {content: String(quote.hitokoto), author};
    }
    if (!quote?.content) throw new Error("empty");
    return {content: String(quote.content), author: String(quote.author || "Unknown")};
}

async function requestQuote(iso) {
    if (getCachedQuote(iso) || quoteInflight.has(iso)) return;
    const language = getLanguage();
    quoteInflight.add(iso);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    // 优先走本站 /__quote 代理（本地 server.js 与 Netlify Function 均已实现）。
    // 代理不可用时降级直连：中文源一言证书正常，可随时直连；英文源
    // api.quotable.io 的 HTTPS 证书长期过期，仅非 https 页面（本地调试、
    // 桌面版）可直连明文 HTTP。全部失败则保留本地名句。
    const sources = [`/__quote?lang=${language}`];
    if (language === "zh") {
        // 时间戳参数绕过一言的 Cloudflare 边缘缓存（相同 URL 短时间内返回同一条）
        sources.push(`${HITOKOTO_URL}&_=${Date.now()}`);
    } else if (location.protocol !== "https:") {
        sources.push("http://api.quotable.io/quotes/random?maxLength=120");
    }
    try {
        let entry = null;
        for (const source of sources) {
            try {
                entry = await fetchQuoteRaw(source, controller.signal);
                break;
            } catch {
                // 尝试下一个来源
            }
        }
        if (!entry) return;
        const cache = loadQuoteCache();
        cache[iso] = entry;
        saveQuoteCache(cache);
        // 仍停留在这一天的日视图时，原地替换格言
        if (calendarMode === "day" && toISO(anchorDate) === iso) {
            const quoteEl = els.calendarGrid.querySelector(".day-page:not(.is-page-leaving) .page-quote");
            if (quoteEl) {
                quoteEl.querySelector(".page-quote-text").textContent = entry.content;
                quoteEl.querySelector(".page-quote-author").textContent = entry.author;
            }
        }
    } finally {
        window.clearTimeout(timer);
        quoteInflight.delete(iso);
    }
}

function refreshQuoteForLanguageChange() {
    // 语言切换时刷新当前日期的格言
    if (calendarMode === "day") {
        const iso = toISO(anchorDate);
        // 清除缓存以便重新获取
        const cache = loadQuoteCache();
        delete cache[iso];
        saveQuoteCache(cache);
        // 清空进行中的请求标记
        quoteInflight.delete(iso);
        // 重新渲染日视图，会触发 requestQuote
        renderDay();
    }
}

function renderDay() {
    els.calendarGrid.classList.remove("animate");
    lastCalendarKey = `day-${toISO(anchorDate)}`;
    const previousPage = settleDayPageTransition();
    const date = new Date(anchorDate);
    const iso = toISO(date);
    const info = getDayInfo(date);
    const record = state.records[iso];
    const solarTerm = getSolarTermText(date);
    const traditionalFestival = getTraditionalFestival(date) || (solarTerm === "清明" ? "清明节" : "");
    const isToday = isSameDate(date, today);
    const festivalLabels = [traditionalFestival, info.holidayName, solarTerm].filter(Boolean);
    const festival = festivalLabels
        .filter((name, index) => festivalLabels.findIndex(item => item.replace(/节$/, "") === name.replace(/节$/, "")) === index)
        .join(" · ");

    const statusTags = [];
    if (record?.status) statusTags.push(tag(STATUS_LABELS[record.status], `${record.status} primary-state`));
    if (record?.overtime) statusTags.push(tag(`加班 ${record.overtime.hours} 小时`, "overtime"));
    const checkedHabits = checkedHabitsForDate(iso);
    if (checkedHabits.length) statusTags.push(tag(`习惯 · ${checkedHabits.map(habit => habit.name).join("、")}`, "habit"));
    if (info.makeupName) statusTags.push(tag("调休上班", "makeup primary-state"));

    const emptyText = traditionalFestival ? holidayGreeting(traditionalFestival)
        : info.isHoliday ? holidayGreeting(info.holidayName)
        : info.makeupName ? ""
            : info.isWeekend ? "周末 · 无需打卡"
                : "今天还没有记录";
    const quote = getCachedQuote(iso) || fallbackQuote(iso);

    const card = document.createElement("button");
    card.type = "button";
    card.className = [
        "day-page",
        "clickable",
        isToday ? "today" : "",
        info.isHoliday || info.isWeekend || traditionalFestival ? "is-red" : "",
        record?.status ? `status-${record.status}` : "",
        record?.overtime ? "has-overtime" : ""
    ].filter(Boolean).join(" ");
    card.dataset.date = iso;
    card.setAttribute("aria-label", dayAriaLabel(date, info, record));
    card.innerHTML = `
  <div class="page-band">
    <span>${currentYear}年${currentMonth}月</span>
    <span>${weekdayName(date)}${isToday ? " · 今天" : ""}</span>
  </div>
  <div class="page-number">${date.getDate()}</div>
  <div class="page-lunar">${getLunarText(date)}</div>
  ${festival ? `<div class="page-festival">${escapeHtml(festival)}</div>` : ""}
  <div class="page-divider" aria-hidden="true"><img src="assets/icons/icon-192.png" alt=""></div>
  <div class="page-status">
    ${statusTags.length ? `<div class="tags">${statusTags.join("")}</div>` : ""}
    ${record?.reason ? `<div class="page-reason">${escapeHtml(record.reason)}</div>` : ""}
    ${record?.note ? `<div class="page-note"><p>${escapeHtml(record.note)}</p></div>` : ""}
    ${!record?.status && !record?.overtime && emptyText ? `<div class="page-empty">${emptyText}</div>` : ""}
  </div>
  <figure class="page-quote">
    <blockquote class="page-quote-text">${escapeHtml(quote.content)}</blockquote>
    <figcaption class="page-quote-author">${escapeHtml(quote.author)}</figcaption>
  </figure>
  <div class="page-hint">点击编辑当天记录</div>
  <span class="page-curl" aria-hidden="true"></span>
`;
    const previousIso = previousPage?.dataset.date || "";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!previousPage || previousIso === iso || reduceMotion) {
        els.calendarGrid.replaceChildren(card);
    } else {
        const direction = iso > previousIso ? "forward" : "backward";
        const animatedPage = direction === "forward" ? previousPage : card;
        const finishTransition = () => {
            if (!card.isConnected) return;
            window.clearTimeout(dayPageTransitionTimer);
            dayPageTransitionTimer = 0;
            animatedPage.removeEventListener("animationend", handleAnimationEnd);
            previousPage.remove();
            card.classList.remove("is-page-entering", `page-enter-${direction}`);
            // 移除翻页类后会重新命中 .day-page 的默认入场动画；用内联 none
            // 保持当前页静止，下次切换时 settleDayPageTransition 会将其清除。
            card.style.animation = "none";
            els.calendarGrid.classList.remove("day-page-turning", `turn-${direction}`);
        };
        const handleAnimationEnd = event => {
            // .page-curl 也有 animationend 且会冒泡，只响应纸张本体。
            if (event.target !== animatedPage) return;
            finishTransition();
        };

        els.calendarGrid.classList.add("day-page-turning", `turn-${direction}`);
        previousPage.classList.add("is-page-leaving", `page-leave-${direction}`);
        previousPage.setAttribute("aria-hidden", "true");
        previousPage.tabIndex = -1;
        card.classList.add("is-page-entering", `page-enter-${direction}`);
        els.calendarGrid.appendChild(card);

        animatedPage.addEventListener("animationend", handleAnimationEnd);
        dayPageTransitionTimer = window.setTimeout(finishTransition, 650);
    }
    requestQuote(iso);
}

function holidayGreeting(name = "") {
    const holiday = String(name).toLowerCase();
    const greetings = [
        [["元旦", "new year's day"], "元旦 · 新岁启封，万事顺意"],
        [["春节", "spring festival"], "春节 · 阖家团圆，新春安康"],
        [["元宵", "上元", "lantern festival"], "元宵 · 灯火可亲，喜乐团圆"],
        [["龙抬头", "春龙", "dragon heads-raising"], "龙抬头 · 春回大地，鸿运当头"],
        [["上巳", "shangsi"], "上巳 · 春日踏青，祓禊纳福"],
        [["寒食", "hanshi", "cold food festival"], "寒食 · 春风寄思，清明在心"],
        [["清明", "tomb-sweeping", "qingming"], "清明 · 慎终追远，踏青惜春"],
        [["劳动", "labour day", "labor day"], "劳动节 · 致敬奋斗，也别忘了休息"],
        [["端午", "dragon boat"], "端午 · 粽香安康，顺遂如意"],
        [["七夕", "乞巧", "qixi"], "七夕 · 星河为证，所愿皆成"],
        [["中元", "鬼节", "ghost festival"], "中元 · 缅怀先人，心怀敬意"],
        [["中秋", "mid-autumn"], "中秋 · 月满人团圆，心安即归处"],
        [["重阳", "double ninth"], "重阳 · 登高望远，敬老安康"],
        [["寒衣", "十月朝", "winter clothing festival"], "寒衣 · 遥寄思念，愿岁寒有暖"],
        [["下元", "xiayuan"], "下元 · 消灾解厄，平安顺遂"],
        [["腊八", "laba"], "腊八 · 粥暖岁寒，静候新春"],
        [["小年", "送灶", "little new year"], "小年 · 辞旧迎新，人间小团圆"],
        [["除夕", "new year's eve"], "除夕 · 辞旧迎新，阖家守岁"],
        [["国庆", "national day"], "国庆 · 山河锦绣，假日愉快"],
        [["抗日战争", "反法西斯", "victory day"], "胜利纪念日 · 铭记历史，珍爱和平"]
    ];
    return greetings.find(([aliases]) => aliases.some(alias => holiday.includes(alias)))?.[1]
        || "假日 · 愿你自在从容，平安喜乐";
}

function renderYear() {
    els.calendarGrid.classList.remove("animate");
    lastCalendarKey = `year-${currentYear}`;
    const fragment = document.createDocumentFragment();
    for (let month = 1; month <= 12; month++) {
        const mini = document.createElement("button");
        mini.type = "button";
        mini.className = `mini-month${month === currentMonth ? " current" : ""}`;
        mini.dataset.jumpMonth = String(month);
        mini.setAttribute("aria-label", `${currentYear}年${month}月`);
        const cells = [];
        const lead = (new Date(currentYear, month - 1, 1).getDay() + 6) % 7;
        const daysInMonth = new Date(currentYear, month, 0).getDate();
        for (let i = 0; i < lead; i++) cells.push(`<span class="mini-day empty"></span>`);
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(currentYear, month - 1, day);
            const info = getDayInfo(date);
            const record = state.records[toISO(date)];
            const cls = record?.status ? `st-${record.status}`
                : record?.overtime ? "st-overtime"
                : info.isHoliday ? "st-holiday"
                    : info.makeupName ? "st-makeup"
                        : info.isWeekend ? "st-weekend" : "";
            const habitClass = habitCheckinCountForDate(toISO(date)) ? " habit-done" : "";
            cells.push(`<span class="mini-day ${cls}${isSameDate(date, today) ? " today" : ""}${habitClass}">${day}</span>`);
        }
        mini.innerHTML = `<span class="mini-month-title">${month}月</span><span class="mini-grid">${cells.join("")}</span>`;
        fragment.appendChild(mini);
    }
    els.calendarGrid.replaceChildren(fragment);
}

function renderCalendarLoading(text) {
    els.calendarGrid.innerHTML = `<div class="calendar-loading">${escapeHtml(text)}<br>如果网络不可用，将自动使用本地备用数据。</div>`;
}

function renderCalendarUnavailable(year) {
    const message = `${year} 年官方节假日数据尚未发布`;
    els.calendarGrid.innerHTML = `
<div class="calendar-loading calendar-unavailable">
  <strong>${escapeHtml(message)}</strong><br>
  Chinese Days 发布该年度数据后，联网刷新页面即可自动获取。为避免误导，当前不计算该年度的出勤、工资和购票提醒。
</div>
      `;
    els.calendarFooter.innerHTML = `<span class="calendar-tip">${escapeHtml(message)}</span>`;
    renderOverviewUnavailable();
    const unavailable = `<div class="empty-state">${escapeHtml(message)}，暂不计算统计。</div>`;
    els.monthStats.innerHTML = unavailable;
    els.yearStats.innerHTML = unavailable;
    els.salaryResult.innerHTML = `<div class="empty-state">${escapeHtml(message)}，暂不估算工资。</div>`;
    currentSalaryReceipt = null;
    els.ticketReminders.innerHTML = `<div class="empty-state">${escapeHtml(message)}，暂不生成购票提醒。</div>`;
}

function dayAriaLabel(date, info, record) {
    const iso = toISO(date);
    const labels = [iso, weekdayName(date), getLunarText(date)];
    if (record?.status) labels.push(STATUS_LABELS[record.status]);
    else if (info.holidayName) labels.push(info.holidayName);
    else if (info.makeupName) labels.push("调休上班");
    else if (info.isWeekend) labels.push("周末");
    else labels.push("工作日");
    if (record?.reason) labels.push(record.reason);
    if (record?.overtime) labels.push(`加班 ${record.overtime.hours} 小时${record.overtime.reason ? `，${record.overtime.reason}` : ""}`);
    if (record?.note) labels.push(record.note);
    const checkedHabitNames = checkedHabitsForDate(iso).map(habit => habit.name);
    if (checkedHabitNames.length) labels.push(`习惯已打卡：${checkedHabitNames.join("、")}`);
    return labels.filter(Boolean).join("，");
}

function renderCalendarFooter() {
    els.calendarFooter.innerHTML = `
${heatLegend()}
<span class="calendar-tip">点击日期可查看或编辑当天记录</span>
      `;
}

function renderStaticError(error) {
    els.calendarGrid.innerHTML = `<div class="calendar-loading">页面初始化异常：${escapeHtml(error.message)}<br>请刷新页面重试。</div>`;
    updateCalendarSource();
}
