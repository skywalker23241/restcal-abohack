/* 休历 · RestCal —— 车站、机场与分段路线 */

function syncStationPickerTriggers() {
    document.querySelectorAll("[data-station-target]").forEach(button => {
        const name = document.getElementById(button.dataset.stationTarget).value;
        const label = getStationPickerTitle(button.dataset.stationTarget);
        button.querySelector("span").textContent = name || (window.RestCalI18n?.t(label) || label);
        button.classList.toggle("has-station", Boolean(name));
    });
}

function getStationPickerTitle(target) {
    return {ticketOrigin: "选择出发站", ticketDestination: "选择到达站", flightOrigin: "选择出发机场", flightDestination: "选择到达机场"}[target] || "选择中转站";
}

function openStationPicker(target) {
    stationPickerTarget = target;
    const search = document.getElementById("stationPickerSearch");
    search.value = "";
    const flight = target.startsWith("flight");
    const title = getStationPickerTitle(target);
    const label = text => window.RestCalI18n?.t(text) || text;
    document.getElementById("stationPickerTitle").textContent = label(title);
    search.placeholder = label(flight ? "搜索机场、城市、拼音或首字母" : "搜索站名、拼音或首字母");
    search.setAttribute("aria-label", label(flight ? "搜索机场" : "搜索车站"));
    document.getElementById("stationPickerSubtitle").textContent = label(flight ? "按拼音首字母浏览内地机场，或搜索机场和城市。" : "按拼音首字母浏览，或搜索站名和拼音。");
    document.getElementById("stationPickerCountLabel").textContent = label(flight ? "内地机场" : "全部站点");
    document.getElementById("stationPickerModal").classList.toggle("is-airport-picker", flight);
    renderStationPicker();
    openBackdrop(document.getElementById("stationPickerModal"));
    search.focus({preventScroll: true});
}

function closeStationPicker() {
    const target = stationPickerTarget;
    closeBackdrop(document.getElementById("stationPickerModal"));
    window.setTimeout(() => {
        if (!document.getElementById("stationPickerModal").classList.contains("open")) document.querySelector(`[data-station-target="${target}"]`)?.focus({preventScroll: true});
    }, 210);
}

function chooseRailwayStation(name) {
    const input = document.getElementById(stationPickerTarget);
    const airports = stationPickerTarget.startsWith("flight");
    const source = airports ? window.RESTCAL_AIRPORTS : window.RESTCAL_RAILWAY_STATIONS;
    const other = document.getElementById(stationPickerTarget === "flightOrigin" ? "flightDestination" : "flightOrigin");
    if (!input || (name && !Object.hasOwn(source, name)) || (airports && name && other.value === name)) return;
    input.value = name;
    input.dispatchEvent(new Event("input", {bubbles: true}));
    input.dispatchEvent(new Event("change", {bubbles: true}));
    if (stationPickerTarget.startsWith("ticketTransfer-")) persistTicketTransfers();
    syncStationPickerTriggers();
    renderTicketReminders();
    renderTicketRouteQueries();
    renderFlightRoutePreview();
    closeStationPicker();
}

