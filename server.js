const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const root = __dirname;
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
    let target;
    try {
      target = new URL(opts.url);
    } catch {
      sendJson(400, { error: "WebDav 地址无效" });
      return;
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      sendJson(400, { error: "地址必须以 http:// 或 https:// 开头" });
      return;
    }
    const transport = target.protocol === "https:" ? https : http;
    const payload = opts.body == null ? null : Buffer.from(String(opts.body), "utf-8");
    const headers = { ...(opts.headers || {}) };
    if (payload) headers["Content-Length"] = payload.length;

    const upstream = transport.request(target, { method: opts.method || "GET", headers }, up => {
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

  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
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

server.listen(port, "127.0.0.1", () => {
  console.log(`休历 running at http://127.0.0.1:${port}/`);
});
