const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow} = require("electron");

const auditUserData = fs.mkdtempSync(path.join(os.tmpdir(), "restcal-themes-"));
app.setPath("userData", auditUserData);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const shots = path.join(__dirname, "shots");
const testPort = process.env.RESTCAL_TEST_PORT || "8765";
process.env.PORT = testPort;

function contrast(a, b) {
    const luminance = hex => {
        const rgb = hex.match(/[\da-f]{2}/gi).map(channel => {
            const value = parseInt(channel, 16) / 255;
            return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        });
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + .05) / (values[1] + .05);
}

async function run() {
    require("../server.js");
    const win = new BrowserWindow({show: false, width: 1200, height: 900, webPreferences: {backgroundThrottling: false, offscreen: true}});
    const js = source => win.webContents.executeJavaScript(source);
    const emulate = mode => win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features: [
        {name: "prefers-color-scheme", value: mode}, {name: "prefers-reduced-motion", value: "reduce"}
    ]});
    await win.loadURL(`http://127.0.0.1:${testPort}/app?date=2026-09-10`);
    await wait(1200);
    win.webContents.debugger.attach("1.3");
    await emulate("light");
    await js('closeModal(); openSettings("appearance"); window.RestCalI18n.setLanguage("zh");');
    const holidayEmpty = await js(`(() => {
        const original = findNextHoliday;
        try {
            findNextHoliday = () => null;
            const stats = calculateStats(currentYear, currentMonth);
            const zh = getOverviewModuleItems(stats).nextHoliday;
            window.RestCalI18n.setLanguage("en");
            const en = getOverviewModuleItems(stats).nextHoliday;
            return {zh: zh.value, en: en.value, hint: zh.meta, action: zh.action};
        } finally { findNextHoliday = original; window.RestCalI18n.setLanguage("zh"); }
    })()`);
    assert.deepEqual(holidayEmpty, {zh: "无假", en: "No holidays", hint: "已发布安排中暂无后续假期", action: ""});
    fs.mkdirSync(shots, {recursive: true});
    const backgrounds = new Set();
    for (const palette of ["paper", "forest", "ocean", "plum"]) {
        for (const mode of ["light", "dark"]) {
            const result = await js(`(() => {
                document.querySelector('[data-palette-choice="${palette}"]').click();
                document.querySelector('[data-theme-choice="${mode}"]').click();
                const style = getComputedStyle(document.documentElement);
                const color = name => style.getPropertyValue(name).trim();
                return {palette: document.documentElement.dataset.palette, mode: document.documentElement.dataset.theme,
                    background: color("--background"), ink: color("--foreground"), muted: color("--muted-foreground"),
                    primary: color("--primary"), primaryInk: color("--primary-foreground"),
                    selected: document.querySelectorAll('[data-palette-choice][aria-pressed="true"]').length,
                    meta: document.querySelector('meta[name="theme-color"]').content,
                    saved: backupUserDataSnapshot().preferences};
            })()`);
            assert.equal(result.palette, palette);
            assert.equal(result.mode, mode);
            assert.equal(result.selected, 1);
            assert.equal(result.saved.palette, palette);
            assert.equal(result.saved.theme, mode);
            assert.equal(result.meta, result.background);
            backgrounds.add(result.background);
            if (palette !== "paper") {
                assert.ok(contrast(result.ink, result.background) >= 4.5, `${palette}/${mode}: body text contrast`);
                assert.ok(contrast(result.muted, result.background) >= 4.5, `${palette}/${mode}: muted text contrast`);
                assert.ok(contrast(result.primaryInk, result.primary) >= 4.5, `${palette}/${mode}: button contrast`);
            }
            win.webContents.invalidate();
            await wait(350);
            fs.writeFileSync(path.join(shots, `theme-${palette}-${mode}.png`), (await win.webContents.capturePage()).toPNG());
        }
    }
    assert.equal(backgrounds.size, 8);
    await win.reload();
    await wait(1200);
    assert.deepEqual(await js('({palette: document.documentElement.dataset.palette, theme: document.documentElement.dataset.theme})'), {palette: "plum", theme: "dark"});
    await emulate("light");
    await js('localStorage.setItem(THEME_KEY, "auto"); applyTheme("auto");');
    for (const mode of ["light", "dark"]) {
        await emulate(mode);
        await wait(550);
        assert.equal(await js('document.documentElement.dataset.theme'), mode);
        assert.equal(await js('document.documentElement.dataset.palette'), "plum");
    }
    assert.equal(await js('restoreUserDataBackup({preferences: {palette: "ocean", theme: "light"}}); document.documentElement.dataset.palette'), "ocean");
    assert.equal(await js('restoreUserDataBackup({preferences: {palette: "invalid"}}); document.documentElement.dataset.palette'), "ocean");
    await js('closeModal(); closeSettings();');
    await wait(150);
    fs.writeFileSync(path.join(shots, "theme-ocean-calendar.png"), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(360, 780);
    await js('closeModal(); openSettings("appearance"); window.RestCalI18n.setLanguage("en");');
    await wait(500);
    const mobile = await js(`(() => {
        const grid = document.querySelector(".palette-grid");
        return {fits: grid.scrollWidth <= grid.clientWidth, translated: document.getElementById("paletteLabel").textContent,
            cardsFit: [...grid.children].every(card => card.scrollWidth <= card.clientWidth)};
    })()`);
    assert.equal(mobile.fits, true);
    assert.equal(mobile.cardsFit, true);
    assert.equal(mobile.translated, "Color palette");
    fs.writeFileSync(path.join(shots, "theme-mobile.png"), (await win.webContents.capturePage()).toPNG());
    for (const [width, mode] of [[900, "light"], [360, "dark"]]) {
        win.setContentSize(width, 850);
        await js(`window.RestCalI18n.setLanguage("zh"); localStorage.setItem(THEME_KEY, "${mode}"); applyTheme("${mode}"); openSettings("data"); document.getElementById("icsCard").scrollIntoView({block: "center"});`);
        const exportUi = await js(`(() => {
            const card = document.getElementById("icsCard");
            const options = [...card.querySelectorAll("[data-ics-category]")];
            const leave = options[0];
            const checked = leave.checked;
            leave.closest("label").click();
            const toggles = leave.checked !== checked;
            leave.closest("label").click();
            return {fits: card.scrollWidth <= card.clientWidth, count: options.length, toggles,
                selected: options.filter(input => input.checked).length};
        })()`);
        assert.deepEqual(exportUi, {fits: true, count: 7, toggles: true, selected: 5});
        win.webContents.invalidate();
        await wait(400);
        fs.writeFileSync(path.join(shots, `calendar-export-${width}-${mode}.png`), (await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features: [
        {name: "prefers-reduced-motion", value: "no-preference"}
    ]});
    await js(`(async () => {
        closeSettings();
        state.onboardingCompleted = false;
        state.productTourSeenVersion = PRODUCT_TOUR_VERSION;
        openOnboarding();
        for (let i = 0; i < RestCalOnboardingView.steps.length; i++) await nextOnboardingStep();
    })()`);
    assert.equal(await js('state.onboardingCompleted && document.querySelector(".onboarding-confetti")?.children.length === 96'), true);
    assert.equal(await js(`(() => {
        const pieces = [...document.querySelector(".onboarding-confetti").children];
        return pieces.every(piece => {
            const positions = piece.getAnimations()[0].effect.getKeyframes().map(frame => Number(frame.transform.match(/translate\\([^,]+,\\s*(-?[\\d.]+)px\\)/)[1]));
            return parseFloat(getComputedStyle(piece).width) <= 3 && positions.every((y, index) => index === 0 || y < positions[index - 1]);
        });
    })()`), true, "Particles stay fine and move upward throughout the animation");
    assert.equal(await js('getComputedStyle(document.querySelector(".onboarding-confetti")).pointerEvents'), "none");
    win.webContents.invalidate();
    await wait(650);
    fs.writeFileSync(path.join(shots, "onboarding-celebration.png"), (await win.webContents.capturePage()).toPNG());
    await wait(2500);
    assert.equal(await js('Boolean(document.querySelector(".onboarding-confetti"))'), false);
    await js('openOnboarding(); onboardingStep = RestCalOnboardingView.steps.length - 1; renderOnboardingStep(); nextOnboardingStep();');
    await wait(200);
    assert.equal(await js('Boolean(document.querySelector(".onboarding-confetti"))'), true, "Completing the onboarding again celebrates too");
    await wait(2500);
    assert.equal(await js('Boolean(document.querySelector(".onboarding-confetti"))'), false);
    await emulate("light");
    assert.equal(await js('RestCalOnboardingView.celebrate()'), false);
    await js('openOnboarding(); skipOnboarding();');
    assert.equal(await js('Boolean(document.querySelector(".onboarding-confetti"))'), false);
    await js('productTour.finish();');
    assert.equal(await js('Boolean(document.querySelector(".onboarding-confetti"))'), false, "Tour respects reduced motion");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {features: [
        {name: "prefers-reduced-motion", value: "no-preference"}
    ]});
    await js('productTour.skip();');
    assert.equal(await js('Boolean(document.querySelector(".onboarding-confetti"))'), false, "Skipping the tour does not celebrate");
    await js('productTour.finish();');
    assert.equal(await js('document.querySelector(".onboarding-confetti")?.children.length'), 96, "Finishing the interface tour celebrates");
    await wait(2500);
    assert.equal(await js('Boolean(document.querySelector(".onboarding-confetti"))'), false);
    win.destroy();
    console.log("Theme verification passed: 8 palettes/modes, contrast, persistence, system mode, mobile and English.");
}

app.whenReady().then(run).then(() => app.quit()).catch(error => {console.error(error); app.exit(1);});
app.on("quit", () => fs.rmSync(auditUserData, {recursive: true, force: true}));