function renderStationPicker() {
    const query = document.getElementById("stationPickerSearch").value.trim().toLowerCase().replace(/\s+/g, "");
    const selected = document.getElementById(stationPickerTarget)?.value;
    const flight = stationPickerTarget.startsWith("flight");
    const others = new Set([...document.querySelectorAll(flight ? "#flightOrigin, #flightDestination" : "#ticketOrigin, #ticketDestination, #ticketTransferStations input")].filter(input => input.id !== stationPickerTarget).map(input => input.value).filter(Boolean));
    const entries = Object.entries(flight ? window.RESTCAL_AIRPORTS : window.RESTCAL_RAILWAY_STATIONS).map(([name, value]) => {
        const [pinyin, initials, province] = (flight ? value : window.RESTCAL_RAILWAY_STATION_PINYIN[name]) || ["", ""];
        return {name, code: flight ? province : value, pinyin, initials, letter: pinyin.charAt(0).toUpperCase() || "#"};
    }).filter(item => !query || [item.name, item.pinyin, item.initials, item.code.toLowerCase()].some(value => value.includes(query))).sort((a, b) => a.pinyin.localeCompare(b.pinyin));
    const groups = new Map();
    entries.forEach(item => {
        if (!groups.has(item.letter)) groups.set(item.letter, []);
        groups.get(item.letter).push(item);
    });
    const list = document.getElementById("stationPickerList");
    list.innerHTML = entries.length ? [...groups].map(([letter, items]) => `<section class="station-letter-group" id="station-letter-${letter}" aria-labelledby="station-heading-${letter}"><h3 id="station-heading-${letter}">${letter}</h3><div class="station-choice-grid">${items.map(item => `<button class="station-choice" type="button" data-station-name="${escapeHtml(item.name)}" aria-pressed="${item.name === selected}" ${others.has(item.name) ? "disabled" : ""}><span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.pinyin)}</small></button>`).join("")}</div></section>`).join("") : `<div class="empty-state">${window.RestCalI18n?.t(flight ? "未找到机场，试试城市或拼音。" : "未找到车站，试试站名或拼音。") || (flight ? "未找到机场，试试城市或拼音。" : "未找到车站，试试站名或拼音。")}</div>`;
    list.scrollTop = 0;
    document.getElementById("stationPickerCount").textContent = String(entries.length);
    document.getElementById("stationPickerIndex").innerHTML = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(letter => `<button type="button" data-station-letter="${letter}" ${groups.has(letter) ? "" : "disabled"}>${letter}</button>`).join("");
}

function initStationPicker() {
    const modal = document.getElementById("stationPickerModal");
    document.addEventListener("click", async event => {
        const airlinePicker = event.target.closest(".airline-picker");
        document.querySelectorAll(".airline-picker[open]").forEach(picker => {
            if (picker !== airlinePicker || event.target.closest(".airline-picker-options a")) picker.open = false;
        });
        const button = event.target.closest("[data-station-target]");
        if (button) openStationPicker(button.dataset.stationTarget);
        const copy = event.target.closest("[data-copy-ticket-route]");
        if (copy) {
            try {
                const route = copy.dataset.routeMode === "flight" ? getFlightRoute(copy.dataset.copyTicketRoute) : getTicketRoute(copy.dataset.copyTicketRoute);
                await navigator.clipboard.writeText(`${copy.dataset.routeDate} ${route.join(" → ")}`);
                showToast("行程已复制");
            } catch { showToast("复制失败，请手动复制路线", "error"); }
        }
    });
    document.getElementById("addTicketTransfer").addEventListener("click", () => {
        renderTicketTransferStations([...readTicketTransfers(), ""]);
        const inputs = document.querySelectorAll("#ticketTransferStations input");
        openStationPicker(inputs[inputs.length - 1].id);
    });
    document.getElementById("ticketTransferStations").addEventListener("click", event => {
        const button = event.target.closest("[data-transfer-action]");
        if (!button) return;
        const names = readTicketTransfers();
        const index = Number(button.dataset.transferIndex);
        if (button.dataset.transferAction === "remove") names.splice(index, 1);
        else {
            const other = index + (button.dataset.transferAction === "up" ? -1 : 1);
            if (other < 0 || other >= names.length) return;
            [names[index], names[other]] = [names[other], names[index]];
        }
        renderTicketTransferStations(names);
        persistTicketTransfers();
    });
    document.getElementById("closeStationPicker").addEventListener("click", closeStationPicker);
    document.getElementById("clearStationSelection").addEventListener("click", () => chooseRailwayStation(""));
    document.getElementById("stationPickerSearch").addEventListener("input", renderStationPicker);
    modal.addEventListener("click", event => {
        if (event.target === modal) return closeStationPicker();
        const station = event.target.closest("[data-station-name]");
        if (station && !station.disabled) return chooseRailwayStation(station.dataset.stationName);
        const letter = event.target.closest("[data-station-letter]");
        if (letter && !letter.disabled) {
            const list = document.getElementById("stationPickerList");
            const group = document.getElementById(`station-letter-${letter.dataset.stationLetter}`);
            list.scrollTop = group.offsetTop;
            modal.querySelectorAll("[data-station-letter]").forEach(button => button.classList.toggle("active", button === letter));
        }
    });
}

