/* 桌面版的 WebDAV 转发：渲染进程走 IPC 把请求交给主进程，由 Electron 的 net 模块
 * 发出（不受渲染进程的 CORS 限制，也支持 PROPFIND、MKCOL 这类 WebDAV 方法）。
 * 请求校验走与网页版、server.js 共用的基线策略；这条链路只在用户自己机器上，
 * 所以用 LOOPBACK_POLICY 保留任意主机与明文 HTTP，自建 Nextcloud、群晖才能连。
 */

const {net} = require("electron");
const {LOOPBACK_POLICY, normalizeRequest: normalize} = require("../shared/webdav-policy.js");

const REQUEST_TIMEOUT_MS = 25_000;

function normalizeRequest(options = {}) {
    return normalize(options, LOOPBACK_POLICY);
}

async function request(options = {}) {
    const normalized = normalizeRequest(options);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await net.fetch(normalized.url, {
            method: normalized.method,
            headers: normalized.headers,
            body: normalized.body,
            redirect: "follow",
            signal: controller.signal,
            bypassCustomProtocolHandlers: true
        });
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText || "",
            body: await response.text()
        };
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("连接 WebDAV 服务器超时");
        throw new Error(error?.message || "无法连接 WebDAV 服务器");
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {normalizeRequest, request};
