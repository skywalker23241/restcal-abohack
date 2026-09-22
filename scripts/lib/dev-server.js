/* 校验脚本共用的本地服务启动入口。
 *
 * 以前每个脚本都把 8765 写死在 URL 里，而 server.js 只能监听一个端口：当机器上
 * 已经有一个 `npm run serve` 占着 8765 时，启动失败被吞掉，校验脚本转而去加载
 * 那个服务的页面——可能根本不是当前工作区，结果看着通过，其实什么都没验。
 *
 * 现在统一从这里启动：默认抓一个空闲端口（所以能与开发服务共存），并在返回前
 * 核对应答的确实是本仓库的 public/。
 */

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const repo = path.resolve(__dirname, "..", "..");

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const {port} = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function startDevServer() {
    const port = process.env.PORT ? Number(process.env.PORT) : await freePort();
    process.env.PORT = String(port);
    require(path.join(repo, "server.js"));

    const origin = `http://127.0.0.1:${port}`;
    // 用一个只有本工作区才有的文件做哨兵，确认请求没有落到别的服务上。
    const sentinel = "manifest.webmanifest";
    const expected = fs.readFileSync(path.join(repo, "public", sentinel), "utf8");
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const response = await fetch(`${origin}/${sentinel}`);
            if (response.ok && (await response.text()) === expected) return {port, origin};
            throw new Error(`端口 ${port} 上的服务不是本工作区的 public/`);
        } catch (error) {
            if (error.message.includes("不是本工作区")) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    throw new Error(`本地服务在 ${origin} 上未能就绪`);
}

module.exports = {startDevServer};
