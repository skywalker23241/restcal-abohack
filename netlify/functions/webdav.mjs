/* Netlify WebDAV 同源转发函数。
 * 浏览器只访问本站 /__webdav，由服务端连接不支持 CORS 的 WebDAV 服务。
 */

const DEFAULT_ALLOWED_HOSTS = ["dav.jianguoyun.com"];
const ALLOWED_METHODS = new Set(["GET", "PUT", "PROPFIND", "MKCOL"]);
const ALLOWED_HEADERS = new Set(["authorization", "cache-control", "content-type", "depth"]);

function json(status, data) {
    return Response.json(data, {
        status,
        headers: {"Cache-Control": "no-store"}
    });
}

function allowedHosts() {
    const configured = Netlify.env.get("WEBDAV_ALLOWED_HOSTS") || "";
    const hosts = configured
        .split(",")
        .map(host => host.trim().toLowerCase())
        .filter(Boolean);
    return new Set(hosts.length ? hosts : DEFAULT_ALLOWED_HOSTS);
}

function forwardedHeaders(input) {
    const result = new Headers();
    for (const [name, value] of Object.entries(input || {})) {
        if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === "string") {
            result.set(name, value);
        }
    }
    return result;
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

    const method = String(options.method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return json(400, {error: `不支持 WebDAV 操作 ${method}`});

    let target;
    try {
        target = new URL(options.url);
    } catch {
        return json(400, {error: "WebDAV 地址无效"});
    }
    if (target.protocol !== "https:") return json(400, {error: "WebDAV 地址必须使用 HTTPS"});
    if (target.username || target.password) return json(400, {error: "请不要在 WebDAV 地址中包含用户名或密码"});
    if (!allowedHosts().has(target.hostname.toLowerCase())) {
        return json(400, {
            error: `服务器 ${target.hostname} 未加入允许列表，请在 Netlify 环境变量 WEBDAV_ALLOWED_HOSTS 中添加`
        });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const upstream = await fetch(target, {
            method,
            headers: forwardedHeaders(options.headers),
            body: options.body == null ? undefined : String(options.body),
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
