/* Netlify WebDAV 同源转发函数。
 * 浏览器只访问本站 /__webdav，由服务端连接不支持 CORS 的 WebDAV 服务。
 * 这个入口公网可达，所以用 publicPolicy()：除了三端共用的基线校验，还额外
 * 要求 HTTPS 并只放行 WEBDAV_ALLOWED_HOSTS 里的主机。规则本体见 shared/webdav-policy.js。
 */

import {ALLOWED_HOSTS_ENV, normalizeRequest, publicPolicy} from "../../shared/webdav-policy.js";

const REQUEST_TIMEOUT_MS = 20_000;

function json(status, data) {
    return Response.json(data, {
        status,
        headers: {"Cache-Control": "no-store"}
    });
}

export default async function webdav(request) {
    if (request.method !== "POST") return json(405, {error: "Method not allowed"});
    if (request.headers.get("x-xiuli-proxy") !== "1") return json(403, {error: "Forbidden"});

    let options;
    try {
        options = await request.json();
    } catch {
        return json(400, {error: "请求格式错误"});
    }

    let normalized;
    try {
        normalized = normalizeRequest(options, publicPolicy(Netlify.env.get(ALLOWED_HOSTS_ENV)));
    } catch (error) {
        return json(400, {error: error.message});
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const upstream = await fetch(normalized.url, {
            method: normalized.method,
            headers: normalized.headers,
            body: normalized.body,
            redirect: "follow",
            signal: controller.signal
        });
        return json(200, {
            ok: upstream.ok,
            status: upstream.status,
            statusText: upstream.statusText || "",
            body: await upstream.text()
        });
    } catch (error) {
        const message = error && error.name === "AbortError" ? "连接 WebDAV 服务器超时" : "无法连接 WebDAV 服务器";
        return json(502, {error: message});
    } finally {
        clearTimeout(timer);
    }
}

export const config = {
    path: "/__webdav"
};
