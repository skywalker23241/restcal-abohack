/* 英文模式覆盖率检查。
 *
 * 应用内的英文翻译是按**中文原文精确匹配**的（见 assets/js/app-i18n-v1.4.9.js）：
 * 改了一句中文而没改词典，英文版就静默地退回中文，不报错、不崩溃，只是坏了。
 * 静态扫字符串无法区分哪些会进 DOM，所以这里直接把应用跑起来，切到英文，
 * 把主要界面都展开一遍，再扫描真实渲染出来的文本里还剩多少汉字。
 *
 * 用法：npm run verify:i18n（需要 npm install）
 */

const {app, BrowserWindow} = require("electron");
const {startDevServer} = require("./lib/dev-server.js");

// 这些地方的汉字是应该的，不算漏翻：
// - 语言切换按钮本身就要显示另一种语言
// - 用户自己输入的内容（本脚本的用例不填中文，留着以防万一）
// - 每日一言的中文语料
const IGNORED_SELECTORS = [
    "#languageToggle",
    "#languageChoice",
    "[data-user-content]",
    "#dayQuote",
    ".day-quote"
];

const SCAN = `(() => {
    const ignored = ${JSON.stringify(IGNORED_SELECTORS)};
    const hasCjk = value => /[\\u4e00-\\u9fff]/.test(value || "");
    const skip = node => {
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!el) return true;
        if (el.closest("script, style, svg")) return true;
        return ignored.some(selector => el.closest(selector));
    };
    const describe = el => {
        const parts = [];
        for (let cur = el; cur && cur !== document.body; cur = cur.parentElement) {
            parts.unshift(cur.id ? "#" + cur.id : cur.tagName.toLowerCase() + (cur.className && typeof cur.className === "string" ? "." + cur.className.trim().split(/\\s+/)[0] : ""));
            if (cur.id) break;
        }
        return parts.slice(-3).join(" > ");
    };

    const findings = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        if (skip(node)) continue;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.data.trim();
            if (hasCjk(text)) findings.push({kind: "text", where: describe(node.parentElement), value: text.slice(0, 80)});
            continue;
        }
        for (const name of ["title", "aria-label", "placeholder"]) {
            const value = node.getAttribute && node.getAttribute(name);
            if (hasCjk(value)) findings.push({kind: name, where: describe(node), value: value.slice(0, 80)});
        }
    }
    const seen = new Set();
    return findings.filter(f => { const k = f.kind + "|" + f.value; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;

async function openEverything(win) {
    // 把主要视图与弹窗都展开，否则大量文案根本没进 DOM。
    const steps = [
        `switchView("calendar"); setCalendarMode("month");`,
        `setCalendarMode("week");`,
        `setCalendarMode("day");`,
        `setCalendarMode("year");`,
        `switchView("stats"); setStatsPeriodMode("month");`,
        `setStatsPeriodMode("year");`,
        `switchView("tools");`,
        `openModal("2026-09-16");`,
        `closeModal(); openLeaveGenerator({start: "2026-09-16", end: "2026-09-16"});`,
        `closeLeaveGenerator(); openSearch();`,
        `closeSearch(); openSettings("profile");`,
        `setSettingsPanel("schedule");`,
        `setSettingsPanel("salary");`,
        `setSettingsPanel("leave");`,
        `setSettingsPanel("connections");`,
        `setSettingsPanel("data");`,
        `closeSettings(); toggleTicketTool();`,
        `toggleTicketTool(); openHabitTool();`,
        `closeBackdrop(els.habitToolPanel); openOverviewCustomizer();`,
        `closeOverviewCustomizer(); openRecentRecords();`,
        `closeRecentRecords(); openWebdavConfigModal();`,
        `closeWebdavConfigModal(); openGoogleConfig();`,
        `closeGoogleConfig(); openGuide();`,
        `closeGuide(); switchView("calendar");`
    ];
    const collected = [];
    for (const step of steps) {
        try {
            await win.webContents.executeJavaScript(`(() => { try { ${step} } catch (e) { return "ERR " + e.message; } return ""; })()`);
        } catch { /* 展开失败不影响其他步骤 */ }
        await new Promise(resolve => setTimeout(resolve, 120));
        const found = await win.webContents.executeJavaScript(SCAN);
        collected.push(...found);
    }
    const seen = new Set();
    return collected.filter(f => { const k = f.kind + "|" + f.value; if (seen.has(k)) return false; seen.add(k); return true; });
}

app.whenReady().then(async () => {
    const {origin} = await startDevServer();
    const win = new BrowserWindow({show: false, useContentSize: true, webPreferences: {contextIsolation: true}});
    win.setContentSize(1440, 960);
    await win.loadURL(`${origin}/app.html?i18n-audit=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 2200));

    await win.webContents.executeJavaScript(`(() => {
        state.onboardingCompleted = true; state.onboardingSkipped = true;
        state.settings.salary = 30000; state.settings.deduction = 3000; state.settings.annualQuota = 10;
        state.salary = {...state.salary, monthlySalary: 30000, fixedDeductions: 3000};
        RestCalI18n.setLanguage("en");
        return render();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 900));

    const findings = await openEverything(win);

    if (findings.length) {
        console.error(`英文模式下有 ${findings.length} 处未翻译的中文：\n`);
        for (const f of findings) console.error(`  [${f.kind}] ${f.where}\n      ${f.value}`);
        console.error("\n请在 public/assets/js/app-i18n-v1.4.9.js 的词典里补上对应条目。");
        app.exit(1);
        return;
    }
    console.log("i18n OK：英文模式下主要视图与弹窗都没有漏翻的中文。");
    app.exit(0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
