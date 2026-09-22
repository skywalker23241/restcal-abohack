# 发布产物

这个目录只保存**文本**：每个版本的发布说明 `RELEASE_NOTES-<版本>.md` 和校验和
`SHA256SUMS-<版本>.txt`。

安装包本身（`.apk` / `.exe` / `.zip`）**不进仓库**，只作为
[GitHub Release](https://github.com/skywalker23241/restcal-abohack/releases) 的附件分发。
Git 会永久保留每一份提交过的二进制，一个版本就是十几 MB，会压在之后所有人的
每一次 clone 上；而 Release 附件既不占仓库体积，也是用户真正下载的入口。
`.gitignore` 里已经有对应规则，建出来的包放在这个目录下不会被误提交。

## 发布一个版本

1. 构建：`npm run dist`（Windows）、`npm run build:android`（Android）。
2. 把产物放到本目录，生成校验和写入 `SHA256SUMS-<版本>.txt`。
3. 写 `RELEASE_NOTES-<版本>.md`。
4. 创建 GitHub Release，把安装包和 `SHA256SUMS-<版本>.txt` 一起作为附件上传。
5. 提交时只会带上两个文本文件，安装包被 `.gitignore` 挡住。

README 里的下载链接指向 Release 附件 URL（`releases/download/<tag>/<文件名>`），
不要改成仓库内的相对路径。
