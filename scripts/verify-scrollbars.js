const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {app, BrowserWindow} = require("electron");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "restcal-scrollbars-"));
app.setPath("userData", profile);
process.env.PORT = "8883";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    require("../server.js");
    const win = new BrowserWindow({show: false, width: 1100, height: 850, webPreferences: {offscreen: true, backgroundThrottling: false}});
    const js = source => win.webContents.executeJavaScript(source);
    await win.loadURL("http://127.0.0.1:8883/app");
    await wait(1000);
    await js('closeOnboarding(); openSettings("data");');
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("DOM.enable");
    await win.webContents.debugger.sendCommand("CSS.enable");
    const documentNode = await win.webContents.debugger.sendCommand("DOM.getDocument");
    const panelNode = await win.webContents.debugger.sendCommand("DOM.querySelector", {nodeId: documentNode.root.nodeId, selector: ".settings-panels"});
    for (const classes of [["hover"], []]) {
        await win.webContents.debugger.sendCommand("CSS.forcePseudoState", {nodeId: panelNode.nodeId, forcedPseudoClasses: classes});
        assert.equal(await js('getComputedStyle(document.querySelector(".settings-panels")).scrollbarColor'), "auto", "Chromium must use the same WebKit scrollbar renderer both hovered and idle");
        assert.equal(await js('getComputedStyle(document.querySelector(".settings-panels"), "::-webkit-scrollbar").width'), "6px");
    }
    win.webContents.debugger.detach();
    const colors = new Set();
    const shots = path.join(__dirname, "shots");
    fs.mkdirSync(shots, {recursive: true});
    for (const palette of ["paper", "forest", "ocean", "plum"]) {
        for (const mode of ["light", "dark"]) {
            const result = await js(`(() => {
                setPalette("${palette}"); applyTheme("${mode}"); setPalette("${palette}");
                const panel = document.querySelector(".settings-panels");
                panel.scrollTop = 100;
                const thumb = getComputedStyle(panel, "::-webkit-scrollbar-thumb");
                return {width: getComputedStyle(panel, "::-webkit-scrollbar").width,
                    color: thumb.backgroundColor, radius: thumb.borderRadius,
                    track: getComputedStyle(panel, "::-webkit-scrollbar-track").backgroundColor,
                    scrolled: panel.scrollTop > 0,
                    stationHidden: getComputedStyle(document.getElementById("stationPickerList")).scrollbarWidth,
                    indexHidden: getComputedStyle(document.getElementById("stationPickerIndex"), "::-webkit-scrollbar").display};
            })()`);
            assert.equal(result.width, "6px");
            assert.equal(result.radius, "999px");
            assert.equal(result.track, "rgba(0, 0, 0, 0)");
            assert.equal(result.scrolled, true);
            assert.equal(result.stationHidden, "none");
            assert.equal(result.indexHidden, "none");
            colors.add(result.color);
            if (palette === "paper") {
                win.webContents.invalidate(); await wait(250);
                fs.writeFileSync(path.join(shots, `scrollbars-${mode}.png`), (await win.webContents.capturePage()).toPNG());
            }
        }
    }
    assert.equal(colors.size, 8, "Scrollbar colors must follow all palettes and light/dark modes");
    for (const page of ["index.html", "privacy.html"]) {
        await win.loadURL(`http://127.0.0.1:8883/${page}`);
        assert.equal(await js('getComputedStyle(document.documentElement, "::-webkit-scrollbar").width'), "6px");
        assert.equal(await js('Boolean(document.querySelector(\'link[href="assets/css/scrollbars.css"]\'))'), true);
        assert.equal(await js('window.scrollTo({top: 200, behavior: "instant"}); window.scrollY > 0'), true);
    }
    win.destroy();
    console.log("Scrollbars verified: all pages, 8 theme variants, actual scrolling and hidden pickers.");
}
app.whenReady().then(run).then(() => app.exit(0)).catch(error => {console.error(error); app.exit(1);});
app.on("quit", () => fs.rmSync(profile, {recursive: true, force: true}));
