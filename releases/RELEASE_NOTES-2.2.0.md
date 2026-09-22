# 休历 RestCal v2.2.0

这是一次架构整理与集成稳定性版本。

## 主要变化

- 将 `public/app.html` 的大型内联脚本按功能拆分为独立模块，保持零构建的前端结构。
- 修复 Google 日历同步的授权范围与写入流程，自动维护专属的「休历」日历。
- 修复同步失败时的孤儿事件清理问题，并减少同步过程中的磁盘读取。
- 新增工资与个税核算测试，修复工资条切换月份后的累计预扣计算问题。
- 补齐英文界面翻译，新增结构、缓存、日历数据和多端集成校验。
- Android 安装包改为只通过 GitHub Release 分发，不再进入 Git 仓库。

## 下载

- `RestCal-2.2.0-portable.exe`：Windows 免安装版。
- `RestCal-2.2.0-setup.exe`：Windows 安装版。
- `RestCal-2.2.0-win.zip`：Windows 解压版。
- `SHA256SUMS-2.2.0.txt`：Windows 文件完整性校验。

本次 Release 暂未附带 Android APK：当前构建环境未安装 JDK 17。Windows 构建未进行代码签名，首次运行时可能出现 SmartScreen 提示。
