const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow, ipcMain} = require("electron");

const auditUserData = path.join(os.tmpdir(), `restcal-integration-audit-${process.pid}`);
fs.mkdirSync(auditUserData, {recursive: true});
app.setPath("userData", auditUserData);
const googleCalendar = require("../desktop/google-calendar");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    require("../server.js");
    await wait(400);
    ipcMain.handle("calendar:get-launch-url", () => null);
    ipcMain.handle("calendar:add-event", () => ({ok: true}));
    ipcMain.handle("mail:compose", () => ({ok: true}));
    ipcMain.handle("google-calendar:status", () => googleCalendar.status());
    ipcMain.handle("google-calendar:connect", (_event, clientId) => googleCalendar.connect(clientId));
    ipcMain.handle("google-calendar:sync", (_event, events) => googleCalendar.syncEvents(events));
    ipcMain.handle("google-calendar:disconnect", () => googleCalendar.disconnect());

    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "..", "desktop", "preload.js"),
            contextIsolation: true,
            sandbox: true
        }
    });
    await win.loadURL(`http://127.0.0.1:8765/app.html?integration-audit=${Date.now()}`);
    await wait(1200);
    const audit = await win.webContents.executeJavaScript(`
        (() => {
            Object.keys(state.records).forEach(key => delete state.records[key]);
            state.records["2026-09-16"] = {status: "annual", note: "交接已完成", updatedAt: new Date().toISOString()};
            openLeaveGenerator({start: "2026-09-16", end: "2026-09-16", applicant: "测试用户"});
            generateLeaveDoc();
            return {
                googleBridge: ["status", "connect", "sync", "disconnect"].every(key => typeof window.xiuliGoogleCalendar?.[key] === "function"),
                mailBridge: typeof window.xiuliMail?.compose === "function",
                connectionPanel: Boolean(document.querySelector('[data-settings-panel="connections"]')),
                autoSyncDefault: state.integrations.googleCalendar.autoSync,
                emailEnabledAfterGenerate: !document.getElementById("emailLeaveDoc").disabled,
                generatedEvents: googleCalendarEvents()
            };
        })()
    `);

    assert.equal(audit.googleBridge, true);
    assert.equal(audit.mailBridge, true);
    assert.equal(audit.connectionPanel, true);
    assert.equal(audit.autoSyncDefault, true);
    assert.equal(audit.emailEnabledAfterGenerate, true);
    assert.equal(audit.generatedEvents.length, 1);
    assert.equal(audit.generatedEvents[0].id, "restcal20260916");
    assert.equal(audit.generatedEvents[0].start.date, "2026-09-16");
    assert.equal(audit.generatedEvents[0].end.date, "2026-09-17");
    win.destroy();
    console.log("Calendar and email integration verification passed");
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
