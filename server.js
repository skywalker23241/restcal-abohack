const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const {LOOPBACK_POLICY, normalizeRequest} = require("./shared/webdav-policy.js");
const {quoteSource, quoteRequestUrl} = require("./shared/quote-sources.js");

const root = path.join(__dirname, "public");
const port = Number(process.env.PORT || 8765);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

// 网页/PWA 版的 WebDav 同源代理：浏览器无法直接跨域访问坚果云等不发 CORS 头的
// 服务器，这里在 Node 端（不受 CORS 限制）转发请求。安全上：要求自定义请求头
// X-Xiuli-Proxy（迫使跨站请求走预检而被浏览器拦截），且服务仅监听 127.0.0.1。
// 但本机任何能发 HTTP 请求的进程都还是能调到它，所以转发什么同样要受约束：
// 校验走三端共用的 shared/webdav-policy.js（方法、协议、请求头白名单），只是本地
// 开发服务器不限主机名与明文 HTTP，否则连不了自建 Nextcloud、群晖。
// 入参 { method, url, headers, body } 与返回 { ok, status, statusText, body } 与桌面版 IPC 一致。
function proxyWebdav(req, res) {
  const sendJson = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };
  if (req.headers["x-xiuli-proxy"] !== "1") {
    sendJson(403, { error: "Forbidden" });
    return;
  }
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    let opts;
    try {
      opts = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
    } catch {
      sendJson(400, { error: "请求格式错误" });
      return;
    }
    let normalized;
    try {
      normalized = normalizeRequest(opts, LOOPBACK_POLICY);
    } catch (error) {
      sendJson(400, { error: error.message });
      return;
    }
    const target = new URL(normalized.url);
    const transport = target.protocol === "https:" ? https : http;
    const payload = normalized.body == null ? null : Buffer.from(normalized.body, "utf-8");
    const headers = { ...normalized.headers };
    if (payload) headers["Content-Length"] = payload.length;

    const upstream = transport.request(target, { method: normalized.method, headers }, up => {
      const out = [];
      up.on("data", chunk => out.push(chunk));
      up.on("end", () => {
        const status = up.statusCode || 0;
        sendJson(200, {
          ok: status >= 200 && status < 300,
          status,
          statusText: up.statusMessage || "",
          body: Buffer.concat(out).toString("utf-8")
        });
      });
    });
    upstream.on("error", err => sendJson(502, { error: err.message || "无法连接服务器" }));
    upstream.setTimeout(20000, () => upstream.destroy(new Error("连接超时")));
    if (payload) upstream.write(payload);
    upstream.end();
  });
}

// 每日一言代理。上游源与「为什么要代理」的说明集中在 shared/quote-sources.js，
// 线上的 netlify/functions/quote.mjs 用的是同一份配置。
function proxyQuote(res, lang) {
  const source = quoteSource(lang);
  const transport = source.url.startsWith("https:") ? https : http;
  const sendJson = (code, obj) => {
    if (res.headersSent) return;
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  const request = transport.get(quoteRequestUrl(source), { timeout: 6000 }, upstream => {
    const chunks = [];
    upstream.on("data", chunk => chunks.push(chunk));
    upstream.on("end", () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        // 确保返回的是数组格式（API 既可能返回对象也可能返回数组）
        const quote = Array.isArray(data) ? data[0] : data;
        if (quote && quote[source.textField]) {
          sendJson(200, quote);
        } else {
          sendJson(502, { error: "格言服务响应异常" });
        }
      } catch {
        sendJson(502, { error: "格言服务响应异常" });
      }
    });
  });
  request.on("timeout", () => request.destroy(new Error("timeout")));
  request.on("error", () => sendJson(502, { error: "无法连接格言服务" }));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  if (req.method === "POST" && pathname === "/__webdav") {
    proxyWebdav(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/__quote") {
    proxyQuote(res, url.searchParams.get("lang"));
    return;
  }

  // 与线上的 /app → app.html 重写保持一致，本地也能用无后缀路径访问应用
  const routes = { "/": "index.html", "/app": "app.html" };
  const requested = routes[pathname] || pathname.replace(/^\/+/, "");
  const file = path.resolve(root, requested);
  const relative = path.relative(root, file);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// 端口被占时必须大声报错：没有这个处理时，校验脚本 require 本文件会在启动失败后
// 继续跑，转而去测已经占着该端口的另一个服务的内容——看着通过，其实什么都没验。
server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用（另一个休历服务？）。用 PORT=其他端口 重试。`);
  } else {
    console.error(`服务启动失败：${error.message}`);
  }
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`休历 running at http://127.0.0.1:${port}/`);
});
