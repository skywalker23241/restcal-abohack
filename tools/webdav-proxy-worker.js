/* 休历 WebDAV 代理 —— Cloudflare Worker 版
 *
 * 作用与 server.js 里的 /__webdav 代理相同：在服务端转发 WebDAV 请求，
 * 绕过浏览器跨域（CORS）限制，让部署在 GitHub Pages 等静态托管上的网页版
 * 也能使用坚果云等不发 CORS 头的 WebDAV 服务。
 * 部署步骤见 README「网页版 WebDAV 云备份（Cloudflare Worker 代理）」一节。
 *
 * 请求/响应格式与 server.js、桌面版 IPC 保持一致：
 *   POST /__webdav  入参 { method, url, headers, body }
 *   正常返回 200 { ok, status, statusText, body }；代理自身故障返回 400/403/502 { error }。
 */

// 允许转发到的 WebDAV 服务器主机名白名单。代理暴露在公网上，必须限制转发目标，
// 否则会被滥用为开放中继。使用其他网盘时把域名追加到这里。
const ALLOWED_TARGET_HOSTS = [
    "dav.jianguoyun.com"
];

// 允许跨域调用本代理的站点。绑定到站点同域名路由（README 方式一）时不依赖此列表；
// 使用 workers.dev 域名（README 方式二）时必须包含站点自己的地址，否则预检会被浏览器拦截。
const ALLOWED_ORIGINS = [
    "https://restcal.abohack.com"
];

export default {
    async fetch(request) {
        const cors = corsHeaders(request);
        if (request.method === "OPTIONS") {
            return new Response(null, {status: 204, headers: {...cors, "Access-Control-Max-Age": "86400"}});
        }
        const url = new URL(request.url);
        if (request.method !== "POST" || url.pathname !== "/__webdav") {
            return json(404, {error: "Not found"}, cors);
        }
        // 与 server.js 相同：要求自定义请求头，迫使跨站请求先走预检而被浏览器拦截
        if (request.headers.get("x-xiuli-proxy") !== "1") {
            return json(403, {error: "Forbidden"}, cors);
        }
        let opts;
        try {
            opts = await request.json();
        } catch {
            return json(400, {error: "请求格式错误"}, cors);
        }
        let target;
        try {
            target = new URL(opts.url);
        } catch {
            return json(400, {error: "WebDav 地址无效"}, cors);
        }
        if (target.protocol !== "https:" && target.protocol !== "http:") {
            return json(400, {error: "地址必须以 http:// 或 https:// 开头"}, cors);
        }
        if (!ALLOWED_TARGET_HOSTS.includes(target.hostname)) {
            return json(400, {error: `服务器 ${target.hostname} 不在代理白名单中，请在 Worker 代码的 ALLOWED_TARGET_HOSTS 里添加`}, cors);
        }
        let upstream;
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(new Error("连接超时")), 20000);
        try {
            upstream = await fetch(target, {
                method: opts.method || "GET",
                headers: opts.headers || {},
                body: opts.body == null ? null : String(opts.body),
                redirect: "follow",
                signal: timeout.signal
            });
        } catch (error) {
            return json(502, {error: (error && error.message) || "无法连接服务器"}, cors);
        } finally {
            clearTimeout(timer);
        }
        return json(200, {
            ok: upstream.ok,
            status: upstream.status,
            statusText: upstream.statusText || "",
            body: await upstream.text()
        }, cors);
    }
};

function corsHeaders(request) {
    const origin = request.headers.get("Origin");
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Xiuli-Proxy",
        "Vary": "Origin"
    };
}

function json(code, obj, extra = {}) {
    return new Response(JSON.stringify(obj), {
        status: code,
        headers: {"Content-Type": "application/json; charset=utf-8", ...extra}
    });
}
