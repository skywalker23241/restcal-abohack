/* 休历 · RestCal —— 节假日、调休、农历与节气数据
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function getTicketReminders(year) {
    const holidayMap = getHolidayMap(year);
    const preferences = normalizeTicketPreferences(state.ticketPreferences, state.settings);
    const firstByName = new Map();
    const lastByName = new Map();
    for (const [iso, value] of holidayMap.entries()) {
        if (!firstByName.has(value.name) || iso < firstByName.get(value.name)) {
            firstByName.set(value.name, iso);
        }
        if (!lastByName.has(value.name) || iso > lastByName.get(value.name)) {
            lastByName.set(value.name, iso);
        }
    }

    return [...firstByName.entries()].flatMap(([name, iso]) => {
        const holidayStart = fromISO(iso);
        const departure = preferences.departureRule === "holiday-eve" ? addDays(holidayStart, -1) : holidayStart;
        const holidayEnd = fromISO(lastByName.get(name));
        const returnDate = preferences.returnRule === "holiday-next" ? addDays(holidayEnd, 1) : holidayEnd;
        return [
            {name, tripType: "outbound", tripLabel: "去程", holidayStart, holidayEnd, departure, saleDate: addDays(departure, -preferences.advanceDays), advanceDays: preferences.advanceDays},
            {name, tripType: "return", tripLabel: "返程", holidayStart, holidayEnd, departure: returnDate, saleDate: addDays(returnDate, -preferences.advanceDays), advanceDays: preferences.advanceDays}
        ];
    }).sort((a, b) => a.departure - b.departure || (a.tripType === "outbound" ? -1 : 1));
}

function getHolidayMap(year) {
    return calendarApi.years.get(year)?.holidays || buildHolidayMap(year);
}

function visibleCalendarYears() {
    const years = new Set(getCalendarDays(currentYear, currentMonth).map(date => date.getFullYear()));
    years.add(currentYear);
    return years;
}

function isCalendarDataReady() {
    return [...visibleCalendarYears()].every(year => calendarApi.years.has(year) || calendarApi.failedYears.has(year));
}

async function ensureCalendarDataForView() {
    await Promise.all([...visibleCalendarYears()].map(year => loadRemoteCalendarYear(year)));
}

async function loadRemoteCalendarYear(year) {
    if (calendarApi.years.has(year) || calendarApi.failedYears.has(year)) return;
    const bundled = window.RESTCAL_CALENDAR_YEARS?.[year];
    if (bundled) {
        calendarApi.years.set(year, normalizeRemoteCalendarYear(bundled));
        calendarApi.status = "bundled";
        calendarApi.message = "本地中国日历数据已就绪";
        return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4500);
    try {
        const sources = [
            {url: CALENDAR_API.localYearJson(year), remote: false},
            {url: CALENDAR_API.remoteYearJson(year), remote: true}
        ];
        let loaded = false;
        for (const source of sources) {
            const response = await fetch(source.url, {
                cache: source.remote ? "no-cache" : "force-cache",
                signal: controller.signal
            });
            if (response.status === 404) continue;
            if (!response.ok) throw new Error(`${year} 年接口返回 ${response.status}`);
            const json = await response.json();
            if (!json || typeof json !== "object" || Array.isArray(json)
                || typeof json.holidays !== "object" || typeof json.workdays !== "object") {
                throw new Error(`${year} 年接口数据格式不正确`);
            }
            calendarApi.years.set(year, normalizeRemoteCalendarYear(json));
            calendarApi.status = source.remote ? "api" : "bundled";
            calendarApi.message = source.remote
                ? `已从 ${CALENDAR_API.sourceName} 获取 ${year} 年数据`
                : "本地中国日历数据已就绪";
            loaded = true;
            break;
        }
        if (!loaded) throw new Error(`${year} 年官方数据尚未发布`);
    } catch (error) {
        calendarApi.failedYears.add(year);
        calendarApi.status = "unavailable";
        calendarApi.message = `${year} 年官方节假日数据尚未发布`;
    } finally {
        window.clearTimeout(timeout);
    }
}

function normalizeRemoteCalendarYear(data) {
    return {
        holidays: normalizeRemoteDayMap(data?.holidays),
        makeupWorkdays: normalizeRemoteDayMap(data?.workdays)
    };
}

function normalizeRemoteDayMap(rawMap) {
    const map = new Map();
    Object.entries(rawMap || {}).forEach(([date, raw]) => {
        map.set(date, {
            date,
            name: parseRemoteDayName(raw),
            raw
        });
    });
    return map;
}

function parseRemoteDayName(raw) {
    if (raw && typeof raw === "object") return raw.name || raw.localName || raw.cn || raw.title || "节假日";
    const parts = String(raw || "").split(",");
    return parts[1] || parts[0] || "节假日";
}

function updateCalendarSource() {
    if (!els.calendarSource) return;
    els.calendarSource.textContent = calendarApi.message;
    els.calendarSource.classList.toggle("ok", calendarApi.status === "api");
    els.calendarSource.classList.toggle("warn", calendarApi.status !== "api");
}

function getDayInfo(date) {
    const iso = toISO(date);
    const yearData = calendarApi.years.get(date.getFullYear());
    const holiday = yearData?.holidays.get(iso) || buildHolidayMap(date.getFullYear()).get(iso);
    const makeup = yearData?.makeupWorkdays.get(iso) || buildMakeupMap(date.getFullYear()).get(iso);
    const naturalWeekend = date.getDay() === 0 || date.getDay() === 6;
    const isHoliday = Boolean(holiday);
    const isWeekend = naturalWeekend && !makeup && !isHoliday;
    const isWorkday = Boolean(makeup) || (!naturalWeekend && !isHoliday);
    return {
        isHoliday,
        isWeekend,
        isWorkday,
        holidayName: holiday?.name || "",
        makeupName: makeup?.name || ""
    };
}

function buildHolidayMap(year) {
    if (holidayCache.has(year)) return holidayCache.get(year);
    const map = new Map();
    (HOLIDAY_DATA[year]?.holidays || []).forEach(item => map.set(item.date, item));
    holidayCache.set(year, map);
    return map;
}

function buildMakeupMap(year) {
    if (makeupCache.has(year)) return makeupCache.get(year);
    const map = new Map();
    (HOLIDAY_DATA[year]?.makeupWorkdays || []).forEach(item => map.set(item.date, item));
    makeupCache.set(year, map);
    return map;
}

function getCalendarDays(year, month) {
    const first = new Date(year, month - 1, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = addDays(first, -mondayOffset);
    return Array.from({length: 42}, (_, i) => addDays(start, i));
}

function getMonthDates(year, month) {
    const total = new Date(year, month, 0).getDate();
    return Array.from({length: total}, (_, i) => new Date(year, month - 1, i + 1));
}

function getYearDates(year) {
    const dates = [];
    for (let month = 1; month <= 12; month++) {
        dates.push(...getMonthDates(year, month));
    }
    return dates;
}

// 名称保留自月视图时代；现在按当前日历视图的粒度导航
function shiftMonth(delta) {
    if (calendarMode === "day" || calendarMode === "week") {
        const next = new Date(anchorDate);
        next.setDate(next.getDate() + delta * (calendarMode === "week" ? 7 : 1));
        anchorDate = next;
    } else if (calendarMode === "year") {
        anchorDate = new Date(currentYear + delta, currentMonth - 1, 1);
    } else {
        anchorDate = new Date(currentYear, currentMonth - 1 + delta, 1);
    }
    currentYear = anchorDate.getFullYear();
    currentMonth = anchorDate.getMonth() + 1;
    ensureYearOption(currentYear);
    render();
}

// 通过下拉切换年月后，把日/周锚点收进目标月份（保留原“几号”，超出月底则取月底）
function clampAnchorToMonth() {
    const lastDay = new Date(currentYear, currentMonth, 0).getDate();
    anchorDate = new Date(currentYear, currentMonth - 1, Math.min(anchorDate.getDate(), lastDay));
}

function ensureYearOption(year) {
    if ([...els.yearSelect.options].some(opt => Number(opt.value) === year)) return;
    const opt = document.createElement("option");
    opt.value = String(year);
    opt.textContent = `${year} 年`;
    els.yearSelect.appendChild(opt);
    [...els.yearSelect.options]
        .sort((a, b) => Number(a.value) - Number(b.value))
        .forEach(item => els.yearSelect.appendChild(item));
    syncEnhancedSelects(true);
}

function getTraditionalFestival(date) {
    const iso = toISO(date);
    if (traditionalFestivalCache.has(iso)) return traditionalFestivalCache.get(iso);
    const chineseDays = window.chineseDays;
    let festival = getSolarTermText(addDays(date, 1)) === "清明" ? "寒食节" : "";
    if (!festival && chineseDays?.getLunarFestivals) {
        try {
            const names = chineseDays.getLunarFestivals(iso)?.[0]?.name || [];
            const aliases = [
                [["除夕"], "除夕"],
                [["春节"], "春节"],
                [["元宵节", "上元节"], "元宵节"],
                [["春龙节"], "龙抬头"],
                [["上巳节"], "上巳节"],
                [["端午节"], "端午节"],
                [["乞巧节"], "七夕节"],
                [["中元(鬼)节"], "中元节"],
                [["中秋节"], "中秋节"],
                [["重阳节"], "重阳节"],
                [["寒衣节", "十月朝"], "寒衣节"],
                [["下元节"], "下元节"],
                [["腊八节"], "腊八节"],
                [["官家送灶", "民间送灶"], "小年"]
            ];
            festival = aliases.find(([sourceNames]) => sourceNames.some(name => names.includes(name)))?.[1] || "";
        } catch {
            festival = "";
        }
    }
    traditionalFestivalCache.set(iso, festival);
    return festival;
}

function getLunarText(date) {
    const iso = toISO(date);
    if (lunarTextCache.has(iso)) return lunarTextCache.get(iso);
    lunarTextCache.set(iso, computeLunarText(date, iso));
    return lunarTextCache.get(iso);
}

function computeLunarText(date, iso) {
    const chineseDays = window.chineseDays;
    if (chineseDays?.getLunarDate) {
        try {
            const lunar = chineseDays.getLunarDate(iso);
            const month = lunar.lunarMonCN || "";
            const day = lunar.lunarDayCN || "";
            const leap = lunar.isLeap ? "闰" : "";
            return `${leap}${month}${day}`.trim();
        } catch {
            // Fall through to browser Intl fallback.
        }
    }

    try {
        const text = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
            month: "long",
            day: "numeric"
        }).format(date);
        return text.replace("月", "月 ");
    } catch {
        return "";
    }
}

function getSolarTermText(date) {
    const iso = toISO(date);
    if (solarTermCache.has(iso)) return solarTermCache.get(iso);
    const chineseDays = window.chineseDays;
    let text = "";
    if (chineseDays?.getSolarTerms) {
        try {
            const terms = chineseDays.getSolarTerms(iso);
            text = terms?.[0]?.date === iso ? terms[0].name : "";
        } catch {
            text = "";
        }
    }
    solarTermCache.set(iso, text);
    return text;
}