function readTicketTransfers() {
    return [...document.querySelectorAll("#ticketTransferStations input")].map(input => input.value);
}

function renderTicketTransferStations(names = state.ticketPreferences.transfers || []) {
    document.getElementById("ticketTransferStations").innerHTML = names.length ? names.map((name, index) => `<div class="ticket-transfer-row"><span class="ticket-transfer-number">${index + 1}</span><input id="ticketTransfer-${index}" type="hidden" value="${escapeHtml(name)}"><button class="station-picker-trigger" type="button" data-station-target="ticketTransfer-${index}" aria-label="${escapeHtml((window.RestCalI18n?.t("选择中转站") || "选择中转站") + " " + (index + 1))}" aria-haspopup="dialog" aria-controls="stationPickerModal"><span></span><i class="ph ph-caret-down" aria-hidden="true"></i></button><div class="ticket-transfer-actions">${[["up", "上移", index === 0], ["down", "下移", index === names.length - 1], ["remove", "删除", false]].map(([action, label, disabled]) => `<button class="btn ghost" type="button" data-transfer-action="${action}" data-transfer-index="${index}" ${disabled ? "disabled" : ""}>${window.RestCalI18n?.t(label) || label}</button>`).join("")}</div></div>`).join("") : `<p class="notice">${window.RestCalI18n?.t("未设置中转站，按直达路线查询。") || "未设置中转站，按直达路线查询。"}</p>`;
    syncStationPickerTriggers();
}

function persistTicketTransfers() {
    syncSettingsFromInputs();
    saveState();
    renderTicketReminders();
    renderTicketRouteQueries();
}

function getTicketRoute(tripType) {
    const preferences = normalizeTicketPreferences(state.ticketPreferences);
    const route = [preferences.origin, ...preferences.transfers, preferences.destination];
    return tripType === "return" ? route.reverse() : route;
}

function getFlightRoute(tripType) {
    const preferences = normalizeTicketPreferences(state.ticketPreferences);
    const route = [preferences.flightOrigin, preferences.flightDestination];
    return tripType === "return" ? route.reverse() : route;
}

function flightRouteMarkup(tripType, departure) {
    const route = getFlightRoute(tripType);
    if (!route.every(name => Object.hasOwn(window.RESTCAL_AIRPORTS, name)) || route[0] === route[1]) return "";
    const label = text => window.RestCalI18n?.t(text) || text;
    return `<div class="flight-route-itinerary"><div class="ticket-route"><i class="ph ph-airplane-tilt icon" aria-hidden="true"></i> ${route.map(escapeHtml).join(" → ")}</div><small>${toISO(departure)}</small><div class="ticket-transfer-query-actions">${airlineSelectorMarkup(tripType, departure)}<button class="btn ghost" type="button" data-copy-ticket-route="${tripType}" data-route-mode="flight" data-route-date="${toISO(departure)}">${label("复制机票行程")}</button></div></div>`;
}

function buildAirlineUrl(airline, tripType, departure) {
    if (airline === "airchina") return "https://www.airchina.com.cn/zh-CN";
    if (airline !== "csair") return null;
    const base = "https://b2c.csair.com/B2CNew/flight/search";
    const route = getFlightRoute(tripType);
    const codes = window.RESTCAL_AIRPORT_CODES || {};
    const from = codes[route[0]], to = codes[route[1]];
    if (!from || !to || from === to) return base;
    return `${base}?${new URLSearchParams({c1: from, c2: to, d1: toISO(departure), at: "1", ct: "0", it: "0", t: "S"})}`;
}

