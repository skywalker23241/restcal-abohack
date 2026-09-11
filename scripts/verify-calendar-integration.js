const assert = require("node:assert/strict");
const {app, BrowserWindow} = require("electron");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    require("../server.js");
    await wait(400);
    const win = new BrowserWindow({show: false, useContentSize: true, webPreferences: {contextIsolation: true}});
    win.setContentSize(360, 780);
    await win.loadURL("http://127.0.0.1:8765/app?date=2026-09-10");
    await wait(1200);

    const audit = await win.webContents.executeJavaScript(`
        (() => {
            const event = activeCalendarEvent();
            const ics = XiuliIcs.generateEventIcs(event).replace(/\\r\\n /g, "");
            const modalFoot = document.querySelector(".day-modal-foot");
            return {
                activeDate,
                modalOpen: document.getElementById("dayModal").classList.contains("open"),
                onboardingOpen: document.getElementById("onboardingBackdrop").classList.contains("open"),
                validCustomLink: parseRestcalDateLink("restcal://day/2026-09-10"),
                rejectsInvalidDate: parseRestcalDateLink("restcal://day/2026-02-30"),
                hasCalendarButton: Boolean(document.getElementById("modalAddCalendar")),
                footerFitsViewport: modalFoot.scrollWidth <= modalFoot.clientWidth,
                event,
                ics
            };
        })()
    `);

    assert.equal(audit.activeDate, "2026-09-10");
    assert.equal(audit.modalOpen, true);
    assert.equal(audit.onboardingOpen, false);
    assert.equal(audit.validCustomLink, "2026-09-10");
    assert.equal(audit.rejectsInvalidDate, "");
    assert.equal(audit.hasCalendarButton, true);
    assert.equal(audit.footerFitsViewport, true);
    assert.equal(audit.event.url, "restcal://day/2026-09-10");
    assert.match(audit.ics, /URL:restcal:\/\/day\/2026-09-10/);
    assert.match(audit.ics, /X-RESTCAL-ID:day:2026-09-10/);

    win.destroy();
    console.log("Calendar integration verification passed");
}

app.whenReady()
    .then(run)
    .then(() => app.quit())
    .catch(error => {
        console.error(error);
        app.exit(1);
    });
