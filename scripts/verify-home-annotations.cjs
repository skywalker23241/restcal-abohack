const { chromium } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const port = 8810;
const base = `http://127.0.0.1:${port}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer(server) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (server.exitCode !== null) throw new Error(`Server exited with code ${server.exitCode}`);
        const ready = await new Promise(resolve => {
            const request = http.get(`${base}/index.html`, response => {
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
    throw new Error("Server did not become ready");
}

(async () => {
    const server = spawn(process.execPath, [path.join(repo, "server.js")], {
        env: {...process.env, PORT: String(port)}
    });
    await waitForServer(server);
    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({
            viewport: {width: 1568, height: 862},
            deviceScaleFactor: 1,
            locale: "zh-CN",
            serviceWorkers: "block"
        });
        await context.addInitScript(() => localStorage.setItem("restcal-home-language", "zh"));
        const page = await context.newPage();
        await page.goto(`${base}/index.html`, {waitUntil: "networkidle"});
        await page.evaluate(() => document.fonts.ready);
        await page.click('[data-hero-slide="1"]');
        await page.locator(".hero-carousel").screenshot({
            path: path.join(repo, ".tmp-calendar-audit", "home-annotation-contrast.png")
        });
        await context.close();
    } finally {
        await browser.close();
        server.kill();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
