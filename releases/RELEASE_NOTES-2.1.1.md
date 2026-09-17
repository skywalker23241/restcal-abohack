# 休历 RestCal v2.1.1

这是 `v2.1.0` 的桌面端连接修复版本。

## 修复内容

- 桌面端 WebDAV 改用 Electron 原生网络通道，能够继承 Windows 系统代理和证书配置。
- 修复浏览器可以连接 WebDAV、但 Windows 桌面版显示超时或无法连接的问题。
- 新增桌面 IPC、Basic Auth、`PROPFIND` 和 `207 Multi-Status` 的端到端自动验证。

## 下载

- `RestCal-2.1.1-portable.exe`：Windows 免安装版。
- `RestCal-2.1.1-setup.exe`：Windows 安装版。
- `RestCal-2.1.1-win.zip`：Windows 解压版。
- `RestCal-2.1.1-android.apk`：Android 安装包（调试签名）。
- `SHA256SUMS-2.1.1.txt`：文件完整性校验。

Windows 构建暂未进行代码签名，首次运行时可能出现 SmartScreen 提示。
