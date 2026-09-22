const { app, net, safeStorage, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const calendarSync = require("./google-calendar-sync");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
// calendar.app.created 只能操作本应用创建的次级日历，不包含主日历；
// 同步目标相应地是专属日历，详见 google-calendar-sync.js。
const SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.app.created"
];

function tokenFile() {
    return path.join(app.getPath("userData"), "google-calendar-token.json");
}

function encodeBase64Url(buffer) {
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function readTokenBundle() {
    try {
        const saved = JSON.parse(await fs.readFile(tokenFile(), "utf8"));
        if (!saved?.payload) return null;
        const encrypted = Buffer.from(saved.payload, "base64");
        const plain = safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(encrypted)
            : encrypted.toString("utf8");
        return JSON.parse(plain);
    } catch {
        return null;
    }
}

async function writeTokenBundle(bundle) {
    const plain = JSON.stringify(bundle);
    const payload = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(plain)
        : Buffer.from(plain, "utf8");
    await fs.writeFile(tokenFile(), JSON.stringify({payload: payload.toString("base64")}), {mode: 0o600});
}

// 断开连接：丢掉令牌，但保留 calendarId（规则见 google-calendar-sync.js）。
async function clearTokenBundle() {
    const next = calendarSync.bundleAfterDisconnect(await readTokenBundle());
    if (next) {
        await writeTokenBundle(next);
        return;
    }
    await fs.rm(tokenFile(), {force: true});
}

async function requestJson(url, options = {}) {
    const response = await net.fetch(url, options);
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {message: text}; }
    if (!response.ok) {
        const message = body?.error_description || body?.error?.message || body?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }
    return body;
}

// Google 的桌面应用客户端虽然走 PKCE，令牌端点仍然要求带 client_secret（不带会得到
// 400 client_secret is missing）——只有 Android / iOS / Chrome 类型的客户端不适用。
// Google 自己也承认安装类应用无法保守秘密，这个“密钥”实际上只是客户端标识的
// 一部分；即便如此，它仍然和刷新令牌一起走 safeStorage 加密落盘，不进 localStorage。
function tokenRequestBody(fields, clientSecret) {
    const body = new URLSearchParams(fields);
    if (clientSecret) body.set("client_secret", clientSecret);
    return body.toString();
}

async function exchangeCode({clientId, clientSecret, code, verifier, redirectUri}) {
    return requestJson(TOKEN_URL, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: tokenRequestBody({
            client_id: clientId,
            code,
            code_verifier: verifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri
        }, clientSecret)
    });
}

async function refreshAccessToken(bundle) {
    if (!bundle?.refreshToken || !bundle?.clientId) throw new Error("Google 授权已过期，请重新连接");
    const token = await requestJson(TOKEN_URL, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: tokenRequestBody({
            client_id: bundle.clientId,
            refresh_token: bundle.refreshToken,
            grant_type: "refresh_token"
        }, bundle.clientSecret)
    });
    const next = {
        ...bundle,
        accessToken: token.access_token,
        expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000
    };
    await writeTokenBundle(next);
    return next;
}

async function validTokenBundle() {
    let bundle = await readTokenBundle();
    // 断开后文件里只剩 calendarId，没有刷新令牌就是“未连接”，而不是“授权过期”。
    if (!calendarSync.isConnected(bundle)) throw new Error("尚未连接 Google 日历");
    if (!bundle.accessToken || Number(bundle.expiresAt) < Date.now() + 60_000) {
        bundle = await refreshAccessToken(bundle);
    }
    return bundle;
}

