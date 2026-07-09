// README 产品截图生成脚本：向本地应用注入演示数据，用 Playwright 批量截图到 docs/screenshots/。
// 演示数据以 2026-07 为基准月份，界面大改或换演示年份时按需调整 mark(...) 部分。
//
// 用法（playwright 不是项目依赖，任选其一）：
//   1) npm i --no-save playwright && npx playwright install chromium
//      node tools/readme-screenshots.cjs
//   2) 已有全局/缓存的 playwright 时：
//      NODE_PATH=<playwright 所在的 node_modules> node tools/readme-screenshots.cjs
const {chromium} = require("playwright");
const {spawn} = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const OUT = path.join(REPO, "docs", "screenshots");
const PORT = 8801;
const BASE = `http://127.0.0.1:${PORT}`;

// ---- 演示数据 ----
const LABEL = {work: "", personal: "事假", sick: "病假", annual: "年假", comp: "调休"};
const R = {};
const mark = (iso, status, reason = "", note = "") => {
    R[iso] = {status, leaveType: LABEL[status] || "", reason, note, updatedAt: "2026-07-09T01:00:00.000Z"};
};
mark("2026-01-19", "personal", "办理护照");
mark("2026-02-24", "annual", "春节返乡多休两天");
mark("2026-02-25", "annual", "春节返乡多休两天");
mark("2026-03-13", "sick", "感冒就医");
mark("2026-04-07", "comp", "清明项目值班调休");
mark("2026-05-06", "annual", "五一连休");
mark("2026-06-10", "sick", "重感冒休养");
mark("2026-06-11", "sick", "重感冒休养");
["2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26", "2026-06-29", "2026-06-30"].forEach(d => mark(d, "work"));
mark("2026-07-01", "annual", "海南家庭旅行");
mark("2026-07-02", "annual", "海南家庭旅行");
mark("2026-07-03", "annual", "海南家庭旅行");
["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"].forEach(d => mark(d, "work"));
mark("2026-07-15", "personal", "办理签证", "下午办完即回岗");
mark("2026-07-20", "comp", "端午值班调休");

const settings = {
    salary: 18000, deduction: 3200,
    personalRate: 100, sickRate: 50, annualRate: 0, compRate: 0,
    annualQuota: 10, compQuota: 5,
    applicantName: "李修", leaveRecipient: "尊敬的王经理",
    personalReason: "个人事务", sickReason: "身体不适",
    leaveHandoff: "手头工作已交接给张伟"
};
const webdav = {url: "https://dav.jianguoyun.com/dav/xiuli/", username: "demo@example.com", password: "demo-password"};

const initScript = theme => `
    localStorage.setItem("xiuli-state-v1", ${JSON.stringify(JSON.stringify({records: R, settings}))});
    localStorage.setItem("xiuli-webdav-v1", ${JSON.stringify(JSON.stringify(webdav))});
    localStorage.setItem("xiuli-theme", ${JSON.stringify(theme)});
`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openApp(context) {
    const page = await context.newPage();
    await page.goto(`${BASE}/app.html`, {waitUntil: "networkidle"});
    await page.evaluate(() => document.fonts.ready);
    await sleep(600);
    return page;
}

async function shootModal(page, openAction, modalSel, file, innerSel = ".modal") {
    await openAction();
    await page.waitForSelector(`${modalSel}.open`, {timeout: 5000});
    await sleep(500);
    await page.locator(`${modalSel} ${innerSel}`).screenshot({path: path.join(OUT, file)});
    console.log("shot", file);
}

(async () => {
    fs.mkdirSync(OUT, {recursive: true});
    const server = spawn(process.execPath, [path.join(REPO, "server.js")], {env: {...process.env, PORT: String(PORT)}});
    await new Promise((resolve, reject) => {
        server.stdout.on("data", d => String(d).includes(String(PORT)) && resolve());
        server.on("error", reject);
        setTimeout(() => reject(new Error("server 未就绪")), 5000);
    });

    const browser = await chromium.launch();
    try {
        // ---- 桌面亮色：总览 + 各功能特写 ----
        const light = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Shanghai"});
        await light.addInitScript(initScript("light"));
        const page = await openApp(light);
        await page.screenshot({path: path.join(OUT, "overview-light.png")});
        console.log("shot overview-light.png");

        const yearPanel = page.locator("section.panel:has(#yearStats)");
        await yearPanel.screenshot({path: path.join(OUT, "year-stats.png")});
        console.log("shot year-stats.png");
        await page.click('[data-year-mode="days"]');
        await sleep(500);
        await yearPanel.screenshot({path: path.join(OUT, "year-heatmap.png")});
        console.log("shot year-heatmap.png");
        await page.click('[data-year-mode="months"]');

        await shootModal(page, () => page.click('[data-open-receipt="salary"]'), "#receiptModal", "salary-slip.png", ".receipt-window");
        await page.click("#receiptDone");
        await sleep(500);

        await page.click("[data-generate-leave-receipt]");
        await page.waitForSelector("#leaveGeneratorModal.open", {timeout: 5000});
        await sleep(400);
        await page.fill("#leaveStart", "2026-07-01");
        await page.fill("#leaveEnd", "2026-07-03");
        await page.selectOption("#leaveTypeForDoc", "annual");
        const reasonInput = page.locator("#leaveReasonDoc");
        if (await reasonInput.count()) await reasonInput.fill("海南家庭旅行");
        // 预览渲染在生成器弹窗内部，生成后直接截整个弹窗
        await page.click("#generateDoc");
        await sleep(700);
        await page.locator("#leaveGeneratorModal .leave-generator-window").screenshot({path: path.join(OUT, "leave-note.png")});
        console.log("shot leave-note.png");
        await page.click("#closeLeaveGenerator");
        await sleep(500);

        await shootModal(page, () => page.click("#settingsToggle"), "#settingsModal", "settings.png");
        await page.click("#settingsDone");
        await light.close();

        // ---- 桌面暗色：总览 ----
        const dark = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2, locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "dark"});
        await dark.addInitScript(initScript("dark"));
        const darkPage = await openApp(dark);
        await darkPage.screenshot({path: path.join(OUT, "overview-dark.png")});
        console.log("shot overview-dark.png");
        await dark.close();

        // ---- 移动端亮色：总览 ----
        const mobile = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-CN", timezoneId: "Asia/Shanghai"});
        await mobile.addInitScript(initScript("light"));
        const mobilePage = await openApp(mobile);
        await mobilePage.screenshot({path: path.join(OUT, "overview-mobile.png")});
        console.log("shot overview-mobile.png");
        await mobile.close();

        console.log("全部完成");
    } finally {
        await browser.close();
        server.kill();
    }
})().catch(e => { console.error("失败:", e.message); process.exit(1); });
