const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow, ipcMain} = require("electron");

const auditUserData = path.join(os.tmpdir(), `restcal-integration-audit-${process.pid}`);
fs.mkdirSync(auditUserData, {recursive: true});
app.setPath("userData", auditUserData);
const googleCalendar = require("../desktop/google-calendar");
const desktopWebdav = require("../desktop/webdav");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let davServer = null;

async function run() {
    require("../server.js");
    await wait(400);
    davServer = http.createServer((request, response) => {
        if (request.method !== "PROPFIND") {
            response.writeHead(405).end();
            return;
        }
        if (request.headers.authorization !== "Basic dGVzdDp0ZXN0") {
            response.writeHead(401).end();
            return;
        }
        response.writeHead(207, {"Content-Type": "application/xml; charset=utf-8"});
        response.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>');
    });
    await new Promise((resolve, reject) => {
        davServer.once("error", reject);
        davServer.listen(0, "127.0.0.1", resolve);
    });
    const davPort = davServer.address().port;
    ipcMain.handle("calendar:get-launch-url", () => null);
    ipcMain.handle("calendar:add-event", () => ({ok: true}));
    ipcMain.handle("mail:compose", () => ({ok: true}));
    ipcMain.handle("google-calendar:status", () => googleCalendar.status());
    ipcMain.handle("google-calendar:connect", (_event, clientId) => googleCalendar.connect(clientId));
    ipcMain.handle("google-calendar:sync", (_event, events) => googleCalendar.syncEvents(events));
    ipcMain.handle("google-calendar:disconnect", () => googleCalendar.disconnect());
    ipcMain.handle("webdav:request", (_event, options) => desktopWebdav.request(options));

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
        (async () => {
            Object.keys(state.records).forEach(key => delete state.records[key]);
            state.records["2026-09-16"] = {status: "annual", note: "交接已完成", updatedAt: new Date().toISOString()};
            openLeaveGenerator({start: "2026-09-16", end: "2026-09-16", applicant: "测试用户"});
            generateLeaveDoc();
            const webdavResponse = await window.xiuliDav.request({
                method: "PROPFIND",
                url: "http://127.0.0.1:${davPort}/dav/",
                headers: {Authorization: "Basic dGVzdDp0ZXN0", Depth: "0"},
                body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"/>'
            });
            return {
                webdavBridge: typeof window.xiuliDav?.request === "function",
                webdavResponse,
                googleBridge: ["status", "connect", "sync", "disconnect"].every(key => typeof window.xiuliGoogleCalendar?.[key] === "function"),
                mailBridge: typeof window.xiuliMail?.compose === "function",
                connectionPanel: Boolean(document.querySelector('[data-settings-panel="connections"]')),
                autoSyncDefault: state.integrations.googleCalendar.autoSync,
                emailEnabledAfterGenerate: !document.getElementById("emailLeaveDoc").disabled,
                generatedEvents: googleCalendarEvents()
            };
        })()
    `);

    assert.equal(audit.webdavBridge, true);
    assert.equal(audit.webdavResponse.status, 207);
    assert.equal(audit.webdavResponse.ok, true);
    assert.match(audit.webdavResponse.body, /multistatus/);
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
    console.log("WebDAV, calendar and email integration verification passed");
}

app.whenReady()
    .then(run)
    .then(() => app.quit())
    .catch(error => {
        console.error(error);
        app.exit(1);
    });

app.on("quit", () => {
    try { davServer?.close(); } catch { }
    try { fs.rmSync(auditUserData, {recursive: true, force: true}); } catch { }
});
