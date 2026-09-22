const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow} = require("electron");

const auditUserData = path.join(os.tmpdir(), `restcal-overview-audit-${process.pid}`);
const shotsDir = path.join(__dirname, "shots");
fs.mkdirSync(auditUserData, {recursive: true});
fs.mkdirSync(shotsDir, {recursive: true});
app.setPath("userData", auditUserData);

const {startDevServer} = require("./lib/dev-server.js");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function capture(win, name) {
    await win.webContents.executeJavaScript(`
        document.getAnimations().forEach(animation => {
            if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
        });
        undefined
    `);
    win.webContents.invalidate();
    await wait(350);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), image.toPNG());
}

async function run() {
    const {origin} = await startDevServer();
    const win = new BrowserWindow({
        show: false,
        useContentSize: true,
        webPreferences: {contextIsolation: true, backgroundThrottling: false}
    });

    win.setContentSize(1440, 900);
    await win.loadURL(`${origin}/app.html?overview-audit=${Date.now()}`);
    await wait(1000);
    const desktopAudit = await win.webContents.executeJavaScript(`
        (async () => {
            window.RestCalI18n.setLanguage("zh");
            document.getElementById("overviewCustomize").click();
            await new Promise(resolve => setTimeout(resolve, 350));
            const modal = document.getElementById("overviewCustomizeModal");
            const modalStyle = getComputedStyle(modal);
            const summaryWidth = () => Math.round(document.getElementById("monthSummary").getBoundingClientRect().width);
            const initial = {
                open: modal.classList.contains("open"),
                visible: modalStyle.display !== "none",
                rows: document.querySelectorAll("#overviewCustomizerList .overview-module-row").length,
                selected: document.querySelectorAll("#overviewCustomizerList .is-selected").length,
                preview: document.querySelectorAll("#overviewCustomizerPreview .overview-item").length,
                defaultModules: [...state.dashboard.overviewModules]
            };
            document.querySelector('[data-overview-remove="leaveDeduction"]').click();
            const twoModuleWidth = summaryWidth();
            document.querySelector('[data-overview-remove="nextHoliday"]').click();
            const oneModuleWidth = summaryWidth();
            document.querySelector('[data-overview-remove="attendance"]').click();
            const zeroModuleWidth = summaryWidth();
            const emptyPrompt = document.querySelector("#monthSummary .overview-empty")?.textContent.trim();
            document.getElementById("overviewCustomizeReset").click();
            const threeModuleWidth = summaryWidth();
            document.querySelector('[data-overview-remove="leaveDeduction"]').click();
            document.querySelector('[data-overview-add="annualQuota"]').click();
            document.querySelector('[data-overview-move="up"][data-overview-id="annualQuota"]').click();
            return {
                initial,
                widths: {zeroModuleWidth, oneModuleWidth, twoModuleWidth, threeModuleWidth},
                emptyPrompt,
                updatedModules: [...state.dashboard.overviewModules],
                storedModules: JSON.parse(localStorage.getItem("xiuli-state-v1")).dashboard.overviewModules,
                cards: [...document.querySelectorAll("#monthSummary .overview-label")].map(node => node.textContent.trim()),
                documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth
            };
        })()
    `);

    assert.equal(desktopAudit.initial.open, true);
    assert.equal(desktopAudit.initial.visible, true);
    assert.equal(desktopAudit.initial.rows, 9);
    assert.equal(desktopAudit.initial.selected, 3);
    assert.equal(desktopAudit.initial.preview, 3);
    assert.deepEqual(desktopAudit.initial.defaultModules, ["attendance", "leaveDeduction", "nextHoliday"]);
    assert.equal(desktopAudit.widths.oneModuleWidth, desktopAudit.widths.threeModuleWidth);
    assert.equal(desktopAudit.widths.twoModuleWidth, desktopAudit.widths.threeModuleWidth);
    assert.equal(desktopAudit.widths.zeroModuleWidth, desktopAudit.widths.threeModuleWidth);
    assert.equal(desktopAudit.emptyPrompt, "点击添加模块");
    assert.deepEqual(desktopAudit.updatedModules, ["attendance", "annualQuota", "nextHoliday"]);
    assert.deepEqual(desktopAudit.storedModules, desktopAudit.updatedModules);
    assert.deepEqual(desktopAudit.cards, ["请假 / 出勤", "剩余年假", "距下个节假日"]);
    assert.equal(desktopAudit.documentFits, true);
    await capture(win, "overview-customize-1440");

    await win.reload();
    await wait(700);
    const persisted = await win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem("xiuli-state-v1")).dashboard.overviewModules`);
    assert.deepEqual(persisted, ["attendance", "annualQuota", "nextHoliday"]);

    const recentAudit = await win.webContents.executeJavaScript(`
        (async () => {
            state.records["2026-09-16"] = {status: "work", note: "跑步一小时", updatedAt: new Date().toISOString()};
            state.records["2026-09-20"] = {status: "annual", reason: "休息", updatedAt: new Date().toISOString()};
            renderRecentRecords();
            document.getElementById("recentRecordsToggle").click();
            await new Promise(resolve => setTimeout(resolve, 80));
            const panel = document.getElementById("recentRecordsPanel");
            const row = panel.querySelector(".recent-row");
            const style = getComputedStyle(row);
            return {
                open: panel.classList.contains("open"),
                rows: panel.querySelectorAll(".recent-row").length,
                justify: getComputedStyle(panel).justifyContent,
                bodyDisplay: getComputedStyle(panel.querySelector(".recent-records-body")).display,
                rowHeight: Math.round(row.getBoundingClientRect().height),
                border: style.borderTopStyle,
                radius: style.borderTopLeftRadius,
                background: style.backgroundColor,
                trendRemoved: !document.getElementById("homeTrend") && !document.querySelector('[aria-label="年度趋势"]')
            };
        })()
    `);
    assert.equal(recentAudit.open, true);
    assert.equal(recentAudit.rows, 2);
    assert.equal(recentAudit.justify, "flex-end");
    assert.equal(recentAudit.bodyDisplay, "block");
    assert.ok(recentAudit.rowHeight >= 58 && recentAudit.rowHeight <= 80, `Unexpected recent row height: ${recentAudit.rowHeight}`);
    assert.equal(recentAudit.border, "solid");
    assert.equal(recentAudit.radius, "12px");
    assert.notEqual(recentAudit.background, "rgba(0, 0, 0, 0)");
    assert.equal(recentAudit.trendRemoved, true);
    await win.webContents.executeJavaScript("closeRecentRecords(); undefined");

    win.setContentSize(360, 780);
    await win.reload();
    await wait(700);
    const mobileAudit = await win.webContents.executeJavaScript(`
        (() => {
            document.getElementById("overviewCustomize").click();
            const modal = document.getElementById("overviewCustomizeModal");
            const width = () => Math.round(document.getElementById("monthSummary").getBoundingClientRect().width);
            const threeModuleWidth = width();
            document.querySelector('[data-overview-remove="annualQuota"]').click();
            const twoModuleWidth = width();
            document.querySelector('[data-overview-remove="nextHoliday"]').click();
            const oneModuleWidth = width();
            document.querySelector('[data-overview-remove="attendance"]').click();
            const zeroModuleWidth = width();
            return {
                open: modal.classList.contains("open"),
                fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
                rows: document.querySelectorAll("#overviewCustomizerList .overview-module-row").length,
                emptyPrompt: document.querySelector("#monthSummary .overview-empty")?.textContent.trim(),
                widths: {zeroModuleWidth, oneModuleWidth, twoModuleWidth, threeModuleWidth}
            };
        })()
    `);
    assert.equal(mobileAudit.open, true);
    assert.equal(mobileAudit.fits, true);
    assert.equal(mobileAudit.rows, 9);
    assert.equal(mobileAudit.widths.oneModuleWidth, mobileAudit.widths.threeModuleWidth);
    assert.equal(mobileAudit.widths.twoModuleWidth, mobileAudit.widths.threeModuleWidth);
    assert.equal(mobileAudit.widths.zeroModuleWidth, mobileAudit.widths.threeModuleWidth);
    assert.equal(mobileAudit.emptyPrompt, "点击添加模块");
    await capture(win, "overview-customize-360");

    win.destroy();
    console.log("Overview module verification passed");
}

app.whenReady()
    .then(run)
    .then(() => app.quit())
    .catch(error => {
        console.error(error);
        app.exit(1);
    });

app.on("quit", () => {
    try { fs.rmSync(auditUserData, {recursive: true, force: true}); } catch { }
});
