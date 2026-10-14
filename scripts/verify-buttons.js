const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow} = require("electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "restcal-buttons-"));
app.setPath("userData", profile);
process.env.PORT = "8884";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function contrast(a, b) {
    const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
        .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const light = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light[0] + .05) / (light[1] + .05);
}
async function run() {
    require("../server.js");
    const win = new BrowserWindow({show: false, width: 1100, height: 850, webPreferences: {offscreen: true, backgroundThrottling: false}});
    const js = source => win.webContents.executeJavaScript(source);
    await win.loadURL("http://127.0.0.1:8884/app");
    await wait(1000);
    await js('closeOnboarding(); openSettings("data"); window.RestCalI18n.setLanguage("zh");');
    const shots = path.join(__dirname, "shots"); fs.mkdirSync(shots, {recursive: true});
    for (const palette of ["paper", "forest", "ocean", "plum"]) {
        for (const mode of ["light", "dark"]) {
            await js('applyTheme("' + mode + '"); setPalette("' + palette + '");');
            await wait(200);
            const buttons = await js(`(() => {
                const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
                const rgb = color => {ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data];};
                return ["#exportCsv", "#openTicketSettings", "#closeTicketTool", "#settingsToggle", "#prevMonth", "#ticketOriginPicker", ".ticket-links .ticket-sale-link", "#ticketBookingLink", "#clearAllData"].map(selector => {
                    const button = document.querySelector(selector), style = getComputedStyle(button);
                    return {selector, text: rgb(style.color), background: rgb(style.backgroundColor), border: rgb(style.borderTopColor), borderWidth: style.borderTopWidth, opacity: style.opacity,
                        softBorder: rgb(getComputedStyle(document.documentElement).getPropertyValue("--button-border"))};
                });
            })()`);
            for (const button of buttons) {
                const context = `${palette}/${mode} ${button.selector}`;
                assert.equal(button.background[3], 255, `${context}: visible default surface`);
                assert.ok(contrast(button.text, button.background) >= 4.5, `${context}: readable default text`);
                if (button.selector === "#clearAllData") assert.ok(contrast(button.border, button.background) >= 3, `${context}: warning boundary`);
                else if (button.selector !== "#ticketBookingLink") {
                    if (["#openTicketSettings", "#closeTicketTool", "#settingsToggle", "#prevMonth", ".ticket-links .ticket-sale-link"].includes(button.selector)) {
                        assert.equal(button.border[3], 0, `${context}: quiet icon/ghost outline`);
                    } else assert.deepEqual(button.border, button.softBorder, `${context}: soft themed outline, not a dark frame`);
                }
                assert.equal(button.borderWidth, "1px");
                assert.equal(button.opacity, "1");
            }
            if (palette === "paper") {
                win.webContents.invalidate(); await wait(250);
                fs.writeFileSync(path.join(shots, `buttons-${mode}.png`), (await win.webContents.capturePage()).toPNG());
            }
        }
    }
    assert.equal(await js('document.getElementById("exportCsv").disabled = true; getComputedStyle(document.getElementById("exportCsv")).opacity'), "0.55");
    await js('document.getElementById("exportCsv").disabled = false;');
    win.setContentSize(360, 850); await wait(300);
    assert.equal(await js('document.querySelector(".settings-page").scrollWidth <= document.querySelector(".settings-page").clientWidth'), true);
    fs.writeFileSync(path.join(shots, "buttons-mobile.png"), (await win.webContents.capturePage()).toPNG());
    win.destroy();
    console.log("Buttons verified: 8 themes, readable text, soft theme outlines, disabled states and mobile layout.");
}
app.whenReady().then(run).then(() => app.exit(0)).catch(error => {console.error(error); app.exit(1);});
app.on("quit", () => fs.rmSync(profile, {recursive: true, force: true}));
