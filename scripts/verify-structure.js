const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const publicDir = path.join(repo, "public");
const errors = [];

function requireRepoFile(file, source) {
    const absolute = path.resolve(repo, file);
    const relative = path.relative(repo, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        errors.push(`${source}: path escapes repository: ${file}`);
    } else if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        errors.push(`${source}: missing ${file}`);
    }
}

function requireFile(file, source = "project") {
    const absolute = path.resolve(publicDir, file);
    const relative = path.relative(publicDir, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        errors.push(`${source}: path escapes public/: ${file}`);
    } else if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        errors.push(`${source}: missing ${file}`);
    }
}

function localReference(value) {
    if (!value || /^(?:[a-z]+:|#|data:|\/\/|\$\{)/i.test(value)) return null;
    const reference = value.split(/[?#]/, 1)[0].replace(/^\/+/, "");
    return reference === "." || reference === "./" ? null : reference;
}

for (const htmlName of ["index.html", "app.html"]) {
    const html = fs.readFileSync(path.join(publicDir, htmlName), "utf8");
    const attributes = html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi);
    for (const match of attributes) {
        const reference = localReference(match[1]);
        if (reference) requireFile(reference, htmlName);
    }
}

for (const readmeName of ["README.md", "README.en.md"]) {
    const readme = fs.readFileSync(path.join(repo, readmeName), "utf8");
    const references = readme.matchAll(/(?:src=["']([^"']+)["']|\]\(([^)]+)\))/gi);
    for (const match of references) {
        const reference = (match[1] || match[2]).split("#", 1)[0];
        if (reference && !/^(?:[a-z]+:|#|\/\/)/i.test(reference)) {
            requireRepoFile(reference, readmeName);
        }
    }
}

if (!fs.readFileSync(path.join(repo, "README.md"), "utf8").includes("[English](README.en.md)")) {
    errors.push("README.md: English language switch is missing");
}
if (!fs.readFileSync(path.join(repo, "README.en.md"), "utf8").includes("[简体中文](README.md)")) {
    errors.push("README.en.md: Chinese language switch is missing");
}

const appHtml = fs.readFileSync(path.join(publicDir, "app.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
for (const match of appHtml.matchAll(/<button\b([^>]*\bicon-only\b[^>]*)>([\s\S]*?)<\/button>/g)) {
    const attributes = match[1];
    const content = match[2];
    if (!/\baria-label="[^"]+"/.test(attributes)) {
        errors.push("app.html: icon-only button is missing aria-label");
    }
    if (!/\btitle="[^"]+"/.test(attributes)) {
        errors.push("app.html: icon-only button is missing title");
    }
    if (!/<i\b[^>]*class="[^"]*\bph(?:-fill)?\b[^"]*\bicon\b/.test(content)) {
        errors.push("app.html: icon-only button is missing a local Phosphor icon");
    }
}

if (/<svg\b/.test(appHtml) || /<svg\b/.test(indexHtml)) {
    errors.push("HTML: UI icons must use the local Phosphor icon font, not inline SVG");
}

const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"));
for (const icon of manifest.icons || []) requireFile(localReference(icon.src), "manifest.webmanifest");

const serviceWorker = fs.readFileSync(path.join(publicDir, "sw.js"), "utf8");
const precacheSource = serviceWorker.match(/const PRECACHE = \[([\s\S]*?)\];/);
const precached = new Set();
if (!precacheSource) {
    errors.push("sw.js: PRECACHE list not found");
} else {
    for (const match of precacheSource[1].matchAll(/"([^"]+)"/g)) {
        const reference = localReference(match[1]);
        if (reference) {
            requireFile(reference, "sw.js");
            precached.add(reference);
        }
    }
}

// 每一个被页面引用的本地脚本 / 样式都必须在 PRECACHE 里。漏一个，已安装的 PWA
// 离线时就拿不到它，页面会半残；主脚本拆成多个分片后这个坑特别容易踩。
// （图片不在此列：缺失只是观感问题，不会让应用跑不起来。）
for (const htmlName of ["index.html", "app.html"]) {
    const html = fs.readFileSync(path.join(publicDir, htmlName), "utf8");
    const assets = [
        ...[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m => m[1]),
        ...[...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi)].map(m => m[1])
    ];
    for (const asset of assets) {
        const reference = localReference(asset);
        if (reference && !precached.has(reference)) {
            errors.push(`sw.js: PRECACHE 缺少 ${htmlName} 引用的 ${reference}`);
        }
    }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
if (!packageJson.build?.files?.includes("public/**")) {
    errors.push("package.json: Electron build does not include public/**");
}
if (packageJson.build?.win?.icon !== "public/assets/icons/icon-512.png") {
    errors.push("package.json: Electron icon is outside public/assets/icons");
}

if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
}

console.log("Structure OK: bilingual README, HTML, manifest, Service Worker and Electron assets resolve.");
