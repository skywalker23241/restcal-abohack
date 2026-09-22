/* 休历 · RestCal —— 启动流程、遮罩层与滚动锁、主题切换、主导航与视图切换
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

async function init() {
    applyTheme(getThemePreference());
    window.RestCalI18n?.init();
    initSelectors();
    initEnhancedSelects();
    initNavigation();
    initCalendarSwipe();
    initSheetDragGestures();
    initProductTour();
    bindEvents();
    initSegmentedIndicators();
    fillSettingsInputs();
    renderRestDaysPicker();
    els.webdavUrl.value = webdavConfig.url || "";
    els.webdavUsername.value = webdavConfig.username || "";
    els.webdavPassword.value = webdavConfig.password || "";
    renderWebdavCard();
    fillIntegrationInputs();
    await refreshGoogleConnection();
    resetLeaveGeneratorForm();
    await render();
    const openedFromCalendar = await initCalendarDeepLinks();
    if (!openedFromCalendar && !state.onboardingCompleted && !state.onboardingSkipped && window.RestCalOnboardingView) openOnboarding();
}

function openBackdrop(el) {
    window.clearTimeout(backdropTimers.get(el));
    if (!el.classList.contains("open")) modalReturnFocus.set(el, document.activeElement);
    el.classList.remove("closing");
    el.classList.add("open");
    openBackdrops.add(el);
    updateScrollLock();
}

function closeBackdrop(el) {
    if (!el.classList.contains("open") || el.classList.contains("closing")) return;
    el.classList.add("closing");
    window.clearTimeout(backdropTimers.get(el));
    backdropTimers.set(el, window.setTimeout(() => {
        el.classList.remove("open", "closing");
        openBackdrops.delete(el);
        updateScrollLock();
        restoreModalFocus(el);
    }, 200));
}

function restoreModalFocus(el) {
    // 弹窗全部关闭后把焦点还给触发元素；弹窗接力（如日期弹窗→请假条）时不抢焦点
    const trigger = modalReturnFocus.get(el);
    modalReturnFocus.delete(el);
    if (openBackdrops.size > 0) return;
    if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({preventScroll: true});
}

function updateScrollLock() {
    const locked = openBackdrops.size > 0;
    // 背景 inert 仅针对模态弹窗
    if (els.app) els.app.inert = locked;
    if (locked === document.body.classList.contains("modal-open")) return;
    if (locked && isNarrowScreen()) {
        // 记录滚动位置并固定 body，阻止 iOS 背景橡皮筋滚动
        lockedScrollY = window.scrollY;
        document.body.style.top = `-${lockedScrollY}px`;
    }
    document.body.classList.toggle("modal-open", locked);
    if (!locked && lockedScrollY >= 0) {
        document.body.style.top = "";
        window.scrollTo(0, lockedScrollY);
        lockedScrollY = -1;
    }
}

function isNarrowScreen() {
    return narrowScreenQuery.matches;
}

function isCompactMonthView() {
    return compactMonthQuery.matches;
}

function getThemePreference() {
    try {
        const stored = localStorage.getItem(THEME_KEY);
        return THEME_SEQUENCE.includes(stored) ? stored : "auto";
    } catch {
        return "auto";
    }
}

function applyTheme(pref, animate = false) {
    if (animate) return animateThemeChange(() => setTheme(pref));
    setTheme(pref);
}

function setTheme(pref) {
    const dark = pref === "dark" || (pref === "auto" && darkSchemeQuery.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const meta = THEME_META[pref] || THEME_META.auto;
    els.themeToggle.innerHTML = `<i class="ph ph-${meta.icon} icon" aria-hidden="true"></i>`;
    els.themeToggle.title = meta.label;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171411" : "#f6f3ed");
    document.querySelectorAll("[data-theme-choice]").forEach(button => {
        const active = button.dataset.themeChoice === pref;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function animateThemeChange(update) {
    const root = document.documentElement;
    window.clearTimeout(themeAnimTimer);
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        root.classList.add("theme-anim", "theme-view-transition");
        const transition = document.startViewTransition(update);
        transition.finished.finally(() => root.classList.remove("theme-anim", "theme-view-transition"));
        return;
    }

    root.classList.add("theme-anim");
    root.offsetWidth;
    update();
    themeAnimTimer = window.setTimeout(() => root.classList.remove("theme-anim"), 460);
}

function cycleTheme() {
    const next = THEME_SEQUENCE[(THEME_SEQUENCE.indexOf(getThemePreference()) + 1) % THEME_SEQUENCE.length];
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch {
        // localStorage 不可用时主题仅在当前会话生效
    }
    applyTheme(next, true);
}

function initSelectors() {
    const years = new Set([2024, 2025, 2026, 2027, currentYear - 1, currentYear, currentYear + 1]);
    [...years].sort((a, b) => a - b).forEach(year => {
        const opt = document.createElement("option");
        opt.value = String(year);
        opt.textContent = `${year} 年`;
        els.yearSelect.appendChild(opt);
    });

    for (let month = 1; month <= 12; month++) {
        const opt = document.createElement("option");
        opt.value = String(month);
        opt.textContent = `${month} 月`;
        els.monthSelect.appendChild(opt);

        const salaryOpt = opt.cloneNode(true);
        els.salaryReceiptMonth.appendChild(salaryOpt);
    }

    for (let year = 2004; year <= today.getFullYear(); year++) {
        const opt = document.createElement("option");
        opt.value = String(year);
        opt.textContent = `${year} 年`;
        els.salaryReceiptYear.appendChild(opt);
    }

    const ticketTime = document.getElementById("icsTicketTime");
    for (let hour = 0; hour < 24; hour++) {
        for (const minute of [0, 30]) {
            const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = value;
            opt.selected = value === "09:00";
            ticketTime?.appendChild(opt);
        }
    }
}

function initEnhancedSelects() {
    // forEach 会把索引传入第二参，必须显式包装避免污染 variant
    [els.yearSelect, els.monthSelect].forEach(select => enhanceSelect(select));
    enhanceSelect(els.salaryReceiptYear, "year");
    enhanceSelect(els.salaryReceiptMonth, "month");
    // 所有业务下拉框统一替换为主题化 selectbox，避免任何平台原生菜单混入界面。
    document.querySelectorAll("select").forEach(select => {
        if (!enhancedSelects.has(select)) enhanceSelect(select, "field");
    });
    // 原生日期输入的弹出面板同样无法主题化，替换为自定义日期选择器
    ["searchFrom", "searchTo", "hireDateInput", "leaveStart", "leaveEnd", "modalStartDate", "modalEndDate"]
        .forEach(id => enhanceDateInput(document.getElementById(id)));
    if (enhancedSelectEventsBound) return;
    enhancedSelectEventsBound = true;
    document.addEventListener("click", event => {
        const clickedInside = [...enhancedSelects.values(), ...enhancedDateInputs.values()]
            .some(view => view.box.contains(event.target) || view.menu?.contains(event.target));
        if (!clickedInside) {
            closeAllEnhancedSelects();
            closeAllDateMenus();
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            const hasOpenPicker = [...enhancedSelects.values(), ...enhancedDateInputs.values()]
                .some(view => view.box.classList.contains("open"));
            if (!hasOpenPicker) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            closeAllEnhancedSelects();
            closeAllDateMenus();
        }
    });
    window.addEventListener("resize", repositionOpenPickers);
    document.addEventListener("scroll", repositionOpenPickers, true);
}

function repositionOpenPickers() {
    repositionOpenDateMenus();
    repositionOpenSelectMenus();
}

function initNavigation() {
    document.addEventListener("click", event => {
        const button = event.target instanceof Element ? event.target.closest("[data-nav]") : null;
        if (!button) return;
        switchView(button.dataset.nav);
    });
    document.querySelectorAll("[data-cal-mode]").forEach(button => {
        button.addEventListener("click", () => setCalendarMode(button.dataset.calMode));
    });
    // 年视图：点击迷你月历跳到对应月份的月视图
    els.calendarGrid.addEventListener("click", event => {
        const mini = event.target instanceof Element ? event.target.closest("[data-jump-month]") : null;
        if (!mini) return;
        currentMonth = Number(mini.dataset.jumpMonth);
        anchorDate = new Date(currentYear, currentMonth - 1, 1);
        setCalendarMode("month");
    });
    syncCalendarModeUI();
    switchView("calendar");
    window.addEventListener("resize", () => syncAppNavIndicator(currentView, false));
}

function setCalendarMode(mode) {
    if (!CAL_MODES.includes(mode)) return;
    calendarMode = mode;
    try { localStorage.setItem(CAL_MODE_KEY, mode); } catch { }
    syncCalendarModeUI();
    render();
}

function jumpToToday(mode = calendarMode) {
    const now = new Date();
    anchorDate = now;
    currentYear = now.getFullYear();
    currentMonth = now.getMonth() + 1;
    if (mode !== calendarMode) setCalendarMode(mode);
    else render();
}

function returnToTodayDayView() {
    closeAllDateMenus();
    switchView("calendar");
    jumpToToday("day");
}

function syncCalendarModeUI() {
    document.querySelectorAll("[data-cal-mode]").forEach(button => {
        const active = button.dataset.calMode === calendarMode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    // 年视图下月份选择无意义，隐藏
    document.querySelector(".month-switcher")?.classList.toggle("mode-year", calendarMode === "year");
    const navTitles = {
        day: ["上一天", "下一天"],
        week: ["上一周", "下一周"],
        month: ["上月", "下月"],
        year: ["上一年", "下一年"]
    };
    const [prevTitle, nextTitle] = navTitles[calendarMode];
    els.prevMonth.title = prevTitle;
    els.prevMonth.setAttribute("aria-label", prevTitle);
    els.nextMonth.title = nextTitle;
    els.nextMonth.setAttribute("aria-label", nextTitle);
}

function switchView(name) {
    if (!["calendar", "stats", "tools"].includes(name)) return;
    const previousView = currentView;
    currentView = name;
    document.body.dataset.view = name;
    document.querySelectorAll("[data-view-panel]").forEach(panel => {
        panel.hidden = panel.dataset.viewPanel !== name;
    });
    document.querySelectorAll(".app-nav-btn, .bottom-nav-btn").forEach(button => {
        if (!button.dataset.nav) return;
        const active = button.dataset.nav === name;
        button.classList.toggle("active", active);
        const icon = button.querySelector(".icon");
        if (icon) icon.className = `${active ? "ph-fill" : "ph"} ph-${NAV_ICONS[button.dataset.nav]} icon`;
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });
    syncAppNavIndicator(name, previousView !== name);
    window.scrollTo({top: 0, behavior: "instant"});
}

function syncAppNavIndicator(name, animate = true) {
    const nav = document.querySelector(".app-nav");
    const indicator = nav?.querySelector(".app-nav-indicator");
    const active = nav?.querySelector(`.app-nav-btn[data-nav="${name}"]`);
    if (!nav || !indicator || !active) return;
    const update = () => {
        indicator.classList.toggle("no-transition", !animate);
        indicator.style.width = `${active.offsetWidth}px`;
        indicator.style.transform = `translateX(${active.offsetLeft - 3}px)`;
        if (!animate) requestAnimationFrame(() => indicator.classList.remove("no-transition"));
    };
    if (nav.offsetWidth) update();
    else requestAnimationFrame(update);
}

function initSegmentedIndicators() {
    const groups = [...document.querySelectorAll(".segmented")];
    groups.forEach(group => {
        if (!group.querySelector(":scope > .segmented-indicator")) {
            const indicator = document.createElement("span");
            indicator.className = "segmented-indicator";
            indicator.setAttribute("aria-hidden", "true");
            group.prepend(indicator);
        }
        syncSegmentedIndicator(group, false);
    });

    const observer = new MutationObserver(mutations => {
        const changedGroups = new Set();
        mutations.forEach(mutation => {
            if (mutation.target.matches?.(".seg-btn")) {
                const group = mutation.target.closest(".segmented");
                if (group) changedGroups.add(group);
            }
        });
        changedGroups.forEach(group => syncSegmentedIndicator(group));
    });
    groups.forEach(group => observer.observe(group, {
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "aria-pressed"]
    }));

    const resizeObserver = new ResizeObserver(entries => {
        entries.forEach(entry => {
            if (entry.target.offsetWidth) syncSegmentedIndicator(entry.target, false);
        });
    });
    groups.forEach(group => resizeObserver.observe(group));

    window.addEventListener("resize", () => syncAllSegmentedIndicators(false));
    // 跨越紧凑断点时日期格副标题的取值规则会变，需要重绘日历。
    compactMonthQuery.addEventListener("change", () => renderCalendarView());
    window.addEventListener("restcal:languagechange", () => {
        renderMonthSummary(calculateStats(currentYear, currentMonth));
        window.RestCalI18n?.apply(els.monthSummary);
        if (els.overviewCustomizeModal.classList.contains("open")) renderOverviewCustomizer();
        if (activeDate && els.dayModal.classList.contains("open")) {
            const date = fromISO(activeDate);
            renderModalHeading(date, getDayInfo(date));
            window.RestCalI18n?.apply(els.dayModal);
        }
        requestAnimationFrame(() => syncAllSegmentedIndicators(false));
    });
}

function syncAllSegmentedIndicators(animate = true) {
    document.querySelectorAll(".segmented").forEach(group => syncSegmentedIndicator(group, animate));
}

function syncSegmentedIndicator(group, animate = true) {
    const indicator = group?.querySelector(":scope > .segmented-indicator");
    const active = group?.querySelector(":scope > .seg-btn.active");
    if (!indicator || !active) return;
    const update = () => {
        indicator.classList.toggle("no-transition", !animate);
        indicator.style.width = `${active.offsetWidth}px`;
        indicator.style.transform = `translateX(${active.offsetLeft}px)`;
        if (!animate) requestAnimationFrame(() => indicator.classList.remove("no-transition"));
    };
    if (group.offsetWidth) update();
    else requestAnimationFrame(update);
}

function setSettingsPanel(name) {
    activeSettingsPanel = name;
    document.querySelectorAll("[data-settings-panel]").forEach(panel => {
        panel.hidden = panel.dataset.settingsPanel !== name;
    });
    document.querySelectorAll("[data-settings-nav]").forEach(button => {
        const active = button.dataset.settingsNav === name;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
    });
    document.querySelector(".settings-panels")?.scrollTo({top: 0});
}

function initAppearanceControls() {
    document.querySelectorAll("[data-theme-choice]").forEach(button => {
        button.addEventListener("click", () => {
            try {
                localStorage.setItem(THEME_KEY, button.dataset.themeChoice);
            } catch {
                // localStorage 不可用时主题仅在当前会话生效
            }
            applyTheme(button.dataset.themeChoice, true);
        });
    });
    document.querySelectorAll("[data-language-choice]").forEach(button => {
        button.addEventListener("click", () => window.RestCalI18n?.setLanguage(button.dataset.languageChoice));
    });
    window.addEventListener("restcal:languagechange", syncAppearanceControls);
    window.addEventListener("restcal:languagechange", refreshQuoteForLanguageChange);
    syncAppearanceControls();
}

function syncAppearanceControls() {
    const theme = getThemePreference();
    document.querySelectorAll("[data-theme-choice]").forEach(button => {
        const active = button.dataset.themeChoice === theme;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    const language = window.RestCalI18n?.getLanguage() || "zh";
    document.querySelectorAll("[data-language-choice]").forEach(button => {
        const active = button.dataset.languageChoice === language;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function initCalendarSwipe() {
    // 日历面板左右滑动切换月份；仅在 touchend 判定，绝不干扰纵向滚动
    const panel = document.querySelector(".calendar-panel");
    if (!panel) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    panel.addEventListener("touchstart", event => {
        // 单指且避开屏幕左缘（系统返回手势区）才开始跟踪
        tracking = event.touches.length === 1 && event.touches[0].clientX > 24;
        if (!tracking) return;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
    }, {passive: true});
    panel.addEventListener("touchend", event => {
        if (!tracking || openBackdrops.size) return;
        tracking = false;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        // 横向位移需达阈值且明显大于纵向位移，排除点击和滚动
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        shiftMonth(dx < 0 ? 1 : -1);
    }, {passive: true});
    panel.addEventListener("touchcancel", () => {
        tracking = false;
    }, {passive: true});
}
