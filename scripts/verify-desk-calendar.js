const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const {app, BrowserWindow} = require("electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "restcal-desk-calendar-"));
app.setPath("userData", profile); process.env.PORT = "8886";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
    require("../server.js");
    const win = new BrowserWindow({show: false, width: 1100, height: 900, webPreferences: {offscreen: true, backgroundThrottling: false}});
    win.webContents.on("console-message", (_event, level, message) => {if (level >= 2) console.error(message);});
    const js = source => win.webContents.executeJavaScript(source);
    await win.loadURL("http://127.0.0.1:8886/app"); await wait(1000);
    await js('closeOnboarding(); window.RestCalI18n.setLanguage("zh"); setCalendarMode("day");');
    const shots = path.join(__dirname, "shots"); fs.mkdirSync(shots, {recursive: true});
    for (const width of [1100, 360]) {
        win.setContentSize(width, 900);
        for (const mode of ["light", "dark"]) {
            await js('applyTheme("' + mode + '"); setPalette("paper");'); await wait(700);
            const result = await js(`(() => {
                const page = document.querySelector(".day-page"), grid = document.getElementById("calendarGrid");
                const p = page.getBoundingClientRect(), g = grid.getBoundingClientRect();
                return {holes: getComputedStyle(page, "::before").content,
                    tilted: getComputedStyle(page).transform === "none",
                    stand: getComputedStyle(grid, "::before").content === "none",
                    fits: p.left >= g.left && p.right <= g.right && document.documentElement.scrollWidth <= innerWidth};
            })()`);
            assert.deepEqual(result, {holes: "none", tilted: true, stand: true, fits: true});
            win.webContents.invalidate(); await wait(100);
            fs.writeFileSync(path.join(shots, `desk-calendar-${width}-${mode}.png`), (await win.webContents.capturePage()).toPNG());
        }
    }
    const before = await js('document.querySelector(".day-page").dataset.date');
    const pose = await js('getComputedStyle(document.querySelector(".day-page")).transform');
    await js('document.getElementById("nextMonth").click();'); await wait(750);
    assert.notEqual(await js('document.querySelector(".day-page").dataset.date'), before);
    assert.equal(await js('document.querySelectorAll(".day-page").length'), 1);
    assert.equal(await js('getComputedStyle(document.querySelector(".day-page")).transform'), pose);
    await js('document.getElementById("prevMonth").click();'); await wait(750);
    assert.equal(await js('document.querySelector(".day-page").dataset.date'), before);
    assert.equal(await js('getComputedStyle(document.querySelector(".day-page")).transform'), pose);
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-motion", value: "reduce"}]});
    await js('document.getElementById("nextMonth").click();'); await wait(50);
    assert.equal(await js('document.querySelectorAll(".day-page").length'), 1);
    assert.equal(await js('getComputedStyle(document.querySelector(".day-page")).transform'), pose);
    win.webContents.debugger.detach();
    await js('document.querySelector(".day-page").click();'); await wait(200);
    assert.equal(await js('document.getElementById("dayModal").classList.contains("open")'), true);
    await js('closeModal(); setCalendarMode("month");'); await wait(100);
    assert.equal(await js('Boolean(document.querySelector(".day-page"))'), false);
    await js('setCalendarMode("day");'); await wait(500);
    assert.ok(await js('document.querySelector(".day-page").getBoundingClientRect().width > 100'));
win.destroy(); console.log("Desk calendar verified: light/dark, desktop/mobile, flat page structure, navigation and editing.");
}
app.whenReady().then(run).then(() => app.exit(0)).catch(error => {console.error(error); app.exit(1);});
app.on("quit", () => fs.rmSync(profile, {recursive: true, force: true}));