async function connect(clientId, clientSecret) {
    const normalizedClientId = String(clientId || "").trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(normalizedClientId)) {
        throw new Error("请输入有效的 Google OAuth 客户端 ID");
    }
    // 同一个客户端重连时不必重填密钥：没填就沿用上次加密保存的那个。
    const saved = await readTokenBundle();
    const normalizedSecret = String(clientSecret || "").trim()
        || (saved?.clientId === normalizedClientId ? saved.clientSecret || "" : "");
    if (!normalizedSecret) {
        throw new Error("请填写客户端密钥：Google 的桌面应用客户端在换取令牌时必须带上它");
    }

    const verifier = encodeBase64Url(crypto.randomBytes(48));
    const challenge = encodeBase64Url(crypto.createHash("sha256").update(verifier).digest());
    const state = encodeBase64Url(crypto.randomBytes(24));

    let callbackResolve;
    let callbackReject;
    const callbackPromise = new Promise((resolve, reject) => {
        callbackResolve = resolve;
        callbackReject = reject;
    });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname !== "/oauth/google/callback") return res.writeHead(404).end("Not found");
        res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
        res.end("<!doctype html><meta charset='utf-8'><title>休历</title><style>body{font-family:system-ui;padding:48px;background:#f6f3ed;color:#241f1b}main{max-width:520px;margin:auto;background:#fff;padding:32px;border-radius:18px}h1{font-size:22px}</style><main><h1>授权回调已收到</h1><p>可以关闭此页面，返回休历查看连接结果。</p></main>");
        callbackResolve({code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error")});
        server.close();
    });
    server.on("error", callbackReject);
    await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
    const port = server.address().port;
    const redirectUri = `http://127.0.0.1:${port}/oauth/google/callback`;
    const authUrl = new URL(AUTH_URL);
    authUrl.search = new URLSearchParams({
        client_id: normalizedClientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
    }).toString();
    await shell.openExternal(authUrl.toString());

    // 授权页报错时浏览器根本不会回调本机，这边只能等到超时。最常见的原因只有一个：
    // 客户端类型选成了“Web 应用”。Web 类型要求预先登记固定端口的重定向地址，而本地
    // 回环流程每次用随机端口，Google 会直接报 redirect_uri_mismatch。把这个写进提示，
    // 比让人对着“等待超时”猜三分钟强。
    const timeoutMessage = "等不到 Google 授权回调。最常见原因：OAuth 客户端类型选成了“Web 应用”，"
        + "它不允许本机随机端口回调（授权页会报 redirect_uri_mismatch）。请在 Google Cloud Console "
        + "重新创建一个“桌面应用”类型的客户端 ID。";
    const timeout = setTimeout(() => callbackReject(new Error(timeoutMessage)), 180_000);
    let callback;
    try {
        callback = await callbackPromise;
    } finally {
        clearTimeout(timeout);
        server.close();
    }
    if (callback.error) throw new Error(callback.error === "access_denied" ? "你取消了 Google 授权" : callback.error);
    if (!callback.code || callback.state !== state) throw new Error("Google 授权校验失败，请重试");

    const token = await exchangeCode({
        clientId: normalizedClientId,
        clientSecret: normalizedSecret,
        code: callback.code,
        verifier,
        redirectUri
    });
    const profile = await requestJson(USERINFO_URL, {headers: {Authorization: `Bearer ${token.access_token}`}});
    const bundle = calendarSync.bundleForReconnect(await readTokenBundle(), {
        clientId: normalizedClientId,
        clientSecret: normalizedSecret,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
        email: profile.email || ""
    });
    if (!bundle.refreshToken) throw new Error("未获得长期授权，请移除 Google 对休历的授权后重试");
    await writeTokenBundle(bundle);
    return status();
}

async function status() {
    const bundle = await readTokenBundle();
    if (!calendarSync.isConnected(bundle)) return {connected: false};
    return {connected: true, email: bundle.email || "", lastSyncedAt: bundle.lastSyncedAt || ""};
}

// 把鉴权、刷新和落盘包成 google-calendar-sync.js 约定的 session。刷新令牌后
// 直接替换 session.bundle，同步过程全程用同一份内存状态，不再逐事件回读磁盘。
function createSession(bundle) {
    const authorized = (options, accessToken) => ({
        ...options,
        headers: {...(options.headers || {}), Authorization: `Bearer ${accessToken}`}
    });
    const session = {
        bundle,
        async request(url, options = {}) {
            try {
                return await requestJson(url, authorized(options, session.bundle.accessToken));
            } catch (error) {
                if (error.status !== 401) throw error;
                session.bundle = await refreshAccessToken(session.bundle);
                return requestJson(url, authorized(options, session.bundle.accessToken));
            }
        },
        async save(next) {
            session.bundle = next;
            await writeTokenBundle(next);
        }
    };
    return session;
}

async function syncEvents(events = []) {
    const session = createSession(await validTokenBundle());
    return calendarSync.syncEvents(session, events);
}

module.exports = {connect, status, syncEvents, disconnect: clearTokenBundle};