function airlineSelectorMarkup(tripType, departure) {
    const label = text => window.RestCalI18n?.t(text) || text;
    const southern = buildAirlineUrl("csair", tripType, departure);
    return `<details class="airline-picker"><summary class="btn"><i class="ph ph-airplane-tilt icon" aria-hidden="true"></i>${label("航空公司官网")}<i class="ph ph-caret-down" aria-hidden="true"></i></summary><div class="airline-picker-options"><a href="${buildAirlineUrl("airchina", tripType, departure)}" target="_blank" rel="noopener noreferrer"><span>${label("国航官网")}</span><small>${label("手动填写")}</small></a><a href="${escapeHtml(southern)}" target="_blank" rel="noopener noreferrer"><span>${label("南航官网")}</span><small>${label(southern.includes("?c1=") ? "携带机场日期" : "手动填写")}</small></a></div></details>`;
}

function renderFlightRoutePreview() {
    const trips = getTicketReminders(currentYear);
    document.getElementById("flightRoutePreview").innerHTML = ["outbound", "return"].map(type => {
        const departure = trips.find(item => item.tripType === type && diffDays(today, item.departure) >= 0)?.departure || today;
        const markup = flightRouteMarkup(type, departure);
        return markup ? `<div><strong>${window.RestCalI18n?.t(type === "return" ? "返程" : "去程") || (type === "return" ? "返程" : "去程")}</strong>${markup}</div>` : "";
    }).join("");
}

function build12306SegmentUrl(from, to, departure) {
    const stations = window.RESTCAL_RAILWAY_STATIONS || {};
    if (!Object.hasOwn(stations, from) || !Object.hasOwn(stations, to) || from === to) return null;
    return `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=${encodeURIComponent(from)},${stations[from]}&ts=${encodeURIComponent(to)},${stations[to]}&date=${toISO(departure)}&flag=N,N,N`;
}

function build12306Url(tripType, departure) {
    const route = getTicketRoute(tripType);
    return build12306SegmentUrl(route[0], route[route.length - 1], departure);
}

function ticketRouteQueryMarkup(tripType, departure) {
    const route = getTicketRoute(tripType);
    if (route.length < 3 || !route.every(name => Object.hasOwn(window.RESTCAL_RAILWAY_STATIONS, name)) || new Set(route).size !== route.length) return "";
    const label = text => window.RestCalI18n?.t(text) || text;
    return `<details class="ticket-segment-queries"><summary>${label("逐段查询")} · ${route.length - 1}</summary><div class="ticket-segment-links">${route.slice(0, -1).map((from, index) => `<a class="btn" href="${escapeHtml(build12306SegmentUrl(from, route[index + 1], departure))}" target="_blank" rel="noopener noreferrer">${index + 1}. ${escapeHtml(from)} → ${escapeHtml(route[index + 1])}</a>`).join("")}</div></details><div class="ticket-transfer-query-actions"><a class="btn" href="https://kyfw.12306.cn/otn/lcQuery/init" target="_blank" rel="noopener noreferrer">${label("中转换乘方案")}</a><button class="btn ghost" type="button" data-copy-ticket-route="${tripType}" data-route-date="${toISO(departure)}">${label("复制行程")}</button></div><p class="notice">${label("换乘查询可能需登录并手动填写中转站；多次中转请逐段查询，跨日请调整日期。")}</p>`;
}

function renderTicketRouteQueries() {
    const trips = getTicketReminders(currentYear);
    document.getElementById("ticketRouteQueries").innerHTML = ["outbound", "return"].map(type => {
        const departure = trips.find(item => item.tripType === type && diffDays(today, item.departure) >= 0)?.departure || today;
        const markup = ticketRouteQueryMarkup(type, departure);
        return markup ? `<div><strong>${window.RestCalI18n?.t(type === "return" ? "返程" : "去程") || (type === "return" ? "返程" : "去程")} · ${toISO(departure)}</strong>${markup}</div>` : "";
    }).join("");
}
