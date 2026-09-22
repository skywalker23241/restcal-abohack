/* 休历 · RestCal —— 全局搜索
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function openSearch() {
    openBackdrop(els.searchModal);
    runSearch();
    window.setTimeout(() => els.searchInput.focus({preventScroll: true}), 80);
}

function closeSearch() {
    closeBackdrop(els.searchModal);
}

function clearSearchFilters() {
    els.searchInput.value = "";
    els.searchStatus.value = "all";
    els.searchFrom.value = "";
    els.searchTo.value = "";
    runSearch();
    els.searchInput.focus({preventScroll: true});
}

function queueSearch() {
    window.clearTimeout(searchRenderTimer);
    searchRenderTimer = window.setTimeout(runSearch, 120);
}

function runSearch() {
    const from = els.searchFrom.value;
    const to = els.searchTo.value;
    if (from && to && from > to) {
        els.searchResults.innerHTML = `<div class="empty-state">开始日期不能晚于结束日期。</div>`;
        return;
    }
    const results = collectSearchResults();
    renderSearchResults(results);
}

function collectSearchResults() {
    const query = normalizeSearchText(els.searchInput.value);
    const status = els.searchStatus.value;
    const from = els.searchFrom.value;
    const to = els.searchTo.value;
    const hasFilter = Boolean(query || status !== "all" || from || to);
    const candidates = searchCandidateDates(from, to, hasFilter);
    const results = [];

    for (const iso of candidates) {
        const date = fromISO(iso);
        const info = getDayInfo(date);
        const record = state.records[iso];
        if (!matchesSearchStatus(status, info, record)) continue;
        const text = normalizeSearchText([
            iso,
            weekdayName(date),
            getLunarText(date),
            info.holidayName,
            info.makeupName,
            record?.status ? STATUS_LABELS[record.status] : "",
            record?.leaveType,
            record?.reason,
            record?.overtime ? "加班" : "",
            record?.overtime?.reason,
            record?.overtime?.hours,
            record?.note
        ].filter(Boolean).join(" "));
        if (query && !text.includes(query)) continue;
        if (!hasFilter && !record?.status && !record?.overtime && !record?.note && !info.holidayName && !info.makeupName && !isSameDate(date, today)) continue;

        results.push(buildSearchResult(iso, date, info, record));
        if (results.length >= 80) break;
    }
    return results;
}

function searchCandidateDates(from, to, hasFilter) {
    const set = new Set();
    const start = isValidISODate(from) ? from : (isValidISODate(to) ? `${to.slice(0, 4)}-01-01` : `${currentYear}-01-01`);
    const end = isValidISODate(to) ? to : (isValidISODate(from) ? `${from.slice(0, 4)}-12-31` : `${currentYear}-12-31`);
    if (from || to) {
        rangeDates(start, end).slice(0, 800).forEach(iso => set.add(iso));
    } else if (hasFilter) {
        getYearDates(currentYear).forEach(date => set.add(toISO(date)));
    } else {
        getMonthDates(currentYear, currentMonth).forEach(date => set.add(toISO(date)));
    }
    Object.keys(state.records).forEach(iso => {
        if (from && iso < from) return;
        if (to && iso > to) return;
        if (!from && !to && !hasFilter && !iso.startsWith(`${currentYear}-${String(currentMonth).padStart(2, "0")}`)) return;
        set.add(iso);
    });
    return [...set].sort();
}

function matchesSearchStatus(status, info, record) {
    if (status === "all") return true;
    if (status === "leave") return LEAVE_STATUSES.includes(record?.status);
    if (status === "overtime") return Boolean(record?.overtime);
    if (status === "holiday") return info.isHoliday;
    if (status === "weekend") return info.isWeekend;
    return record?.status === status;
}

function buildSearchResult(iso, date, info, record) {
    const label = record?.status
        ? `${STATUS_LABELS[record.status]}${record.overtime ? " + 加班" : ""}`
        : record?.overtime ? "加班"
        : (info.holidayName || (info.makeupName ? "调休上班" : info.isWeekend ? "周末" : "工作日"));
    const meta = [weekdayName(date), getLunarText(date), info.holidayName, info.makeupName, record?.reason, record?.overtime?.reason, record?.overtime ? `${record.overtime.hours} 小时` : "", record?.note]
        .filter(Boolean)
        .join(" · ");
    const tone = record?.status || (record?.overtime ? "overtime" : (info.isHoliday ? "holiday" : info.isWeekend ? "weekend" : ""));
    return {iso, label, meta, tone};
}

function renderSearchResults(results) {
    if (!results.length) {
        els.searchResults.innerHTML = `<div class="empty-state">没有找到匹配日期。</div>`;
        return;
    }
    els.searchResults.innerHTML = results.map(item => `
<button class="search-result ${item.tone}" type="button" data-search-date="${escapeHtml(item.iso)}">
  <span class="search-result-date">${escapeHtml(item.iso)}</span>
  <span class="search-result-main">${escapeHtml(item.label)}</span>
  <span class="search-result-meta">${escapeHtml(item.meta || "点击查看当天详情")}</span>
</button>
      `).join("");
}

function normalizeSearchText(value) {
    return String(value || "").trim().toLowerCase();
}

async function jumpToSearchDate(iso) {
    if (!isValidISODate(iso)) return;
    const date = fromISO(iso);
    currentYear = date.getFullYear();
    currentMonth = date.getMonth() + 1;
    ensureYearOption(currentYear);
    closeSearch();
    await render();
    window.setTimeout(() => {
        document.querySelector(`[data-date="${iso}"]`)?.scrollIntoView({block: "center", inline: "center"});
        openModal(iso);
    }, 80);
}
