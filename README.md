# 休历

休历是一个用于管理请假、出勤、工资扣除和节假日火车票购票提醒的单页面 Web 工具。

项目使用原生 HTML、CSS、JavaScript 实现，不依赖构建工具。数据默认保存在浏览器 `localStorage` 中，适合个人使用、备份和部署到 GitHub Pages。

## 功能

- 月历视图：按月展示公历、农历、节假日、调休、周末和工作日。
- 请假与出勤管理：支持出勤、事假、病假、年假、调休。
- 批量标记：选择开始日期和结束日期，一次性应用到多个工作日。
- 月度统计：完整可见的月度热力图。
- 年度统计：支持按月份查看请假天数柱状图，也可切换到全年每日热力图。
- 统一设置：集中维护工资、五险一金、请假扣款比例、年假额度、调休额度和请假条默认值。
- 假期额度：展示年假、调休的已用和剩余天数。
- 工资计算：按统一设置中的月薪、固定扣除，以及不同请假类型的扣款比例计算收入。
- 购票提醒：按中国法定节假日计算本月火车票开售提醒，默认提前 15 天。
- 请假条生成：根据请假类型、日期、天数和理由生成正式请假条。
- CSV 导入导出：支持数据备份和恢复。
- 本地保存：刷新页面后数据不丢失。
- PWA：支持安装到桌面 / 手机主屏幕，离线可用。
- 浅色 / 深色主题：默认跟随系统，可通过顶栏按钮在自动、浅色、深色之间切换。
- 移动端适配：支持桌面端和移动端使用。

## 安装为应用（PWA）

通过 HTTP(S) 访问页面后（本地服务器或 GitHub Pages），可以把休历安装成应用：

- 桌面 Chrome / Edge：地址栏右侧的「安装」图标。
- Android：浏览器菜单中的「添加到主屏幕」。
- iOS Safari：分享菜单中的「添加到主屏幕」。

安装后离线也能使用：应用壳、节假日、农历和节气数据都已打包在本地（`vendor/` 目录，含 2004–2026 年），由 Service Worker 缓存。仅标题字体来自 CDN，离线时回退到系统字体。

注意：直接以 `file://` 方式打开 `app.html` 时 Service Worker 不可用，页面仍可正常使用，但没有安装和离线能力。

发布新版本时需要递增 `sw.js` 顶部的 `CACHE_VERSION`，否则已安装用户的静态资源不会更新。

## 节假日数据源

节假日、调休、农历和节气数据来自 [Chinese Days](https://chinese-days.yaavi.me/)，已打包在 `vendor/chinese-days/` 中（2004–2026 年），不依赖网络。

数据加载失败或年份超出范围时，页面会自动回退到内置的备用节假日数据，避免日历空白。新一年的官方放假安排公布后，从 `https://cdn.jsdelivr.net/npm/chinese-days@latest/dist/years/<年份>.json` 下载文件放入 `vendor/chinese-days/years/`，并同步更新 `sw.js` 中 `YEAR_DATA` 的年份范围。

## 本地运行

直接打开 `app.html` 即可使用（站点根路径 `index.html` 是英文介绍页，应用本体在 `app.html`）。

如果浏览器对本地文件访问有安全限制，可以使用项目自带的本地服务器：

```bash
node server.js
```

然后打开：

```text
http://localhost:8765/app.html
```

## 桌面版（Windows exe）

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

## GitHub Pages 部署

这个项目是静态页面，可以直接部署到 GitHub Pages。

1. 将项目提交到 GitHub 仓库。
2. 进入仓库 `Settings`。
3. 打开 `Pages`。
4. Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`。
6. 保存后访问 GitHub Pages 地址。

## CSV 字段

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

## 数据存储

用户数据保存在浏览器 `localStorage` 中。

建议定期使用右上角 CSV 图标导出备份。更换浏览器、清理浏览器数据或更换设备时，`localStorage` 数据可能不可用。

## 工资计算说明

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

这些比例可以在右上角设置面板中调整。

## 项目结构

```text
.
├── index.html            # 英文介绍页（站点首页）
├── app.html              # 应用主页面，包含 HTML 和 JS
├── og-image.png          # 介绍页社交分享图
├── styles.css            # 页面样式
├── manifest.webmanifest  # PWA 应用清单
├── sw.js                 # Service Worker，离线缓存
├── icons/                # PWA 应用图标
├── vendor/chinese-days/  # 本地化的节假日、农历数据（2004-2026）
├── tools/make-icons.ps1  # 图标生成脚本
├── tools/og-image.html   # 社交分享图源文件
├── desktop/main.js       # Electron 桌面壳（Windows exe）
├── package.json          # 桌面版依赖与打包配置
├── server.js             # 本地静态预览服务器
└── README.md
```

## 许可

本项目使用 MIT License。
