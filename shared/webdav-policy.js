/* WebDAV 转发请求的共享规范化与安全策略。
 *
 * 浏览器不能直接访问坚果云等不发 CORS 头的 WebDAV 服务器，所以网页/PWA（Netlify
 * Function）、桌面版（Electron 主进程）和本地开发服务器（server.js）都要在服务端
 * 替前端转发一次。三个入口的暴露面不同，但「什么样的请求可以被转发」应当只有一套
 * 规则，这个模块就是那套规则：
 *
 *   - 基线（三端一致）：方法白名单、协议必须是 http/https、地址里不得带账号密码、
 *     请求头只放行前端真正会发的那几个。
 *   - 策略选项（按部署差异传入）：是否强制 HTTPS、主机名白名单。
 *
 * Netlify 上的 /__webdav 公网可达，用 publicPolicy()（HTTPS + 主机白名单）；桌面版
 * IPC 与 server.js 只在本机回环上，用 LOOPBACK_POLICY 继续放行任意主机和明文 HTTP，
 * 否则自建 Nextcloud、群晖这类内网服务就连不上了。
 *
 * 这个文件必须保持 CommonJS：Electron 33 内置 Node 20，require() 还加载不了 ES 模块；
 * 反过来 Netlify Functions（ESM）import 一个 CJS 模块是可以的。
 */

const ALLOWED_METHODS = new Set(["GET", "PUT", "PROPFIND", "MKCOL"]);

// 只放行 public/app.html 里确实会发的请求头。其余一律丢弃：既不把 Cookie、
// X-Forwarded-* 之类的东西捎给上游，也让 Content-Length 交回各自的 HTTP 客户端
// 按实际报文体重算。
const ALLOWED_HEADERS = new Set(["authorization", "cache-control", "content-type", "depth"]);

const DEFAULT_ALLOWED_HOSTS = ["dav.jianguoyun.com"];
const ALLOWED_HOSTS_ENV = "WEBDAV_ALLOWED_HOSTS";

// 本机回环入口（桌面版 IPC、server.js）：只有能访问本机的进程才够得着，所以不限制
// 主机名和协议，自建服务器才能用。
const LOOPBACK_POLICY = Object.freeze({
    requireHttps: false,
    allowedHosts: null,
    allowedHostsHint: ""
});

// 解析逗号分隔的主机白名单配置，留空则回落到默认值。
function parseAllowedHosts(configured) {
    const hosts = String(configured || "")
        .split(",")
        .map(host => host.trim().toLowerCase())
        .filter(Boolean);
    return new Set(hosts.length ? hosts : DEFAULT_ALLOWED_HOSTS);
}

// 公网入口（Netlify /__webdav）：任何人都能 POST 过来，必须限定 HTTPS 与主机白名单，
// 否则就成了一个人人可用的转发器。
function publicPolicy(configuredHosts) {
    return Object.freeze({
        requireHttps: true,
        allowedHosts: parseAllowedHosts(configuredHosts),
        allowedHostsHint: `请在 Netlify 环境变量 ${ALLOWED_HOSTS_ENV} 中添加`
    });
}

/* 校验并规范化前端发来的 { method, url, headers, body }。
 * 通过则返回同样形状的安全副本，可以直接交给 fetch / http.request；
 * 不通过则抛出带中文说明的 Error，调用方按 400 回给前端。
 * policy 必须显式传入，避免漏传时悄悄退回宽松策略。
 */
function normalizeRequest({method, url, headers, body} = {}, policy) {
    if (!policy) throw new Error("normalizeRequest 缺少代理策略参数");

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
    if (policy.requireHttps) {
        if (target.protocol !== "https:") throw new Error("WebDAV 地址必须使用 HTTPS");
    } else if (target.protocol !== "https:" && target.protocol !== "http:") {
        throw new Error("WebDAV 地址必须以 http:// 或 https:// 开头");
    }
    // 地址里的 user:pass 会被当成凭据发给上游，也会被日志原样记下，一律拒绝。
    if (target.username || target.password) {
        throw new Error("请不要在 WebDAV 地址中包含用户名或密码");
    }
    if (policy.allowedHosts && !policy.allowedHosts.has(target.hostname.toLowerCase())) {
        const hint = policy.allowedHostsHint ? `，${policy.allowedHostsHint}` : "";
        throw new Error(`服务器 ${target.hostname} 未加入允许列表${hint}`);
    }

    const normalizedHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
        if (value == null) continue;
        if (!ALLOWED_HEADERS.has(String(name).toLowerCase())) continue;
        const headerValue = String(value);
        // 换行符会被上游读成另一个请求头，而 Node 的 http.request 碰到它直接报错，
        // 这里先拦下来。合法的四个请求头不会带控制字符。
        if (/[\r\n\0]/.test(headerValue)) {
            throw new Error(`WebDAV 请求头 ${name} 包含非法字符`);
        }
        normalizedHeaders[String(name)] = headerValue;
    }

    return {
        method: normalizedMethod,
        url: target.toString(),
        headers: normalizedHeaders,
        body: body == null ? undefined : String(body)
    };
}

module.exports = {
    ALLOWED_METHODS,
    ALLOWED_HEADERS,
    ALLOWED_HOSTS_ENV,
    DEFAULT_ALLOWED_HOSTS,
    LOOPBACK_POLICY,
    parseAllowedHosts,
    publicPolicy,
    normalizeRequest
};
