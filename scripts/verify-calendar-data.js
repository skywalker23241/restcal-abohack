/* 内置备用节假日数据与打包数据的一致性检查。
 *
 * 同一批法定节假日/调休在仓库里有两份：
 *   1. public/assets/js/app/bootstrap.js 的 HOLIDAY_DATA——手写的兵底，远程与本地
 *      JSON 都拿不到时用它；
 *   2. public/assets/js/calendar-years.js——由 vendor/chinese-days/years/*.json 生成。
 * 两者漂移了也不会报错，只会让少数拿不到远程数据的用户看到与别人不同的日历。
 * 这里把它们钉在一起。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "..");
const jsDir = path.join(repo, "public", "assets", "js");

// 与应用里的 toISO 一致：按**本地**日期格式化。用 toISOString() 会在 UTC+8 下整体差一天。
const toISO = date =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function rangeDates(start, end) {
    const result = [];
    const cursor = new Date(`${start}T00:00:00`);
    const finish = new Date(`${end}T00:00:00`);
    while (cursor <= finish) {
        result.push(toISO(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return result;
}

// 从 bootstrap.js 里取出 HOLIDAY_DATA 字面量并求值（里面用了 rangeDates，静态解析不出来）。
const bootstrap = fs.readFileSync(path.join(jsDir, "app", "bootstrap.js"), "utf8");
const literal = bootstrap.match(/const HOLIDAY_DATA = (\{[\s\S]*?\n\});/);
assert.ok(literal, "bootstrap.js：找不到 HOLIDAY_DATA");
const fallback = vm.runInNewContext(`(${literal[1]})`, {rangeDates});

const bundleSource = fs.readFileSync(path.join(jsDir, "calendar-years.js"), "utf8");
const bundleContext = {window: {}};
vm.runInNewContext(bundleSource, bundleContext);
const bundled = bundleContext.window.RESTCAL_CALENDAR_YEARS;
assert.ok(bundled, "calendar-years.js：找不到 RESTCAL_CALENDAR_YEARS");

const problems = [];
const years = Object.keys(fallback);
assert.ok(years.length, "HOLIDAY_DATA 为空");

for (const year of years) {
    const source = bundled[year];
    if (!source) {
        problems.push(`${year}：HOLIDAY_DATA 有该年份，但 calendar-years.js 没有（先跑 npm run build:calendar）`);
        continue;
    }
    const compare = (label, mine, theirs) => {
        const a = [...mine].sort();
        const b = [...theirs].sort();
        const missing = b.filter(d => !a.includes(d));
        const extra = a.filter(d => !b.includes(d));
        if (missing.length) problems.push(`${year} ${label}：HOLIDAY_DATA 缺少 ${missing.join(", ")}`);
        if (extra.length) problems.push(`${year} ${label}：HOLIDAY_DATA 多出 ${extra.join(", ")}`);
    };
    compare("节假日", fallback[year].holidays.map(item => item.date), Object.keys(source.holidays || {}));
    compare("调休上班", fallback[year].makeupWorkdays.map(item => item.date), Object.keys(source.workdays || {}));
}

if (problems.length) {
    console.error("内置备用节假日数据与打包数据不一致：\n");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}

console.log(`Calendar fallback OK: ${years.join(", ")} 年的节假日与调休与打包数据一致。`);
