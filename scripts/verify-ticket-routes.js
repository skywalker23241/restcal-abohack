const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow} = require("electron");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "restcal-ticket-routes-"));
app.setPath("userData", userData);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const testPort = process.env.RESTCAL_TEST_PORT || "8877";
process.env.PORT = testPort;

async function run() {
    require("../server.js");
    const win = new BrowserWindow({show: false, width: 1100, height: 850, webPreferences: {offscreen: true, backgroundThrottling: false}});
    win.webContents.on("console-message", (_event, level, message) => { if (level >= 2) console.error(message); });
    const js = source => win.webContents.executeJavaScript(source);
    await win.loadURL(`http://127.0.0.1:${testPort}/app`);
    await wait(1000);
    const startup = await js(`({
        error: document.getElementById("calendarGrid").textContent.includes("初始化异常"),
        days: document.getElementById("calendarGrid").querySelectorAll("[data-date]").length,
        onboarding: document.getElementById("onboardingBackdrop").classList.contains("open")
    })`);
    assert.equal(startup.error, false, "Startup must not show an initialization error");
    assert.ok(startup.days >= 28, "Startup must render calendar days before tests interact with the page");
    assert.equal(startup.onboarding, true, "Fresh profile must open first-run onboarding");
    await js('closeOnboarding();');
    const result = await js(`(() => {
        closeModal(); openSettings("tickets");
        for (const [id, value] of [["ticketOrigin", "北京南"], ["ticketDestination", "上海虹桥"]]) {
            document.querySelector('[data-station-target="' + id + '"]').click();
            const search = document.getElementById("stationPickerSearch");
            search.value = value;
            search.dispatchEvent(new Event("input"));
            document.querySelector('[data-station-name="' + value + '"]').click();
        }
        const outbound = build12306Url("outbound", fromISO("2026-10-16"));
        const returning = build12306Url("return", fromISO("2026-10-20"));
        const backup = backupUserDataSnapshot();
        state.ticketPreferences = normalizeTicketPreferences({origin: "unknown", destination: "上海虹桥"});
        const invalid = build12306Url("outbound", today);
        state.ticketPreferences = normalizeTicketPreferences({origin: "北京南", destination: "北京南"});
        const sameStation = build12306Url("outbound", today);
        restoreUserDataBackup(backup); fillSettingsInputs();
        const oldBackup = normalizeTicketPreferences({advanceDays: 14});
        return {outbound, returning, invalid, sameStation,
            restored: [state.ticketPreferences.origin, state.ticketPreferences.destination],
            stored: JSON.parse(localStorage.getItem(STORAGE_KEY)).ticketPreferences.origin,
            defaults: [oldBackup.origin, oldBackup.destination],
            stations: Object.keys(window.RESTCAL_RAILWAY_STATIONS).length};
    })()`);
    const outbound = new URL(result.outbound);
    const returning = new URL(result.returning);
    assert.equal(outbound.origin, "https://kyfw.12306.cn");
    assert.equal(outbound.searchParams.get("fs"), "北京南,VNP");
    assert.equal(outbound.searchParams.get("ts"), "上海虹桥,AOH");
    assert.equal(outbound.searchParams.get("date"), "2026-10-16");
    assert.ok(decodeURI(result.outbound).includes("fs=北京南,VNP&ts=上海虹桥,AOH"), "12306 decodeURI parser needs literal commas");
    assert.equal(returning.searchParams.get("fs"), "上海虹桥,AOH");
    assert.equal(returning.searchParams.get("ts"), "北京南,VNP");
    assert.equal(returning.searchParams.get("date"), "2026-10-20");
    assert.equal(result.invalid, null);
    assert.equal(result.sameStation, null);
    assert.deepEqual(result.restored, ["北京南", "上海虹桥"]);
    assert.equal(result.stored, "北京南");
    assert.deepEqual(result.defaults, ["", ""]);
    assert.ok(result.stations > 3000);
    const transfer = await js(`(() => {
        for (const name of ["济南西", "南京南"]) {
            document.getElementById("addTicketTransfer").click();
            chooseRailwayStation(name);
        }
        const added = [...state.ticketPreferences.transfers];
        document.querySelector('[data-transfer-action="up"][data-transfer-index="1"]').click();
        const moved = [...state.ticketPreferences.transfers];
        document.querySelector('[data-transfer-action="down"][data-transfer-index="0"]').click();
        const outbound = getTicketRoute("outbound"), returning = getTicketRoute("return");
        const host = document.getElementById("ticketRouteQueries");
        const legs = [...host.querySelectorAll(".ticket-segment-links a")].map(a => a.href);
        const official = host.querySelector(".ticket-transfer-query-actions a").href;
        const backup = backupUserDataSnapshot();
        document.querySelector('[data-transfer-action="remove"][data-transfer-index="0"]').click();
        const removed = [...state.ticketPreferences.transfers];
        restoreUserDataBackup(backup); fillSettingsInputs(); saveState();
        const normalized = normalizeTicketPreferences({origin: 123, destination: null, transfers: [null, "unknown", "济南西", "济南西"]}).transfers;
        return {added, moved, outbound, returning, legs, official, removed, normalized, restored: state.ticketPreferences.transfers};
    })()`);
    assert.deepEqual(transfer.added, ["济南西", "南京南"]);
    assert.deepEqual(transfer.moved, ["南京南", "济南西"]);
    assert.deepEqual(transfer.outbound, ["北京南", "济南西", "南京南", "上海虹桥"]);
    assert.deepEqual(transfer.returning, [...transfer.outbound].reverse());
    assert.deepEqual(transfer.removed, ["南京南"]);
    assert.deepEqual(transfer.restored, transfer.added);
    assert.deepEqual(transfer.normalized, ["济南西"]);
    assert.equal(transfer.legs.length, 6);
    assert.equal(new URL(transfer.legs[0]).searchParams.get("ts"), "济南西,JGK");
    assert.equal(new URL(transfer.legs[3]).searchParams.get("fs"), "上海虹桥,AOH");
    assert.equal(transfer.official, "https://kyfw.12306.cn/otn/lcQuery/init");
    const flightHosts = await js('[...document.querySelectorAll("#flightBookingLink a")].map(a => new URL(a.href).hostname)');
    assert.deepEqual(flightHosts, ["www.airchina.com.cn", "b2c.csair.com"]);
    const picker = await js(`(() => {
        openStationPicker("ticketOrigin");
        const all = document.querySelectorAll("[data-station-name]").length;
        document.querySelector('[data-station-letter="S"]').click();
        const jumped = document.getElementById("stationPickerList").scrollTop > 0;
        const search = document.getElementById("stationPickerSearch");
        const found = [];
        for (const query of ["北京南", "beijingnan", "bjn"]) {
            search.value = query; search.dispatchEvent(new Event("input"));
            found.push(Boolean(document.querySelector('[data-station-name="北京南"]')));
        }
        search.value = "上海虹桥"; search.dispatchEvent(new Event("input"));
        const sameStationDisabled = document.querySelector('[data-station-name="上海虹桥"]').disabled;
        search.value = "unknown_station_xyz"; search.dispatchEvent(new Event("input"));
        const empty = document.querySelectorAll("[data-station-name]").length === 0;
        closeStationPicker();
        return {all, jumped, found, sameStationDisabled, empty};
    })()`);
    assert.equal(picker.all, result.stations);
    assert.equal(picker.jumped, true);
    assert.deepEqual(picker.found, [true, true, true]);
    assert.equal(picker.sameStationDisabled, true);
    assert.equal(picker.empty, true);
    const airports = await js(`(() => {
        document.getElementById("flightOriginPicker").click();
        const all = document.querySelectorAll("[data-station-name]").length;
        document.querySelector('[data-station-letter="S"]').click();
        const jumped = document.getElementById("stationPickerList").scrollTop > 0;
        const search = document.getElementById("stationPickerSearch");
        const found = [];
        for (const query of ["北京", "beijing", "bjsd"]) {
            search.value = query; search.dispatchEvent(new Event("input"));
            found.push(Boolean(document.querySelector('[data-station-name="北京首都国际机场"]')));
        }
        search.value = "unknown_airport"; search.dispatchEvent(new Event("input"));
        const empty = document.querySelectorAll("[data-station-name]").length === 0;
        chooseRailwayStation("北京南");
        const wrongTypeRejected = document.getElementById("flightOrigin").value === "";
        search.value = "首都"; search.dispatchEvent(new Event("input"));
        document.querySelector('[data-station-name="北京首都国际机场"]').click();
        document.getElementById("flightDestinationPicker").click();
        search.value = "北京首都"; search.dispatchEvent(new Event("input"));
        const duplicateDisabled = document.querySelector('[data-station-name="北京首都国际机场"]').disabled;
        chooseRailwayStation("北京首都国际机场");
        const duplicateRejected = document.getElementById("flightDestination").value === "";
        search.value = "上海浦东"; search.dispatchEvent(new Event("input"));
        document.querySelector('[data-station-name="上海浦东国际机场"]').click();
        const outbound = getFlightRoute("outbound"), returning = getFlightRoute("return");
        const backup = backupUserDataSnapshot();
        openStationPicker("flightOrigin"); document.getElementById("clearStationSelection").click();
        const cleared = state.ticketPreferences.flightOrigin === "" && document.getElementById("flightRoutePreview").innerHTML === "";
        restoreUserDataBackup(backup); fillSettingsInputs(); saveState();
        const old = normalizeTicketPreferences({advanceDays: 14});
        const invalid = normalizeTicketPreferences({flightOrigin: "北京南", flightDestination: 12});
        const duplicate = normalizeTicketPreferences({flightOrigin: "北京首都国际机场", flightDestination: "北京首都国际机场"});
        return {all, jumped, found, empty, wrongTypeRejected, duplicateDisabled, duplicateRejected, outbound, returning, cleared,
            old: [old.flightOrigin, old.flightDestination], invalid: [invalid.flightOrigin, invalid.flightDestination], duplicate: duplicate.flightDestination,
            trains: getTicketRoute("outbound")};
    })()`);
    assert.equal(airports.all, 270);
    assert.equal(airports.jumped, true);
    assert.deepEqual(airports.found, [true, true, true]);
    for (const key of ["empty", "wrongTypeRejected", "duplicateDisabled", "duplicateRejected", "cleared"]) assert.equal(airports[key], true, key);
    assert.deepEqual(airports.outbound, ["北京首都国际机场", "上海浦东国际机场"]);
    assert.deepEqual(airports.returning, [...airports.outbound].reverse());
    assert.deepEqual(airports.old, ["", ""]);
    assert.deepEqual(airports.invalid, ["", ""]);
    assert.equal(airports.duplicate, "");
    assert.deepEqual(airports.trains, transfer.outbound);
    const airline = await js(`(() => {
        const date = addDays(today, 1);
        const outbound = buildAirlineUrl("csair", "outbound", date), returning = buildAirlineUrl("csair", "return", date);
        const backup = state.ticketPreferences;
        state.ticketPreferences = {...backup, flightOrigin: "阿里普兰机场"};
        const fallback = buildAirlineUrl("csair", "outbound", date);
        state.ticketPreferences = backup;
        return {outbound, returning, date: toISO(date), fallback, unknown: buildAirlineUrl("unknown", "outbound", date)};
    })()`);
    assert.equal(new URL(airline.outbound).searchParams.get("c1"), "PEK");
    assert.equal(new URL(airline.outbound).searchParams.get("c2"), "PVG");
    assert.equal(new URL(airline.outbound).searchParams.get("d1"), airline.date);
    assert.equal(new URL(airline.returning).searchParams.get("c1"), "PVG");
    assert.equal(new URL(airline.returning).searchParams.get("c2"), "PEK");
    assert.equal(airline.fallback, "https://b2c.csair.com/B2CNew/flight/search");
    assert.equal(airline.unknown, null);
    const copied = await js(`(async () => {
        let copied = "";
        Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText: async value => {copied = value;}}});
        document.querySelector('#flightRoutePreview [data-copy-ticket-route="return"]').click();
        await new Promise(resolve => setTimeout(resolve, 20));
        return copied;
    })()`);
    assert.ok(copied.includes("上海浦东国际机场 → 北京首都国际机场"));
    const shots = path.join(__dirname, "shots");
    fs.mkdirSync(shots, {recursive: true});
    for (const width of [1100, 360]) {
        win.setContentSize(width, 850);
        await js('openSettings("tickets"); document.querySelector(".ticket-route-settings").scrollIntoView({block: "center"});');
        win.webContents.invalidate(); await wait(350);
        assert.equal(await js('document.querySelector(".ticket-route-settings").scrollWidth <= document.querySelector(".ticket-route-settings").clientWidth'), true);
        fs.writeFileSync(path.join(shots, `ticket-route-settings-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await js(`localStorage.setItem(THEME_KEY, "${width === 360 ? "dark" : "light"}"); applyTheme("${width === 360 ? "dark" : "light"}"); openStationPicker("ticketOrigin"); document.querySelector('[data-station-letter="B"]').click();`);
        win.webContents.invalidate(); await wait(400);
        assert.equal(await js('document.querySelector(".station-picker-dialog").scrollWidth <= document.querySelector(".station-picker-dialog").clientWidth'), true);
        fs.writeFileSync(path.join(shots, `station-picker-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await js('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));');
        await wait(250);
        assert.equal(await js('document.getElementById("stationPickerModal").classList.contains("open")'), false);
        await js('document.querySelector(".flight-route-settings").scrollIntoView({block: "center"});');
        win.webContents.invalidate(); await wait(350);
        assert.equal(await js('document.querySelector(".flight-route-settings").scrollWidth <= document.querySelector(".flight-route-settings").clientWidth'), true);
        fs.writeFileSync(path.join(shots, `flight-route-settings-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await js('openStationPicker("flightOrigin"); document.querySelector(\'[data-station-letter="B"]\').click();');
        win.webContents.invalidate(); await wait(350);
        assert.equal(await js('document.querySelector(".station-picker-dialog").scrollWidth <= document.querySelector(".station-picker-dialog").clientWidth'), true);
        fs.writeFileSync(path.join(shots, `airport-picker-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await js('closeStationPicker();'); await wait(250);
    }
    await js(`(() => {
        closeSettings(); currentYear = 2026;
        const original = getTicketReminders;
        try {
            const date = addDays(today, 5);
            getTicketReminders = () => [
                {name: "国庆节", tripType: "outbound", tripLabel: "去程", departure: date, saleDate: addDays(date, -14)},
                {name: "国庆节", tripType: "return", tripLabel: "返程", departure: addDays(date, 3), saleDate: addDays(date, -11)}
            ];
            renderTicketReminders();
        } finally { getTicketReminders = original; }
        switchView("tools"); openBackdrop(els.ticketToolPanel);
    })()`);
    const links = await js('[...document.querySelectorAll(".ticket-card-actions > a")].map(link => link.href)');
    assert.equal(links.length, 2);
    assert.equal(new URL(links[1]).searchParams.get("fs"), "上海虹桥,AOH");
    win.webContents.invalidate(); await wait(400);
    fs.writeFileSync(path.join(shots, "ticket-routes-mobile.png"), (await win.webContents.capturePage()).toPNG());
    await win.reload(); await wait(700);
    assert.deepEqual(await js('[state.ticketPreferences.origin, state.ticketPreferences.destination]'), ["北京南", "上海虹桥"]);
    assert.deepEqual(await js('state.ticketPreferences.transfers'), ["济南西", "南京南"]);
    assert.deepEqual(await js('getFlightRoute("outbound")'), ["北京首都国际机场", "上海浦东国际机场"]);
    if (process.argv.includes("--live")) {
        const southern = new BrowserWindow({show: false, webPreferences: {offscreen: true, backgroundThrottling: false}});
        await southern.loadURL(airline.outbound);
        let southernFields;
        for (let attempt = 0; attempt < 20; attempt++) {
            await wait(500);
            southernFields = await southern.webContents.executeJavaScript(`({inputs: [...document.querySelectorAll("input")].map(i => ({value: i.value, placeholder: i.placeholder})), text: document.body.innerText.slice(0,1200)})`);
            if (southernFields.inputs.some(i => i.value === airline.date)) break;
        }
        console.log("Live China Southern fields", southernFields);
        assert.ok(southernFields.inputs.some(i => i.value === airline.date), "Official site must prefill the flight date");
        assert.ok(southernFields.inputs.some(i => /北京|首都|PEK/.test(i.value)), "Official site must prefill origin");
        assert.ok(southernFields.inputs.some(i => /上海|浦东|PVG/.test(i.value)), "Official site must prefill destination");
        southern.destroy();
        const official = new BrowserWindow({show: false, webPreferences: {offscreen: true, backgroundThrottling: false}});
        await official.loadURL(result.outbound);
        await wait(1500);
        const fields = await official.webContents.executeJavaScript(`({from: document.getElementById("fromStationText")?.value, to: document.getElementById("toStationText")?.value, date: document.getElementById("train_date")?.value})`);
        assert.deepEqual(fields, {from: "北京南", to: "上海虹桥", date: "2026-10-16"});
        official.destroy();
        console.log("Live 12306 prefill verified", fields);
    }
    await js(`(() => {
        window.RestCalI18n.setLanguage("zh"); closeOnboarding(); closeSettings();
        const original = getTicketReminders;
        try {
            getTicketReminders = () => [{name: "国庆节", tripType: "outbound", tripLabel: "去程", departure: addDays(today, -10), saleDate: addDays(today, -24)}];
            renderTicketReminders();
        }
        finally { getTicketReminders = original; }
        openBackdrop(els.ticketToolPanel);
    })()`);
    const history = await js(`(() => {
        const details = document.querySelector(".ticket-history");
        const summary = details.querySelector("summary");
        const icon = summary.querySelector(".ticket-history-toggle .icon");
        const closed = getComputedStyle(icon).transform;
        summary.click();
        const opened = details.open;
        const rotated = getComputedStyle(icon).transform !== closed;
        summary.click();
        return {count: details.querySelector(".ticket-history-count").textContent, opened, rotated, collapsed: !details.open};
    })()`);
    assert.deepEqual(history, {count: "1", opened: true, rotated: true, collapsed: true});
    for (const width of [1100, 360]) {
        win.setContentSize(width, 850);
        await js('applyTheme("dark");');
        win.webContents.invalidate(); await wait(350);
        const footer = await js(`({
            count: document.querySelectorAll(".ticket-links > a, .ticket-links .airline-picker > summary").length,
            fits: document.querySelector(".ticket-guide").scrollWidth <= document.querySelector(".ticket-guide").clientWidth,
            short: document.getElementById("ticketGuideText").textContent.length < 40,
            hintRemoved: !document.getElementById("flightBookingHint")
        })`);
        assert.deepEqual(footer, {count: 3, fits: true, short: true, hintRemoved: true});
        fs.writeFileSync(path.join(shots, `ticket-footer-${width}.png`), (await win.webContents.capturePage()).toPNG());
        const closedRect = await js('(() => {const r = document.querySelector(".ticket-window").getBoundingClientRect(); return {width: r.width, height: r.height, top: r.top};})()');
        await js('document.querySelector("#flightBookingLink summary").click();');
        win.webContents.invalidate(); await wait(200);
        const popup = await js(`(() => {
            const picker = document.querySelector("#flightBookingLink .airline-picker");
            const trigger = picker.querySelector("summary").getBoundingClientRect();
            const menu = picker.querySelector(".airline-picker-options").getBoundingClientRect();
            const dialog = document.querySelector(".ticket-window").getBoundingClientRect();
            const hit = document.elementFromPoint(menu.left + menu.width / 2, menu.top + menu.height / 2);
            return {width: dialog.width, height: dialog.height, top: dialog.top,
                above: menu.bottom <= trigger.top, visible: Boolean(hit?.closest(".airline-picker-options"))};
        })()`);
        assert.deepEqual({width: popup.width, height: popup.height, top: popup.top}, closedRect, "Opening the airline menu must not resize or move the dialog");
        assert.equal(popup.above, true);
        assert.equal(popup.visible, true, "Upward menu must not be clipped by the scroll container");
        assert.equal(await js('document.querySelector(".ticket-guide").scrollWidth <= document.querySelector(".ticket-guide").clientWidth'), true);
        fs.writeFileSync(path.join(shots, `official-airlines-${width}.png`), (await win.webContents.capturePage()).toPNG());
        await js('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));');
        assert.equal(await js('document.querySelector("#flightBookingLink details").open'), false);
        assert.equal(await js('els.ticketToolPanel.classList.contains("open")'), true);
        await js('document.querySelector("#flightBookingLink summary").click(); document.querySelector(".ticket-guide > p").click();');
        assert.equal(await js('document.querySelector("#flightBookingLink details").open'), false);
    }
    win.destroy();
    console.log("Ticket routes verified: stations, outbound/return links, persistence, backups and mobile layout.");
}
app.whenReady().then(run).then(() => app.exit(0)).catch(error => {console.error(error); app.exit(1);});
app.on("quit", () => fs.rmSync(userData, {recursive: true, force: true}));
