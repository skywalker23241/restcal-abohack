const { app, net, safeStorage, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs/promises");
const http = require("http");
const path = require("path");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
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

async function clearTokenBundle() {
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

async function exchangeCode({clientId, code, verifier, redirectUri}) {
    return requestJson(TOKEN_URL, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({
            client_id: clientId,
            code,
            code_verifier: verifier,
            grant_type: "authorization_code",
            redirect_uri: redirectUri
        }).toString()
    });
}

async function refreshAccessToken(bundle) {
    if (!bundle?.refreshToken || !bundle?.clientId) throw new Error("Google 授权已过期，请重新连接");
    const token = await requestJson(TOKEN_URL, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({
            client_id: bundle.clientId,
            refresh_token: bundle.refreshToken,
            grant_type: "refresh_token"
        }).toString()
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
    if (!bundle) throw new Error("尚未连接 Google 日历");
    if (!bundle.accessToken || Number(bundle.expiresAt) < Date.now() + 60_000) {
        bundle = await refreshAccessToken(bundle);
    }
    return bundle;
}

async function connect(clientId) {
    const normalizedClientId = String(clientId || "").trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(normalizedClientId)) {
        throw new Error("请输入有效的 Google OAuth 客户端 ID");
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
        res.end("<!doctype html><meta charset='utf-8'><title>休历</title><style>body{font-family:system-ui;padding:48px;background:#f6f3ed;color:#241f1b}main{max-width:520px;margin:auto;background:#fff;padding:32px;border-radius:18px}h1{font-size:22px}</style><main><h1>连接完成</h1><p>可以关闭此页面，返回休历继续使用。</p></main>");
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

    const timeout = setTimeout(() => callbackReject(new Error("Google 授权等待超时，请重试")), 180_000);
    let callback;
    try {
        callback = await callbackPromise;
    } finally {
        clearTimeout(timeout);
        server.close();
    }
    if (callback.error) throw new Error(callback.error === "access_denied" ? "你取消了 Google 授权" : callback.error);
    if (!callback.code || callback.state !== state) throw new Error("Google 授权校验失败，请重试");

    const token = await exchangeCode({clientId: normalizedClientId, code: callback.code, verifier, redirectUri});
    const profile = await requestJson(USERINFO_URL, {headers: {Authorization: `Bearer ${token.access_token}`}});
    const bundle = {
        clientId: normalizedClientId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
        email: profile.email || "",
        syncedEventIds: []
    };
    if (!bundle.refreshToken) throw new Error("未获得长期授权，请移除 Google 对休历的授权后重试");
    await writeTokenBundle(bundle);
    return status();
}

async function status() {
    const bundle = await readTokenBundle();
    return bundle ? {connected: true, email: bundle.email || "", lastSyncedAt: bundle.lastSyncedAt || ""} : {connected: false};
}

async function authorizedRequest(bundle, url, options = {}) {
    try {
        return await requestJson(url, {
            ...options,
            headers: {...(options.headers || {}), Authorization: `Bearer ${bundle.accessToken}`}
        });
    } catch (error) {
        if (error.status !== 401) throw error;
        const refreshed = await refreshAccessToken(bundle);
        return requestJson(url, {
            ...options,
            headers: {...(options.headers || {}), Authorization: `Bearer ${refreshed.accessToken}`}
        });
    }
}

async function syncEvents(events = []) {
    let bundle = await validTokenBundle();
    const desired = new Set();
    let synced = 0;
    for (const event of events.slice(0, 1000)) {
        if (!event?.id || !event?.start?.date || !event?.end?.date || !event?.summary) continue;
        desired.add(event.id);
        const url = `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(event.id)}`;
        try {
            await authorizedRequest(bundle, url, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(event)
            });
        } catch (error) {
            if (error.status !== 404) throw error;
            await authorizedRequest(bundle, `${CALENDAR_API}/calendars/primary/events`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(event)
            });
        }
        synced += 1;
        bundle = await readTokenBundle() || bundle;
    }

    for (const staleId of bundle.syncedEventIds || []) {
        if (desired.has(staleId)) continue;
        try {
            await authorizedRequest(bundle, `${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(staleId)}`, {method: "DELETE"});
        } catch (error) {
            if (error.status !== 404 && error.status !== 410) throw error;
        }
    }

    const latestBundle = await readTokenBundle() || bundle;
    latestBundle.syncedEventIds = [...desired];
    latestBundle.lastSyncedAt = new Date().toISOString();
    await writeTokenBundle(latestBundle);
    return {ok: true, synced, lastSyncedAt: latestBundle.lastSyncedAt};
}

module.exports = {connect, status, syncEvents, disconnect: clearTokenBundle};
