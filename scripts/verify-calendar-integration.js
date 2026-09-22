const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow} = require("electron");

const auditUserData = path.join(os.tmpdir(), `restcal-calendar-audit-${process.pid}`);
fs.mkdirSync(auditUserData, {recursive: true});
app.setPath("userData", auditUserData);

const {startDevServer} = require("./lib/dev-server.js");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    const {origin} = await startDevServer();
    const win = new BrowserWindow({show: false, useContentSize: true, webPreferences: {contextIsolation: true}});
    win.setContentSize(360, 780);
    await win.loadURL(`${origin}/app?date=2026-09-10&audit=${Date.now()}`);
    await wait(1200);

    const audit = await win.webContents.executeJavaScript(`
        (() => {
            try {
                const event = activeCalendarEvent();
                const ics = XiuliIcs.generateEventIcs(event).replace(/\\r\\n /g, "");
                const modalFoot = document.querySelector(".day-modal-foot");
                const holidayNames = ["元旦", "春节", "元宵节", "龙抬头", "上巳节", "寒食节", "清明", "劳动节", "端午", "七夕节", "中元节", "中秋", "重阳节", "寒衣节", "下元节", "腊八节", "小年", "除夕", "国庆节", "中国人民抗日战争暨世界反法西斯战争胜利纪念日", "临时假日"];
                const traditionalFestivalDates = ["2026-01-26", "2026-02-10", "2026-02-16", "2026-02-17", "2026-03-03", "2026-03-20", "2026-04-04", "2026-04-19", "2026-06-19", "2026-08-19", "2026-08-27", "2026-09-25", "2026-10-18", "2026-11-09", "2026-11-23"];
                const traditionalFestivals = traditionalFestivalDates.map(iso => getTraditionalFestival(fromISO(iso)));
                const holidayGreetingsZh = holidayNames.map(name => holidayGreeting(name));
                window.RestCalI18n.setLanguage("en");
                const holidayGreetingsEn = holidayNames.map(name => window.RestCalI18n.t(holidayGreeting(name)));
                return {
                    activeDate,
                    modalOpen: document.getElementById("dayModal").classList.contains("open"),
                    onboardingOpen: document.getElementById("onboardingBackdrop").classList.contains("open"),
                    validCustomLink: parseRestcalDateLink("restcal://day/2026-09-10"),
                    rejectsInvalidDate: parseRestcalDateLink("restcal://day/2026-02-30"),
                    hasCalendarButton: Boolean(document.getElementById("modalAddCalendar")),
                    footerFitsViewport: modalFoot.scrollWidth <= modalFoot.clientWidth,
                    holidayGreetingsZh,
                    holidayGreetingsEn,
                    traditionalFestivals,
                    event,
                    ics
                };
            } catch (error) {
                return {scriptError: error?.stack || String(error)};
            }
        })()
    `);

    assert.equal(audit.scriptError, undefined, audit.scriptError);
    assert.equal(audit.activeDate, "2026-09-10");
    assert.equal(audit.modalOpen, true);
    assert.equal(audit.onboardingOpen, false);
    assert.equal(audit.validCustomLink, "2026-09-10");
    assert.equal(audit.rejectsInvalidDate, "");
    assert.equal(audit.hasCalendarButton, true);
    assert.equal(audit.footerFitsViewport, true);
    assert.deepEqual(audit.holidayGreetingsZh, [
        "元旦 · 新岁启封，万事顺意",
        "春节 · 阖家团圆，新春安康",
        "元宵 · 灯火可亲，喜乐团圆",
        "龙抬头 · 春回大地，鸿运当头",
        "上巳 · 春日踏青，祓禊纳福",
        "寒食 · 春风寄思，清明在心",
        "清明 · 慎终追远，踏青惜春",
        "劳动节 · 致敬奋斗，也别忘了休息",
        "端午 · 粽香安康，顺遂如意",
        "七夕 · 星河为证，所愿皆成",
        "中元 · 缅怀先人，心怀敬意",
        "中秋 · 月满人团圆，心安即归处",
        "重阳 · 登高望远，敬老安康",
        "寒衣 · 遥寄思念，愿岁寒有暖",
        "下元 · 消灾解厄，平安顺遂",
        "腊八 · 粥暖岁寒，静候新春",
        "小年 · 辞旧迎新，人间小团圆",
        "除夕 · 辞旧迎新，阖家守岁",
        "国庆 · 山河锦绣，假日愉快",
        "胜利纪念日 · 铭记历史，珍爱和平",
        "假日 · 愿你自在从容，平安喜乐"
    ]);
    assert.deepEqual(audit.holidayGreetingsEn, [
        "New Year's Day · New beginnings, bright possibilities",
        "Spring Festival · Reunion, warmth, and a joyful new year",
        "Lantern Festival · Warm lights, shared joy, and reunion",
        "Dragon Heads-raising Day · Spring returns with rising fortune",
        "Shangsi Festival · Welcome spring and gather good fortune",
        "Cold Food Festival · Remember loved ones in the spring breeze",
        "Qingming Festival · Remember the past and welcome the spring",
        "Labour Day · Celebrate hard work—and take a well-earned rest",
        "Dragon Boat Festival · May health and good fortune be with you",
        "Qixi Festival · May every wish beneath the stars come true",
        "Ghost Festival · Remember those before us with respect",
        "Mid-Autumn Festival · Full moon, warm hearts, together again",
        "Double Ninth Festival · Climb high and wish our elders well",
        "Winter Clothing Festival · Sending remembrance and warmth from afar",
        "Xiayuan Festival · May troubles pass and peace remain",
        "Laba Festival · Warm porridge for winter, awaiting the spring",
        "Little New Year · Farewell to the old and gather in warmth",
        "New Year's Eve · Welcome the new year together",
        "National Day · Celebrate the nation and enjoy the holiday",
        "Victory Day · Remember history and cherish peace",
        "Holiday · Wishing you ease, peace, and joy"
    ]);
    assert.deepEqual(audit.traditionalFestivals, [
        "腊八节", "小年", "除夕", "春节", "元宵节", "龙抬头", "寒食节", "上巳节", "端午节", "七夕节", "中元节", "中秋节", "重阳节", "寒衣节", "下元节"
    ]);
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

app.on("quit", () => {
    try { fs.rmSync(auditUserData, {recursive: true, force: true}); } catch { }
});
