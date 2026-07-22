<div align="center">

<img src="icons/icon-192.png" width="88" alt="休历图标">

# 休历 · RestCal

**请假、出勤、工资核算、购票提醒 —— 一页搞定的中国职场日历**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![PWA](https://img.shields.io/badge/PWA-offline--ready-5A0FC8)
![Zero Build](https://img.shields.io/badge/build-zero%20dependency-orange)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Windows-blue)

**[🌐 立即使用](https://restcal.abohack.com/app.html)** · [产品主页](https://restcal.abohack.com) · [Telegram 频道](https://t.me/restcalabohack) · [下载桌面版](#-桌面版windows) · [问题反馈](https://github.com/skywalker23241/restcal/issues)

<img src="docs/screenshots/overview-light.png" alt="休历主界面：月历标记、本月统计、年度统计与工具面板" width="100%">

*文档中的截图均为演示数据*

</div>

---

休历是一个为中国职场人打造的请假日历工具：在月历上标记出勤和请假，自动算出勤天数、扣薪和到手工资，提前提醒节假日火车票开售，还能一键生成正式的请假条和工资条小票。

**纯前端、零构建、零依赖**——原生 HTML/CSS/JavaScript 实现，数据全部保存在本机浏览器，不注册、不上传、离线可用。农历、节气、法定节假日与调休数据（2004–2026）已完整打包在本地。

## ✨ 功能一览

### 📅 月历与请假标记

- 月历同时展示公历、农历、节气、法定节假日、调休补班和周末。
- 五种状态一键标记：出勤、事假、病假、年假、调休，支持填写请假理由和备注。
- 批量标记：选择起止日期，自动跳过周末和节假日，一次性应用到多个工作日。
- 全局搜索：按关键词、状态、日期范围快速筛选请假记录。

### 📊 月度与年度统计

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/year-stats.png" alt="年度统计：每月请假天数柱状图"></td>
    <td width="50%"><img src="docs/screenshots/year-heatmap.png" alt="年度统计：全年每日状态热力图"></td>
  </tr>
</table>

- 本月统计：应出勤、已出勤、各类请假天数、剩余年假，配合完整可见的月度热力图。
- 年度统计：按月查看请假天数柱状图，或切换到全年每日状态热力图。
- 假期额度：年假、调休的总额度与已用、剩余天数一目了然。

### 💰 工资核算与工资条

<div align="center"><img src="docs/screenshots/salary-slip.png" alt="热敏小票风格的工资条预览" width="420"></div>

- 按月薪、固定扣除（五险一金等）和各请假类型的扣款比例，实时估算当月扣薪与实际到手。
- 一键生成热敏小票风格的工资条，可下载为 PNG 图片。计算规则见[工资计算说明](#-工资计算说明)。

### 📝 一键生成请假条

<div align="center"><img src="docs/screenshots/leave-note.png" alt="请假条生成器：左侧填写信息，右侧实时预览小票" width="820"></div>

- 填写请假类型、起止日期和理由，实时生成正式的请假条文本与小票预览。
- 申请人、称呼、工作交接等默认值自动记忆，可复制文本或下载小票图片。

### 🚄 火车票购票提醒

按中国法定节假日自动计算火车票开售时间（默认提前 15 天），假期出行不再错过抢票节点。

### 🌙 深色模式

<img src="docs/screenshots/overview-dark.png" alt="休历深色主题" width="100%">

默认跟随系统，也可在顶栏于自动、浅色、深色之间手动切换。

### 📱 移动端与 PWA

<div align="center"><img src="docs/screenshots/overview-mobile.png" alt="移动端视图：核心状态卡片与紧凑月历" width="340"></div>

- 响应式布局，手机上以核心状态卡片 + 紧凑月历呈现。
- 支持安装到桌面 / 主屏幕，安装后完全离线可用（见[安装为应用](#安装为应用pwa)）。

### ☁️ 备份与云同步

<div align="center"><img src="docs/screenshots/settings.png" alt="设置面板：工资、额度、请假条默认值与 WebDAV 云备份" width="560"></div>

- 数据默认保存在本机浏览器 `localStorage`，不经过任何服务器。
- CSV 导入导出：适合手动备份和跨浏览器迁移，导入前自动校验格式。
- WebDAV 云备份：一键备份到坚果云等 WebDAV 网盘，跨设备恢复。桌面版和本地运行开箱即用；部署到静态托管的网页版需配置代理，见「[网页版 WebDAV 云备份](#网页版-webdav-云备份cloudflare-worker-代理)」。

## 🚀 快速开始

| 方式 | 适合场景 | 上手方法 |
|---|---|---|
| **在线版** | 大多数用户 | 直接打开 [restcal.abohack.com/app.html](https://restcal.abohack.com/app.html)，可安装为 PWA |
| **桌面版** | Windows 免浏览器使用 | 见[桌面版（Windows）](#-桌面版windows)，免安装单文件 exe |
| **本地运行** | 开发或内网使用 | 克隆仓库后 `node server.js`，访问 `http://localhost:8765/app.html` |

也可以直接双击打开 `app.html` 使用（站点根路径的 `index.html` 是英文介绍页，应用本体在 `app.html`）。注意：以 `file://` 方式打开时 Service Worker 不可用，页面功能正常，但没有安装和离线能力。

### 安装为应用（PWA）

通过 HTTP(S) 访问页面后（本地服务器或线上站点），可以把休历安装成应用：

- 桌面 Chrome / Edge：地址栏右侧的「安装」图标。
- Android：浏览器菜单中的「添加到主屏幕」。
- iOS Safari：分享菜单中的「添加到主屏幕」。

安装后离线也能使用：应用壳、节假日、农历和节气数据都已打包在本地（`vendor/` 目录，含 2004–2026 年），由 Service Worker 缓存。仅标题字体来自 CDN，离线时回退到系统字体。

## 💻 桌面版（Windows）

项目自带 Electron 壳，可以打包成免安装的单文件 exe：

```bash
npm install
npm run dist
```

构建完成后，`dist/` 目录下会生成 `休历-<版本>-portable.exe`，双击即可运行，无需安装 Node 或浏览器。

说明：

- 桌面版内部通过自定义 `app://` 协议加载页面，农历、节假日数据与网页版完全一致。
- 数据保存在 Electron 的本地存储中（`%APPDATA%\休历`），与浏览器中的数据互相独立，可通过 CSV 导入导出迁移。
- 开发调试可以运行 `npm start` 直接启动桌面窗口。
- 国内网络下 Electron 二进制会自动走 npmmirror 镜像；如果 `npm install` 较慢，可加 `--registry=https://registry.npmmirror.com`。
- 如果构建报错 `Cannot create symbolic link`（解压 winCodeSign 时缺少权限），可以在 Windows 设置中开启「开发者模式」后重试，或手动把 [winCodeSign-2.6.0.7z](https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z) 解压到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`（两个 macOS 符号链接解压失败可忽略）。

## 🛠 部署自己的实例

### GitHub Pages

这个项目是静态页面，可以直接部署到 GitHub Pages：

1. 将项目提交到 GitHub 仓库。
2. 进入仓库 `Settings` → `Pages`。
3. Source 选择 `Deploy from a branch`。
4. Branch 选择 `main`，目录选择 `/root`。
5. 保存后访问 GitHub Pages 地址。

### 网页版 WebDAV 云备份（Cloudflare Worker 代理）

设置面板中的「WebDAV 云备份」可以把数据备份到坚果云等支持 WebDAV 的网盘。桌面版和本地 `npm run serve` 开箱即用；但部署到 GitHub Pages 等静态托管后没有服务端，浏览器直连 WebDAV 服务器会被跨域（CORS）拦截。解决办法是部署一个 Cloudflare Worker 作为转发代理，免费额度对个人备份绰绰有余。

代理源码在 `tools/webdav-proxy-worker.js`，与 `server.js` 的本地代理逻辑一致，并自带两道防滥用限制，部署前按需修改文件顶部的两个白名单：

- `ALLOWED_TARGET_HOSTS`：允许转发到的 WebDAV 服务器域名。默认只有坚果云 `dav.jianguoyun.com`，使用其他网盘时把对应域名加进来，防止代理被当作开放中继滥用。
- `ALLOWED_ORIGINS`：允许跨域调用代理的站点地址。默认 `https://restcal.abohack.com`，改成自己的站点地址。

**第一步：创建 Worker**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 `Workers & Pages` → `Create` → `Create Worker`，名称随意（如 `xiuli-webdav`），点 `Deploy`。
2. 点 `Edit code`，把 `tools/webdav-proxy-worker.js` 的全部内容粘贴进去，替换默认代码。
3. 按上文说明修改顶部两个白名单，再次点 `Deploy`。

**第二步：接入站点（二选一）**

方式一：绑定到站点域名（推荐，前端零改动）。适用于站点域名的 DNS 托管在 Cloudflare 的情况：

1. 打开 Worker 的 `Settings` → `Domains & Routes` → `Add` → `Route`，Zone 选站点所在域名，路由填 `restcal.abohack.com/__webdav*`（换成自己的域名）。
2. 到该域名的 `DNS` 页面确认站点记录已开启橙色云（Proxied）——Worker 路由只对经过 Cloudflare 代理的流量生效。搭配 GitHub Pages 时，`SSL/TLS` 加密模式建议设为 `Full`。
3. 完成。页面请求同源的 `/__webdav` 时会被路由到 Worker，前端代码无需任何改动。

方式二：使用 workers.dev 域名。站点 DNS 不在 Cloudflare 时使用：

1. 在 Worker 的 `Settings` → `Domains & Routes` 确认 `workers.dev` 已启用，记下形如 `https://xiuli-webdav.<账户名>.workers.dev` 的地址。
2. 确认 Worker 代码里的 `ALLOWED_ORIGINS` 包含站点地址，否则浏览器跨域预检会失败。
3. 把 `app.html` 顶部的 `WEBDAV_PROXY_URL` 常量改成 `"https://xiuli-webdav.<账户名>.workers.dev/__webdav"`，递增 `sw.js` 的 `CACHE_VERSION`，重新部署站点。

**第三步：验证**

打开线上站点的设置 → WebDAV 云备份，填写服务器地址、用户名和密码（坚果云需使用「安全选项」里生成的应用专用密码），点「测试连接」。提示「连接成功，可以备份」或「目标目录还不存在」即代理部署成功；如果提示某域名「不在代理白名单中」，回到 Worker 代码给 `ALLOWED_TARGET_HOSTS` 补上该域名即可。

## 🔒 数据与隐私

用户数据只保存在本机浏览器 `localStorage` 中，不采集、不上传；WebDAV 备份是可选功能，凭据同样只存在本机，数据直达你自己的网盘。

建议定期使用右上角 CSV 图标导出备份，或在设置中配置 WebDAV 云备份。更换浏览器、清理浏览器数据或更换设备时，`localStorage` 数据可能不可用。

### CSV 字段

导出的 CSV 包含以下字段：

```text
日期,状态,请假类型,请假理由,是否节假日,是否周末,备注
```

支持的状态：

```text
出勤,事假,病假,年假,调休
```

导出文件名格式：

```text
休历-请假数据-YYYY-MM-DD.csv
```

导入时会校验字段、日期格式和状态值。校验失败时不会覆盖现有数据。

## 🧮 工资计算说明

工资计算默认规则：

- 应出勤天数：工作日 + 调休工作日，排除周末和法定节假日。
- 实际出勤天数：仅统计已明确标记为“出勤”的工作日。
- 日薪：月薪 / 应出勤天数。
- 请假扣款：各请假类型天数 * 日薪 * 对应扣款比例。

默认扣款比例：

- 事假：100%
- 病假：50%
- 年假：0%
- 调休：0%

这些比例可以在设置面板中调整。

## 📅 节假日数据源

节假日、调休、农历和节气数据来自 [Chinese Days](https://chinese-days.yaavi.me/)，已打包在 `vendor/chinese-days/` 中（2004–2026 年），不依赖网络。

数据加载失败或年份超出范围时，页面会自动回退到内置的备用节假日数据，避免日历空白。新一年的官方放假安排公布后，从 `https://cdn.jsdelivr.net/npm/chinese-days@latest/dist/years/<年份>.json` 下载文件放入 `vendor/chinese-days/years/`，并同步更新 `sw.js` 中 `YEAR_DATA` 的年份范围。

## 🧱 项目结构

```text
.
├── index.html            # 英文介绍页（站点首页）
├── app.html              # 应用主页面，包含 HTML 和 JS
├── og-image.png          # 介绍页社交分享图
├── sitemap.xml           # 站点地图（搜索引擎索引）
├── robots.txt            # 爬虫规则，引用 sitemap
├── styles.css            # 页面样式
├── manifest.webmanifest  # PWA 应用清单
├── sw.js                 # Service Worker，离线缓存
├── icons/                # PWA 应用图标
├── docs/screenshots/     # README 产品截图（演示数据）
├── vendor/chinese-days/  # 本地化的节假日、农历数据（2004-2026）
├── tools/make-icons.ps1  # 图标生成脚本
├── tools/og-image.html   # 社交分享图源文件
├── tools/webdav-proxy-worker.js  # 网页版 WebDAV 代理（Cloudflare Worker）
├── tools/readme-screenshots.cjs  # README 产品截图生成脚本（Playwright）
├── desktop/main.js       # Electron 桌面壳（Windows exe）
├── package.json          # 桌面版依赖与打包配置
├── server.js             # 本地静态预览服务器（含 WebDAV 同源代理）
└── README.md
```

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request，贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

发布新版本时需要递增 `sw.js` 顶部的 `CACHE_VERSION`，否则已安装用户的静态资源不会更新。

## 📄 许可

本项目使用 [MIT License](LICENSE)。
