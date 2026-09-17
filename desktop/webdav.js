const {net} = require("electron");

const ALLOWED_METHODS = new Set(["GET", "PUT", "PROPFIND", "MKCOL"]);
const REQUEST_TIMEOUT_MS = 25_000;

function normalizeRequest({method, url, headers, body} = {}) {
    const normalizedMethod = String(method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(normalizedMethod)) {
        throw new Error(`不支持 WebDAV 操作 ${normalizedMethod}`);
    }

    let target;
    try {
        target = new URL(String(url || ""));
    } catch {
        throw new Error("WebDAV 地址无效");
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
        throw new Error("WebDAV 地址必须以 http:// 或 https:// 开头");
    }
    if (target.username || target.password) {
        throw new Error("请不要在 WebDAV 地址中包含用户名或密码");
    }

    const normalizedHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
        if (value == null || /^content-length$/i.test(name)) continue;
        normalizedHeaders[String(name)] = String(value);
    }

    return {
        method: normalizedMethod,
        url: target.toString(),
        headers: normalizedHeaders,
        body: body == null ? undefined : String(body)
    };
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
