/* 休历 · RestCal —— 自定义下拉（selectbox）与日期选择器（datebox）
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function enhanceSelect(select, variant) {
    if (!select || enhancedSelects.has(select)) return;

    const box = document.createElement("div");
    const kind = variant || (select.id === "monthSelect" ? "month" : "year");
    box.className = `selectbox selectbox-${kind}`;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = kind === "field" ? "select-trigger" : "select-trigger control";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || "选择");

    const label = document.createElement("span");
    label.className = "select-trigger-label";
    trigger.appendChild(label);

    const menu = document.createElement("div");
    menu.className = "select-menu";
    menu.id = `${select.id}Menu`;
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", select.getAttribute("aria-label") || "选择");

    box.append(trigger, menu);
    select.after(box);
    select.classList.add("select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    const view = {box, trigger, label, menu, optionCount: 0};
    enhancedSelects.set(select, view);
    rebuildEnhancedSelect(select, view);
    syncEnhancedSelect(select);

    // 代码里多处直接给 select.value 赋值（载入设置、清空筛选、预填请假单），
    // 拦截该实例的 value setter 让触发器文案始终同步，免去逐个赋值点手动刷新
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(select, "value", {
        get() { return valueDescriptor.get.call(this); },
        set(next) {
            valueDescriptor.set.call(this, next);
            syncEnhancedSelect(this);
        }
    });

    select.addEventListener("change", () => syncEnhancedSelect(select));
    trigger.addEventListener("click", () => toggleEnhancedSelect(select));
    trigger.addEventListener("keydown", event => handleSelectTriggerKeydown(event, select));
}

function rebuildEnhancedSelect(select, view) {
    view.menu.textContent = "";
    [...select.options].forEach((option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "select-option";
        item.id = `${select.id}Option${index}`;
        item.dataset.value = option.value;
        item.setAttribute("role", "option");
        item.textContent = option.textContent;
        item.disabled = option.disabled;
        item.addEventListener("click", () => {
            if (item.disabled) return;
            select.value = option.value;
            select.dispatchEvent(new Event("change", {bubbles: true}));
            closeEnhancedSelect(select, true);
        });
        item.addEventListener("keydown", event => handleSelectOptionKeydown(event, select));
        view.menu.appendChild(item);
    });
    view.optionCount = select.options.length;
}

function syncEnhancedSelects(rebuild = false) {
    enhancedSelects.forEach((_, select) => syncEnhancedSelect(select, rebuild));
}

function syncEnhancedSelect(select, rebuild = false) {
    const view = enhancedSelects.get(select);
    if (!view) return;
    if (rebuild || view.optionCount !== select.options.length) {
        rebuildEnhancedSelect(select, view);
    }

    const selectedOption = select.selectedOptions[0] || select.options[0];
    view.label.textContent = selectedOption ? selectedOption.textContent : "";
    [...view.menu.children].forEach(item => {
        const selected = item.dataset.value === select.value;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-selected", String(selected));
    });
}

function toggleEnhancedSelect(select) {
    const view = enhancedSelects.get(select);
    if (!view) return;
    if (view.box.classList.contains("open")) {
        closeEnhancedSelect(select);
    } else {
        openEnhancedSelect(select);
    }
}

function openEnhancedSelect(select, focusSelected = false) {
    const view = enhancedSelects.get(select);
    if (!view) return;
    syncEnhancedSelect(select);
    closeAllEnhancedSelects(select);
    closeAllDateMenus();
    view.box.classList.add("open");
    view.trigger.setAttribute("aria-expanded", "true");
    view.menu.classList.add("is-portal");
    view.menu.style.visibility = "hidden";
    document.body.appendChild(view.menu);
    positionSelectMenu(select);
    view.menu.style.visibility = "";
    if (focusSelected) {
        (view.menu.querySelector(".select-option.is-selected") || view.menu.querySelector(".select-option"))?.focus();
    }
}

function closeEnhancedSelect(select, returnFocus = false) {
    const view = enhancedSelects.get(select);
    if (!view) return;
    view.box.classList.remove("open");
    view.trigger.setAttribute("aria-expanded", "false");
    if (view.menu.classList.contains("is-portal")) {
        view.menu.classList.remove("is-portal");
        view.menu.removeAttribute("style");
        view.box.appendChild(view.menu);
    }
    if (returnFocus) view.trigger.focus();
}

function initSheetDragGestures() {
    document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
        const drawer = backdrop.firstElementChild;
        if (!drawer || drawer.querySelector(":scope > .sheet-drag-handle")) return;
        const handle = document.createElement("div");
        handle.className = "sheet-drag-handle";
        handle.setAttribute("aria-hidden", "true");
        drawer.prepend(handle);

        let startY = 0;
        let currentY = 0;
        let startedAt = 0;
        let pointerId = null;

        const reset = () => {
            drawer.classList.remove("sheet-dragging");
            drawer.style.removeProperty("transform");
            drawer.style.removeProperty("transition");
            handle.style.removeProperty("cursor");
            pointerId = null;
        };

        handle.addEventListener("pointerdown", event => {
            if (!isNarrowScreen() || !backdrop.classList.contains("open") || event.button > 0) return;
            pointerId = event.pointerId;
            startY = event.clientY;
            currentY = 0;
            startedAt = performance.now();
            drawer.getAnimations().forEach(animation => animation.finish());
            handle.setPointerCapture(pointerId);
            drawer.classList.add("sheet-dragging");
            handle.style.cursor = "grabbing";
        });

        window.addEventListener("pointermove", event => {
            if (event.pointerId !== pointerId) return;
            currentY = Math.max(0, event.clientY - startY);
            drawer.style.transform = `translateY(${currentY}px)`;
        });

        const finish = (event, cancelled = false) => {
            if (event.pointerId !== pointerId) return;
            if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
            const duration = Math.max(1, performance.now() - startedAt);
            const velocity = currentY / duration;
            const threshold = Math.min(140, Math.max(80, drawer.getBoundingClientRect().height * 0.2));
            const shouldClose = !cancelled && (currentY >= threshold || (currentY >= 36 && velocity >= 0.65));
            drawer.classList.remove("sheet-dragging");
            drawer.style.transition = "transform 0.22s cubic-bezier(.22, 1, .36, 1)";
            if (shouldClose) {
                drawer.style.transform = `translateY(${window.innerHeight}px)`;
                window.setTimeout(() => {
                    dismissBackdropFromDrag(backdrop);
                    window.setTimeout(reset, 220);
                }, 160);
            } else {
                drawer.style.transform = "translateY(0)";
                window.setTimeout(reset, 230);
            }
        };

        window.addEventListener("pointerup", event => finish(event));
        window.addEventListener("pointercancel", event => finish(event, true));
    });
}

function dismissBackdropFromDrag(backdrop) {
    const handlers = {
        searchModal: closeSearch,
        guideModal: dismissProductTourIntro,
        settingsModal: closeSettings,
        stationPickerModal: closeStationPicker,
        overviewCustomizeModal: closeOverviewCustomizer,
        recentRecordsPanel: closeRecentRecords,
        webdavConfigModal: closeWebdavConfigModal,
        receiptModal: closeReceiptModal,
        leaveGeneratorModal: closeLeaveGenerator,
        dayModal: closeModal,
        confirmModal: () => resolveConfirm(false)
    };
    (handlers[backdrop.id] || (() => closeBackdrop(backdrop)))();
}

function positionSelectMenu(select) {
    const view = enhancedSelects.get(select);
    if (!view?.box.classList.contains("open") || !view.menu.classList.contains("is-portal")) return;
    const margin = 10;
    const gap = 7;
    const triggerRect = view.trigger.getBoundingClientRect();
    const preferredWidth = Math.max(triggerRect.width, Math.min(view.menu.scrollWidth, 360));
    const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
    view.menu.style.width = `${width}px`;
    const menuRect = view.menu.getBoundingClientRect();
    const left = Math.min(Math.max(margin, triggerRect.left), Math.max(margin, window.innerWidth - width - margin));
    const spaceBelow = window.innerHeight - triggerRect.bottom - gap - margin;
    const spaceAbove = triggerRect.top - gap - margin;
    const placeAbove = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
    const top = placeAbove
        ? Math.max(margin, triggerRect.top - menuRect.height - gap)
        : Math.min(triggerRect.bottom + gap, window.innerHeight - menuRect.height - margin);
    view.menu.style.left = `${left}px`;
    view.menu.style.top = `${Math.max(margin, top)}px`;
    view.menu.dataset.placement = placeAbove ? "top" : "bottom";
}

function repositionOpenSelectMenus() {
    enhancedSelects.forEach((view, select) => {
        if (view.box.classList.contains("open")) positionSelectMenu(select);
    });
}

function closeAllEnhancedSelects(exceptSelect = null) {
    enhancedSelects.forEach((_, select) => {
        if (select !== exceptSelect) closeEnhancedSelect(select);
    });
}

function handleSelectTriggerKeydown(event, select) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openEnhancedSelect(select, true);
        return;
    }
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleEnhancedSelect(select);
    }
}

function handleSelectOptionKeydown(event, select) {
    const view = enhancedSelects.get(select);
    if (!view) return;
    const options = [...view.menu.querySelectorAll(".select-option:not(:disabled)")];
    const index = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        options[(index + step + options.length) % options.length]?.focus();
    } else if (event.key === "Home") {
        event.preventDefault();
        options[0]?.focus();
    } else if (event.key === "End") {
        event.preventDefault();
        options.at(-1)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        document.activeElement?.click();
    } else if (event.key === "Escape") {
        event.preventDefault();
        closeEnhancedSelect(select, true);
    }
}

// ===== 自定义日期选择器：datebox（原生 date 弹出面板无法主题化，这里
// 与 selectbox 同构——原生 input 隐藏持值，触发器 + 月历弹层完全走主题） =====
function enhanceDateInput(input) {
    if (!input || enhancedDateInputs.has(input)) return;

    const box = document.createElement("div");
    box.className = "datebox";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "date-trigger";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", input.labels?.[0]?.textContent.trim() || "选择日期");

    const label = document.createElement("span");
    label.className = "date-trigger-label";
    trigger.appendChild(label);

    const menu = document.createElement("div");
    menu.className = "date-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "选择日期");

    box.append(trigger, menu);
    input.after(box);
    input.classList.add("select-native");
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");

    const view = {box, trigger, label, menu, viewYear: today.getFullYear(), viewMonth: today.getMonth() + 1};
    enhancedDateInputs.set(input, view);
    syncDateInput(input);

    // 与 selectbox 相同：拦截实例 value setter，程序赋值时自动同步触发器文案
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    Object.defineProperty(input, "value", {
        get() { return valueDescriptor.get.call(this); },
        set(next) {
            valueDescriptor.set.call(this, next);
            syncDateInput(this);
        }
    });

    input.addEventListener("change", () => syncDateInput(input));
    trigger.addEventListener("click", () => toggleDateMenu(input));
    trigger.addEventListener("keydown", event => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDateMenu(input);
        }
    });
    menu.addEventListener("click", event => handleDateMenuClick(event, input));
    menu.addEventListener("pointerdown", event => event.stopPropagation());
    menu.addEventListener("keydown", event => handleDateMenuKeydown(event, input));
}

function syncDateInput(input) {
    const view = enhancedDateInputs.get(input);
    if (!view) return;
    view.label.textContent = input.value || "选择日期";
    view.label.classList.toggle("is-placeholder", !input.value);
    if (view.box.classList.contains("open")) renderDateMenu(input);
}

function dateRangeForInput(input) {
    const pair = DATE_RANGE_PAIRS[input.id];
    if (!pair) return null;
    const startValue = document.getElementById(pair[0])?.value || "";
    const endValue = document.getElementById(pair[1])?.value || "";
    return {
        start: isValidISODate(startValue) ? startValue : "",
        end: isValidISODate(endValue) ? endValue : ""
    };
}

function renderDateMenu(input) {
    const view = enhancedDateInputs.get(input);
    if (!view) return;
    const selected = isValidISODate(input.value) ? input.value : "";
    const todayISO = toISO(today);
    const range = dateRangeForInput(input);
    const rangeFrom = range?.start && range?.end ? [range.start, range.end].sort()[0] : "";
    const rangeTo = range?.start && range?.end ? [range.start, range.end].sort()[1] : "";
    const first = new Date(view.viewYear, view.viewMonth - 1, 1);
    const start = new Date(view.viewYear, view.viewMonth - 1, 1 - (first.getDay() + 6) % 7); // 周一起始
    const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

    const cells = [];
    for (let i = 0; i < 42; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const iso = toISO(date);
        const classes = [
            "date-day",
            date.getMonth() + 1 === view.viewMonth ? "" : "outside",
            date.getDay() === 0 || date.getDay() === 6 ? "is-weekend" : "",
            iso === todayISO ? "is-today" : "",
            iso === selected ? "is-selected" : "",
            iso === range?.start ? "is-range-start" : "",
            iso === range?.end ? "is-range-end" : "",
            rangeFrom && iso > rangeFrom && iso < rangeTo ? "is-in-range" : ""
        ].filter(Boolean).join(" ");
        const ariaCurrent = iso === todayISO ? ` aria-current="date"` : "";
        const ariaPressed = iso === selected ? ` aria-pressed="true"` : "";
        cells.push(`<button type="button" class="${classes}" data-date-pick="${iso}" aria-label="${iso}"${ariaCurrent}${ariaPressed}><span>${date.getDate()}</span></button>`);
    }

    // 标题拆成两个文本节点：“7月”命中词典（→ Jul），“2026 年”走 i18n 正则
    view.menu.innerHTML = `
  <div class="date-menu-head">
    <button type="button" class="date-nav date-nav-year" data-date-nav="-12" title="上一年" aria-label="上一年"><i class="ph ph-caret-double-left icon" aria-hidden="true"></i></button>
    <button type="button" class="date-nav" data-date-nav="-1" title="上月" aria-label="上月"><i class="ph ph-caret-left icon" aria-hidden="true"></i></button>
    <span class="date-menu-title"><span>${view.viewYear} 年</span> <span>${view.viewMonth}月</span></span>
    <button type="button" class="date-nav" data-date-nav="1" title="下月" aria-label="下月"><i class="ph ph-caret-right icon" aria-hidden="true"></i></button>
    <button type="button" class="date-nav date-nav-year" data-date-nav="12" title="下一年" aria-label="下一年"><i class="ph ph-caret-double-right icon" aria-hidden="true"></i></button>
  </div>
  ${range?.start || range?.end ? `<div class="date-range-summary"><span>范围</span><strong>${escapeHtml(range.start || "…")} → ${escapeHtml(range.end || "…")}</strong></div>` : ""}
  <div class="date-menu-week">${weekdays.map(day => `<span>${day}</span>`).join("")}</div>
  <div class="date-menu-grid">${cells.join("")}</div>
  <div class="date-menu-foot">
    <button type="button" class="date-action" data-date-clear>清空</button>
    <button type="button" class="date-action date-action-primary" data-date-today>今天</button>
  </div>
`;
    if (view.box.classList.contains("open") && view.menu.classList.contains("is-portal")) {
        window.requestAnimationFrame(() => positionDateMenu(input));
    }
}

function toggleDateMenu(input) {
    const view = enhancedDateInputs.get(input);
    if (!view) return;
    if (view.box.classList.contains("open")) closeDateMenu(input);
    else openDateMenu(input);
}

function openDateMenu(input) {
    const view = enhancedDateInputs.get(input);
    if (!view) return;
    closeAllEnhancedSelects();
    closeAllDateMenus(input);
    const base = isValidISODate(input.value) ? fromISO(input.value) : today;
    view.viewYear = base.getFullYear();
    view.viewMonth = base.getMonth() + 1;
    renderDateMenu(input);
    view.box.classList.add("open");
    view.trigger.setAttribute("aria-expanded", "true");
    // 月历挂到 body，避开 details/modal 的 overflow 裁切，再按可用空间上下翻转。
    view.menu.classList.add("is-portal");
    view.menu.style.visibility = "hidden";
    document.body.appendChild(view.menu);
    positionDateMenu(input);
    view.menu.style.visibility = "";
    (view.menu.querySelector(".date-day.is-selected")
        || view.menu.querySelector(".date-day.is-today")
        || view.menu.querySelector(".date-day"))?.focus();
}

function positionDateMenu(input) {
    const view = enhancedDateInputs.get(input);
    if (!view?.box.classList.contains("open") || !view.menu.classList.contains("is-portal")) return;
    const margin = 10;
    const gap = 8;
    const triggerRect = view.trigger.getBoundingClientRect();
    const menuRect = view.menu.getBoundingClientRect();
    const menuWidth = Math.min(menuRect.width, window.innerWidth - margin * 2);
    const left = Math.min(
        Math.max(margin, triggerRect.left),
        Math.max(margin, window.innerWidth - menuWidth - margin)
    );
    const spaceBelow = window.innerHeight - triggerRect.bottom - gap - margin;
    const spaceAbove = triggerRect.top - gap - margin;
    const placeAbove = menuRect.height > spaceBelow && spaceAbove > spaceBelow;
    const idealTop = placeAbove
        ? Math.max(margin, triggerRect.top - menuRect.height - gap)
        : Math.min(triggerRect.bottom + gap, window.innerHeight - menuRect.height - margin);
    const top = Math.min(
        Math.max(margin, idealTop),
        Math.max(margin, window.innerHeight - menuRect.height - margin)
    );
    view.menu.style.left = `${left}px`;
    view.menu.style.top = `${top}px`;
    view.menu.style.setProperty(
        "--date-anchor-x",
        `${Math.min(Math.max(20, triggerRect.left + triggerRect.width / 2 - left), menuWidth - 20)}px`
    );
    view.menu.dataset.placement = placeAbove ? "top" : "bottom";
}

function repositionOpenDateMenus() {
    enhancedDateInputs.forEach((view, input) => {
        if (view.box.classList.contains("open")) positionDateMenu(input);
    });
}

function closeDateMenu(input, returnFocus = false) {
    const view = enhancedDateInputs.get(input);
    if (!view) return;
    view.box.classList.remove("open");
    view.trigger.setAttribute("aria-expanded", "false");
    view.menu.classList.remove("is-portal");
    view.menu.removeAttribute("data-placement");
    view.menu.removeAttribute("style");
    view.box.appendChild(view.menu);
    if (returnFocus) view.trigger.focus();
}

function closeAllDateMenus(exceptInput = null) {
    enhancedDateInputs.forEach((_, input) => {
        if (input !== exceptInput) closeDateMenu(input);
    });
}

function commitDateValue(input, iso) {
    const pair = DATE_RANGE_PAIRS[input.id];
    if (pair && isValidISODate(iso)) {
        const isStart = input.id === pair[0];
        const peer = document.getElementById(isStart ? pair[1] : pair[0]);
        const peerValue = peer?.value || "";
        const crossesPeer = isValidISODate(peerValue) && (isStart ? peerValue < iso : peerValue > iso);
        if (peer && crossesPeer) {
            peer.value = iso;
            peer.dispatchEvent(new Event("input", {bubbles: true}));
            peer.dispatchEvent(new Event("change", {bubbles: true}));
        }
    }
    input.value = iso;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    input.dispatchEvent(new Event("change", {bubbles: true}));
}

function handleDateMenuClick(event, input) {
    event.stopPropagation();
    const view = enhancedDateInputs.get(input);
    if (!view) return;
    const nav = event.target.closest("[data-date-nav]");
    if (nav) {
        event.preventDefault();
        const next = new Date(view.viewYear, view.viewMonth - 1 + Number(nav.dataset.dateNav), 1);
        view.viewYear = next.getFullYear();
        view.viewMonth = next.getMonth() + 1;
        renderDateMenu(input);
        return;
    }
    const day = event.target.closest("[data-date-pick]");
    if (day) {
        commitDateValue(input, day.dataset.datePick);
        closeDateMenu(input, true);
        return;
    }
    if (event.target.closest("[data-date-clear]")) {
        commitDateValue(input, "");
        closeDateMenu(input, true);
        return;
    }
    if (event.target.closest("[data-date-today]")) {
        commitDateValue(input, toISO(today));
        closeDateMenu(input, true);
    }
}

function handleDateMenuKeydown(event, input) {
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeDateMenu(input, true);
        return;
    }
    const steps = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7};
    const day = event.target.closest("[data-date-pick]");
    if (!day || !(event.key in steps)) return;
    event.preventDefault();
    const view = enhancedDateInputs.get(input);
    const target = fromISO(day.dataset.datePick);
    target.setDate(target.getDate() + steps[event.key]);
    const iso = toISO(target);
    let cell = view.menu.querySelector(`[data-date-pick="${iso}"]`);
    if (!cell) {
        view.viewYear = target.getFullYear();
        view.viewMonth = target.getMonth() + 1;
        renderDateMenu(input);
        cell = view.menu.querySelector(`[data-date-pick="${iso}"]`);
    }
    cell?.focus();
}
