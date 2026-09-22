/* 发布纪律检查：public/ 下的任何改动都必须伴随 public/sw.js 顶部 CACHE_VERSION 的变更。
 *
 * 否则已安装 PWA 的用户会继续命中旧缓存，拿不到更新——这条约定原本只写在
 * CONTRIBUTING.md 里靠人记住。参见 public/sw.js 的 activate 处理：只有 APP_CACHE
 * 的 key 变了，旧缓存才会被清。
 *
 * 用法：node scripts/verify-cache-version.js [baseRef]
 *   baseRef 缺省为 origin/main，对比起点是它与 HEAD 的合并基点。
 *   对比终点是工作区而不是 HEAD，这样本地提交前跑也能拿到真实结论；
 *   CI 的检出是干净的，两者等价。
 */

const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const base = process.argv[2] || process.env.RESTCAL_DIFF_BASE || "origin/main";
const SW_PATH = "public/sw.js";
const VERSION_PATTERN = /const CACHE_VERSION = "([^"]+)"/;

function git(...args) {
    return execFileSync("git", args, {cwd: repo, encoding: "utf8"});
}

function fail(...lines) {
    console.error(lines.join("\n"));
    process.exit(1);
}

function cacheVersionOf(source, origin) {
    const match = VERSION_PATTERN.exec(source);
    if (!match) fail(`${origin}：找不到 CACHE_VERSION 声明`);
    return match[1];
}

let mergeBase;
try {
    mergeBase = git("merge-base", base, "HEAD").trim();
} catch {
    fail(
        `无法解析对比基点 ${base}。`,
        "本地请先 git fetch，或显式指定：node scripts/verify-cache-version.js <baseRef>"
    );
}

// --no-renames 是必需的：默认的重命名检测只报目标路径，把文件从 public/ 移走
// 会看不到任何 public/ 条目，而那恰恰是一个预缓存资源消失了。顺带也避开了
// 结果随开发者的 diff.renames 配置飘移。
const lines = value => value.split("\n").map(line => line.trim()).filter(Boolean);
const changed = [
    ...lines(git("diff", "--name-only", "--no-renames", mergeBase)),
    ...lines(git("ls-files", "--others", "--exclude-standard"))
];

// sw.js 自己不算「需要刷新缓存的资源」：只改它本身（比如改策略注释）不强制递增。
const assetChanges = changed.filter(file => file.startsWith("public/") && file !== SW_PATH);

if (!assetChanges.length) {
    console.log(`Cache version OK: ${mergeBase.slice(0, 8)} 以来未改动 public/ 下的发布资源。`);
    process.exit(0);
}

const current = cacheVersionOf(fs.readFileSync(path.join(repo, SW_PATH), "utf8"), SW_PATH);

let baseline;
try {
    baseline = cacheVersionOf(git("show", `${mergeBase}:${SW_PATH}`), `${base}:${SW_PATH}`);
} catch {
    // 基点上还没有 sw.js（新仓库/根提交），无法对比，放行。
    console.log(`Cache version OK: 对比基点上没有 ${SW_PATH}。`);
    process.exit(0);
}

if (current === baseline) {
    fail(
        `public/ 下有 ${assetChanges.length} 个文件变更，但 ${SW_PATH} 的 CACHE_VERSION 仍为 "${current}"。`,
        "已安装 PWA 的用户会继续命中旧缓存，拿不到这些更新。",
        "请递增 CACHE_VERSION（约定格式：<版本号>-<本次改动的短名>）。",
        "",
        "变更的文件：",
        ...assetChanges.map(file => `  ${file}`)
    );
}

console.log(`Cache version OK: ${assetChanges.length} 个 public/ 文件变更，CACHE_VERSION ${baseline} → ${current}。`);
