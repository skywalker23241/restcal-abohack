// Generate the English screenshots used by the landing-page Hero carousel.
const {chromium} = require("playwright");
const {spawn} = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const OUT = path.join(REPO, "public", "assets", "images", "home", "en");
const PORT = 8802;
const BASE = `http://127.0.0.1:${PORT}`;
const FIXED_NOW = new Date("2026-09-17T12:00:00+08:00").valueOf();

const records = {};
const mark = (iso, status, reason = "", note = "") => {
    records[iso] = {status, leaveType: status, reason, note, updatedAt: "2026-09-17T04:00:00.000Z"};
};
mark("2026-01-19", "personal", "Passport appointment");
mark("2026-02-24", "annual", "Extended Spring Festival trip");
mark("2026-02-25", "annual", "Extended Spring Festival trip");
mark("2026-03-13", "sick", "Doctor appointment");
mark("2026-04-07", "comp", "Time off after holiday support");
mark("2026-05-06", "annual", "Family trip");
mark("2026-06-10", "sick", "Recovering at home");
mark("2026-06-11", "sick", "Recovering at home");
["2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26", "2026-06-29", "2026-06-30"].forEach(date => mark(date, "work"));
mark("2026-07-01", "annual", "Family trip to Hainan");
mark("2026-07-02", "annual", "Family trip to Hainan");
mark("2026-07-03", "annual", "Family trip to Hainan");
["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"].forEach(date => mark(date, "work"));
mark("2026-07-15", "personal", "Visa appointment", "Back at work in the afternoon");
mark("2026-07-20", "comp", "Time off after holiday support");

const demoState = {
    records,
    settings: {
        salary: 18000,
        deduction: 3200,
        personalRate: 100,
        sickRate: 50,
        annualRate: 0,
        compRate: 0,
        annualQuota: 10,
        compQuota: 5,
        applicantName: "Alex Li",
        leaveRecipient: "Dear Manager",
        personalReason: "Personal appointment",
        sickReason: "Feeling unwell",
        leaveHandoff: "My current work has been handed over to Jordan"
    },
    profile: {name: "Alex Li", company: "RestCal Studio", hireDate: "2022-03-14"},
    workSchedule: {workdaysPerWeek: 5, restDays: [0, 6], dailyWorkHours: 8, scheduleType: "standard"},
    salary: {monthlySalary: 18000, fixedDeductions: 3200, estimatedTax: 680, payday: 10},
    onboardingCompleted: true,
    onboardingSkipped: false,
    setupBannerDismissed: true
};

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForServer(server) {
    let lastError = "";
    server.stderr.on("data", data => { lastError = String(data).trim(); });
    for (let attempt = 0; attempt < 50; attempt++) {
        if (server.exitCode !== null) throw new Error(lastError || `Server exited with code ${server.exitCode}`);
        const ready = await new Promise(resolve => {
            const request = http.get(`${BASE}/app.html`, response => {
                response.resume();
                resolve(response.statusCode === 200);
            });
            request.on("error", () => resolve(false));
            request.setTimeout(500, () => {
                request.destroy();
                resolve(false);
            });
        });
        if (ready) return;
        await sleep(100);
    }
    throw new Error(lastError || "Server did not become ready");
}

async function capture(page, filename) {
    await sleep(450);
    await page.screenshot({path: path.join(OUT, filename)});
    console.log("shot", filename);
}

(async () => {
    fs.mkdirSync(OUT, {recursive: true});
    const server = spawn(process.execPath, [path.join(REPO, "server.js")], {
        env: {...process.env, PORT: String(PORT)}
    });
    await waitForServer(server);

    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({
            viewport: {width: 1440, height: 900},
            deviceScaleFactor: 2,
            locale: "en-US",
            timezoneId: "Asia/Shanghai",
            serviceWorkers: "block"
        });
        await context.addInitScript(({state, fixedNow}) => {
            localStorage.setItem("xiuli-state-v1", JSON.stringify(state));
            localStorage.setItem("xiuli-theme", "light");
            localStorage.setItem("xiuli-calendar-mode", "day");
            localStorage.setItem("restcal-language", "en");
            const NativeDate = Date;
            class FixedDate extends NativeDate {
                constructor(...args) {
                    super(...(args.length ? args : [fixedNow]));
                }
                static now() { return fixedNow; }
            }
            globalThis.Date = FixedDate;
        }, {state: demoState, fixedNow: FIXED_NOW});

        const page = await context.newPage();
        await page.goto(`${BASE}/app.html`, {waitUntil: "networkidle"});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => document.documentElement.lang === "en");
        await capture(page, "calendar.png");

        await page.click('[data-date="2026-09-17"]');
        await page.waitForSelector("#dayModal.open");
        await page.click('[data-action="annual"]');
        await page.fill("#modalReason", "Short family trip");
        await page.locator("#modalAdvanced").evaluate(element => { element.open = true; });
        await page.fill("#modalNote", "Handoff confirmed before departure");
        await capture(page, "date-record.png");
        await page.click("#closeModal");

        await page.click('[data-nav="stats"]');
        await page.click('[data-stats-period="year"]');
        await capture(page, "statistics-overview.png");

        await page.click('[data-nav="tools"]');
        await capture(page, "tools-overview.png");

        await page.click("#ticketToolToggle");
        await page.waitForSelector("#ticketToolPanel.open");
        await capture(page, "ticket-reminders.png");
        await page.click("#closeTicketTool");

        await page.click("[data-generate-leave-receipt]");
        await page.waitForSelector("#leaveGeneratorModal.open");
        await page.fill("#leaveApplicantDoc", "Alex Li");
        await page.fill("#leaveRecipientDoc", "Dear Manager");
        await page.selectOption("#leaveTypeForDoc", "annual");
        await page.fill("#leaveStart", "2026-09-21");
        await page.fill("#leaveEnd", "2026-09-22");
        await page.fill("#leaveReasonDoc", "A short trip with my family");
        await page.fill("#leaveHandoffDoc", "My current work has been handed over to Jordan");
        await page.click("#generateDoc");
        await capture(page, "leave-overview.png");
        await page.click("#closeLeaveGenerator");

        await page.click("#settingsToggle");
        await page.waitForSelector("#settingsModal.open");
        await page.click('[data-settings-nav="schedule"]');
        await capture(page, "settings-overview.png");

        await context.close();
    } finally {
        await browser.close();
        server.kill();
    }
})().catch(error => {
    console.error("Failed:", error.message);
    process.exit(1);
});
