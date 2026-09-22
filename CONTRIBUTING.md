# Contributing

欢迎改进休历。

## 开发方式

项目没有前端构建步骤，发布文件统一放在 `public/`。介绍页是
`public/index.html`，应用页面是 `public/app.html`。

### 主脚本的组织方式

应用逻辑在 `public/assets/js/app/` 下按关注点分成多个文件，由 `app.html` 按固定顺序加载。
它们是**传统 `<script>` 而不是 ES module**（零构建约束），顶层的 `function` / `const` / `let`
共享同一个全局词法作用域，所以跨文件直接引用即可，不需要 import/export。两条规矩：

- **分片文件只声明，不执行。** 任何会立即执行的顶层语句（常量、模块级状态、`els`、
  启动调用）都放在最后加载的 `app/bootstrap.js`。这样就不存在“某个 const 在那个函数
  跑之前初始化了吗”的问题。
- **新增分片要同步三处：** `app.html` 的 `<script>`、`public/sw.js` 的 `PRECACHE`、
  以及本文的加载顺序说明。前两处漏了 `verify:structure` 会报错。

本地预览：

```bash
node server.js
```

然后访问：

```text
http://localhost:8765/
```

## 自动检查

下面这组检查不需要安装任何依赖，干净检出上直接就能跑，每次 push 和 PR 也会在
GitHub Actions（`.github/workflows/verify.yml`）上自动执行：

```bash
npm run verify
```

它包含：

- `verify:structure`：HTML / README / manifest / `sw.js` 里的本地引用都能解析，图标按钮带
  `aria-label`。
- `verify:server`：`server.js` 的路由和 Content-Type。
- `test`：iCalendar 导出（`test-ics.js`）、工资与个税核算（`test-payroll.js`）、
  Google 日历单向同步协议（`test-google-sync.js`，对着内存版 Google API 跑，不需要真实账号）、
  WebDAV 转发策略（`test-webdav-policy.js`，对着本机的假 WebDAV 服务器跑，不访问外网）。
- `verify:cache-version`：改动了 `public/` 就必须递增 `public/sw.js` 的 `CACHE_VERSION`。
  缺省对比 `origin/main`，也可以显式指定：`node scripts/verify-cache-version.js <baseRef>`。

需要 Electron 或图形界面的 `verify:mobile`、`verify:overview`、`verify:calendar`、
`verify:integrations`、`verify:i18n` 不在 CI 里（要先 `npm install`），改动渲染、布局、
文案或桌面通道时请在本地跑。它们通过 `scripts/lib/dev-server.js` 启动本地服务：默认抓一个**空闲端口**，
所以可以和已在跑的 `npm run serve` 共存；启动后还会核对应答确实来自当前工作区。

> 这一点曾经出过问题：旧版把 `8765` 写死在 URL 里，当该端口已被占用时，`server.js`
> 启动失败被吞掉，校验脚本转而去加载**另一个目录**的页面并报“通过”。如果你要新增
> 此类脚本，请用 `startDevServer()`，不要再写死端口。

## 提交建议

- 保持原生 HTML/CSS/JavaScript 实现，避免引入不必要的依赖。
- 修改统计、工资、CSV 或节假日逻辑时，请同时检查导入导出和本地保存行为。
- 纯计算放在 `public/assets/js/` 的独立模块里（`payroll.js`、`ics-exporter.js`），不读 DOM
  也不读全局状态，这样可以用普通 `node` 直接测。新增此类模块时记得同步加进
  `public/app.html` 的 `<script>`、`public/sw.js` 的 `PRECACHE`，并配一个 `scripts/test-*.js`。
- `shared/` 里是三个发行形态共用的服务端配置（WebDAV 转发策略、每日一言上游）。
  这些文件必须保持 CommonJS：Electron 33 内置的 Node 20 用 `require()` 加载不了 ES 模块，
  而 Netlify Functions（ESM）可以直接 `import` CJS。改 WebDAV 转发规则只改
  `shared/webdav-policy.js`，不要在各自的代理里再写一份白名单。
- UI 修改需要兼顾桌面端和移动端。
- 节假日数据来自 `public/assets/vendor/chinese-days/`，保留本地回退逻辑。
- 修改任何静态资源后，发布前递增 `public/sw.js` 顶部的 `CACHE_VERSION`，否则已安装的 PWA 用户拿不到更新（`verify:cache-version` 会把关）。
- 改动应用内的中文文案时，同步更新 `public/assets/js/app-i18n-v1.4.9.js` 里的词条：英文翻译是按中文原文匹配的，改了句子而不改词典会静默退回中文。改完跑 `npm run verify:i18n`：它会把应用切到英文、把主要视图与弹窗都展开一遍，再扫描真实渲染出来的文本里还有没有汉字。
- 拼接出来的文本（“节日 · 去程”这类）不要逐种组合写正则：用 ` · ` 分隔的复合文本会自动逐段翻译，只需保证每一段在词典里。

## 发布前检查

- 页面可以正常打开。
- 月历可以切换月份和年份。
- 日期状态可以保存到 `localStorage`。
- CSV 可以导入和导出。
- 工资计算结果符合当前扣款比例。
- 移动端布局没有横向溢出。
- `public/sw.js` 的 `CACHE_VERSION` 已递增，断网刷新页面仍可正常使用。
