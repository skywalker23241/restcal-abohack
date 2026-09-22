/* WebDAV 转发策略的回归测试。
 *
 * 网页/PWA（netlify/functions/webdav.mjs）、桌面版（desktop/webdav.js）和本地开发
 * 服务器（server.js）共用 shared/webdav-policy.js。这里钉住两件事：
 *
 *   1. 三端共用的基线（方法、协议、地址里的账号密码、请求头白名单）完全一致；
 *   2. 故意保留的差异：公网入口强制 HTTPS + 主机白名单，回环入口放行任意主机
 *      与明文 HTTP（自建 Nextcloud、群晖要用）。
 *
 * 不需要 Electron、不装任何依赖、不访问外网：真实转发路径对着本机的假 WebDAV
 * 服务器跑，所以可以进 CI。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {spawn} = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const policy = require("../shared/webdav-policy.js");
const {LOOPBACK_POLICY, normalizeRequest, publicPolicy} = policy;

const PUBLIC_POLICY = publicPolicy("");

function rejects(run, expectedMessage, description) {
    assert.throws(run, error => {
        assert.equal(error.message, expectedMessage, description);
        return true;
    }, description);
}

// 1. 三端共用的基线：两个策略下的结果必须一致。
function testSharedBaseline() {
    for (const [name, active, origin] of [
        ["public", PUBLIC_POLICY, "https://dav.jianguoyun.com"],
        ["loopback", LOOPBACK_POLICY, "https://dav.example.com"]
    ]) {
        const where = `${name} 策略`;

        // 方法白名单：只有备份流程真正用得到的四个。
        for (const method of ["GET", "PUT", "PROPFIND", "MKCOL"]) {
            assert.equal(normalizeRequest({method, url: `${origin}/dav/`}, active).method, method, where);
        }
        assert.equal(normalizeRequest({method: "propfind", url: `${origin}/dav/`}, active).method, "PROPFIND", where);
        assert.equal(normalizeRequest({url: `${origin}/dav/`}, active).method, "GET", `${where}：缺省为 GET`);
        for (const method of ["DELETE", "POST", "PROPPATCH", "MOVE", "COPY", "LOCK", "CONNECT"]) {
            rejects(
                () => normalizeRequest({method, url: `${origin}/dav/`}, active),
                `不支持 WebDAV 操作 ${method}`,
                `${where}：${method} 应该被拒绝`
            );
        }

        // 地址必须能解析。
        for (const url of ["", null, "/dav/", "dav.example.com/dav/", "http://"]) {
            rejects(() => normalizeRequest({url}, active), "WebDAV 地址无效", `${where}：${JSON.stringify(url)}`);
        }

        // 地址里不得内嵌凭据（会被原样发给上游，也容易被日志记下）。
        for (const url of [`https://user:pass@${new URL(origin).host}/dav/`, `https://user@${new URL(origin).host}/dav/`]) {
            rejects(
                () => normalizeRequest({url}, active),
                "请不要在 WebDAV 地址中包含用户名或密码",
                `${where}：${url}`
            );
        }

        // 非 http(s) 协议一律拒绝（两个策略的文案不同，但都不能放行）。
        for (const url of ["file:///etc/passwd", "ftp://dav.example.com/dav/", "gopher://dav.example.com/"]) {
            assert.throws(() => normalizeRequest({url}, active), Error, `${where}：${url} 应该被拒绝`);
        }

        // 请求头：只放行前端真正会发的那几个，其余静默丢弃。
        const normalized = normalizeRequest({
            method: "PROPFIND",
            url: `${origin}/dav/`,
            headers: {
                Authorization: "Basic dGVzdDp0ZXN0",
                Depth: 0,
                "Content-Type": "application/xml; charset=utf-8",
                "cache-control": "no-cache",
                "Content-Length": "123",
                Cookie: "session=secret",
                "X-Forwarded-For": "10.0.0.1",
                Host: "internal.example.com",
                Ignored: null
            },
            body: "<propfind/>"
        }, active);
        assert.deepEqual(normalized.headers, {
            Authorization: "Basic dGVzdDp0ZXN0",
            Depth: "0",
            "Content-Type": "application/xml; charset=utf-8",
            "cache-control": "no-cache"
        }, `${where}：请求头白名单`);
        assert.equal(normalized.body, "<propfind/>", where);

        // 请求头里的换行符会被上游读成另一个请求头。
        rejects(
            () => normalizeRequest({url: `${origin}/dav/`, headers: {Authorization: "Basic x\r\nX-Injected: 1"}}, active),
            "WebDAV 请求头 Authorization 包含非法字符",
            `${where}：请求头不得夹带换行`
        );

        assert.equal(normalizeRequest({url: `${origin}/dav/`}, active).body, undefined, `${where}：空报文体不转发`);
        assert.deepEqual(normalizeRequest({url: `${origin}/dav/`}, active).headers, {}, where);
    }

    // 策略必须显式传入，漏传不得悄悄退回宽松模式。
    assert.throws(() => normalizeRequest({url: "https://dav.jianguoyun.com/dav/"}), /代理策略/);
}

// 2. 公网入口（Netlify）：HTTPS + 主机白名单。
function testPublicPolicyIsStricter() {
    assert.equal(
        normalizeRequest({url: "https://dav.jianguoyun.com/dav/备份/"}, PUBLIC_POLICY).url,
        "https://dav.jianguoyun.com/dav/%E5%A4%87%E4%BB%BD/"
    );

    rejects(
        () => normalizeRequest({url: "https://dav.example.com/dav/"}, PUBLIC_POLICY),
        "服务器 dav.example.com 未加入允许列表，请在 Netlify 环境变量 WEBDAV_ALLOWED_HOSTS 中添加",
        "白名单外的主机应该被拒绝"
    );
    // SSRF 的典型目标：内网与云厂商元数据服务。
    for (const host of ["127.0.0.1", "localhost", "169.254.169.254", "10.0.0.5"]) {
        assert.throws(() => normalizeRequest({url: `https://${host}/dav/`}, PUBLIC_POLICY), /未加入允许列表/);
    }

    rejects(
        () => normalizeRequest({url: "http://dav.jianguoyun.com/dav/"}, PUBLIC_POLICY),
        "WebDAV 地址必须使用 HTTPS",
        "公网入口不接受明文 HTTP"
    );

    // WEBDAV_ALLOWED_HOSTS：逗号分隔、忽略空白与大小写，缺省回落坚果云。
    const configured = publicPolicy(" DAV.example.com , nextcloud.example.net ,, ");
    assert.equal(normalizeRequest({url: "https://dav.example.com/dav/"}, configured).url, "https://dav.example.com/dav/");
    assert.equal(normalizeRequest({url: "https://NextCloud.example.NET/dav/"}, configured).url, "https://nextcloud.example.net/dav/");
    assert.throws(() => normalizeRequest({url: "https://dav.jianguoyun.com/dav/"}, configured), /未加入允许列表/);
    for (const blank of ["", "   ", " , ", undefined, null]) {
        assert.deepEqual(
            [...publicPolicy(blank).allowedHosts],
            policy.DEFAULT_ALLOWED_HOSTS,
            `空配置 ${JSON.stringify(blank)} 应该回落默认白名单`
        );
    }
}

// 3. 回环入口（桌面版 IPC / server.js）：自建服务器必须继续能用。
function testLoopbackPolicyKeepsSelfHostedServers() {
    for (const url of [
        "http://127.0.0.1:8080/dav/",
        "http://192.168.1.10/remote.php/dav/files/me/",
        "http://nas.local:5006/dav/",
        "https://nextcloud.example.net/remote.php/dav/"
    ]) {
        assert.equal(normalizeRequest({url}, LOOPBACK_POLICY).url, url, `回环策略应该放行 ${url}`);
    }
    assert.equal(LOOPBACK_POLICY.requireHttps, false);
    assert.equal(LOOPBACK_POLICY.allowedHosts, null);
}

// 4. Netlify Function 本体：顺便验证 ESM 能 import 这个 CJS 共享模块。
//    这些用例全部在发出 fetch 之前就被拦下，所以不会访问外网。
async function testNetlifyFunctionUsesPublicPolicy() {
    globalThis.Netlify = {env: {get: name => (name === "WEBDAV_ALLOWED_HOSTS" ? "" : undefined)}};
    const module = await import("../netlify/functions/webdav.mjs");
    const handler = module.default;
    assert.equal(module.config.path, "/__webdav", "路由路径不得变");

    const post = body => new Request("https://restcal.example/__webdav", {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-Xiuli-Proxy": "1"},
        body: typeof body === "string" ? body : JSON.stringify(body)
    });

    const wrongMethod = await handler(new Request("https://restcal.example/__webdav"));
    assert.equal(wrongMethod.status, 405);

    const noProxyHeader = await handler(new Request("https://restcal.example/__webdav", {method: "POST", body: "{}"}));
    assert.equal(noProxyHeader.status, 403, "缺少 X-Xiuli-Proxy 应该 403");

    const badJson = await handler(post("not json"));
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).error, "请求格式错误");

    for (const [payload, expected] of [
        [{method: "DELETE", url: "https://dav.jianguoyun.com/dav/"}, "不支持 WebDAV 操作 DELETE"],
        [{method: "GET", url: "http://dav.jianguoyun.com/dav/"}, "WebDAV 地址必须使用 HTTPS"],
        [{method: "GET", url: "https://169.254.169.254/latest/meta-data/"},
            "服务器 169.254.169.254 未加入允许列表，请在 Netlify 环境变量 WEBDAV_ALLOWED_HOSTS 中添加"],
        [{method: "GET", url: "https://user:pass@dav.jianguoyun.com/dav/"}, "请不要在 WebDAV 地址中包含用户名或密码"],
        [{method: "GET", url: "nope"}, "WebDAV 地址无效"]
    ]) {
        const response = await handler(post(payload));
        assert.equal(response.status, 400, `${payload.url} 应该 400`);
        assert.equal((await response.json()).error, expected);
    }

    delete globalThis.Netlify;
}

// 5. server.js 的 /__webdav：端到端跱一遍，确认线上契约与策略都真的生效了。
async function testLocalServerProxy() {
    const seen = [];
    const upstream = http.createServer((request, response) => {
        const chunks = [];
        request.on("data", chunk => chunks.push(chunk));
        request.on("end", () => {
            seen.push({
                method: request.method,
                url: request.url,
                headers: request.headers,
                body: Buffer.concat(chunks).toString("utf-8")
            });
            response.writeHead(207, {"Content-Type": "application/xml; charset=utf-8"});
            response.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"/>');
        });
    });
    await new Promise((resolve, reject) => {
        upstream.once("error", reject);
        upstream.listen(0, "127.0.0.1", resolve);
    });
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/dav/`;

    const port = 18766;
    const server = spawn(process.execPath, [path.join(repo, "server.js")], {
        cwd: repo,
        env: {...process.env, PORT: String(port)},
        stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    server.stderr.on("data", chunk => {
        stderr += chunk;
    });

    const call = (payload, headers = {"X-Xiuli-Proxy": "1"}) => fetch(`http://127.0.0.1:${port}/__webdav`, {
        method: "POST",
        headers: {"Content-Type": "application/json", ...headers},
        body: typeof payload === "string" ? payload : JSON.stringify(payload)
    });

    try {
        // 等服务启动。
        for (let attempt = 0; attempt < 30; attempt += 1) {
            try {
                await fetch(`http://127.0.0.1:${port}/robots.txt`);
                break;
            } catch {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        assert.equal((await call({}, {})).status, 403, "缺少 X-Xiuli-Proxy 应该 403");
        const badJson = await call("not json");
        assert.equal(badJson.status, 400);
        assert.equal((await badJson.json()).error, "请求格式错误");

        // 旧实现是个无限制转发器：任意方法、任意请求头、任意 http(s) 地址。
        const deleted = await call({method: "DELETE", url: upstreamUrl});
        assert.equal(deleted.status, 400);
        assert.equal((await deleted.json()).error, "不支持 WebDAV 操作 DELETE");
        assert.equal(seen.length, 0, "被拒绝的请求不得触及上游");

        const credentials = await call({method: "GET", url: upstreamUrl.replace("http://", "http://user:pass@")});
        assert.equal(credentials.status, 400);
        assert.equal((await credentials.json()).error, "请不要在 WebDAV 地址中包含用户名或密码");

        const badProtocol = await call({method: "GET", url: "file:///etc/passwd"});
        assert.equal(badProtocol.status, 400);
        assert.equal((await badProtocol.json()).error, "WebDAV 地址必须以 http:// 或 https:// 开头");
        assert.equal(seen.length, 0);

        // 旧实现把请求头直接交给 http.request，夹带换行会抛错把本地服务器整个带崩。
        const injected = await call({
            method: "GET",
            url: upstreamUrl,
            headers: {Authorization: "Basic x\r\nX-Injected: 1"}
        });
        assert.equal(injected.status, 400);
        assert.equal((await injected.json()).error, "WebDAV 请求头 Authorization 包含非法字符");
        assert.equal(seen.length, 0);

        // 正常请求：本地明文 HTTP + 任意主机仍然可用，回包契约不变。
        const ok = await call({
            method: "PROPFIND",
            url: upstreamUrl,
            headers: {
                Authorization: "Basic dGVzdDp0ZXN0",
                Depth: "0",
                "Content-Type": "application/xml; charset=utf-8",
                Cookie: "session=secret",
                "X-Forwarded-For": "10.0.0.1"
            },
            body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"/>'
        });
        assert.equal(ok.status, 200);
        const result = await ok.json();
        assert.deepEqual(Object.keys(result).sort(), ["body", "ok", "status", "statusText"]);
        assert.equal(result.ok, true, "207 Multi-Status 算 2xx，与桌面版 IPC 的判断一致");
        assert.equal(result.status, 207);
        assert.match(result.body, /multistatus/);

        assert.equal(seen.length, 1);
        const forwarded = seen[0];
        assert.equal(forwarded.method, "PROPFIND");
        assert.equal(forwarded.headers.authorization, "Basic dGVzdDp0ZXN0");
        assert.equal(forwarded.headers.depth, "0");
        assert.equal(forwarded.headers["content-length"], String(Buffer.byteLength(forwarded.body, "utf-8")));
        assert.equal(forwarded.headers.cookie, undefined, "非白名单请求头不得转给上游");
        assert.equal(forwarded.headers["x-forwarded-for"], undefined, "非白名单请求头不得转给上游");
        assert.match(forwarded.body, /propfind/);
    } finally {
        server.kill();
        upstream.close();
        if (stderr.trim()) console.error(stderr.trim());
    }
}

// 6. 防止重新分岁：三个入口都只能从共享模块拿规则，不得自带一份白名单。
function testNoProxyKeepsItsOwnRules() {
    for (const file of ["server.js", "desktop/webdav.js", "netlify/functions/webdav.mjs"]) {
        const source = fs.readFileSync(path.join(repo, file), "utf8");
        assert.match(source, /shared\/webdav-policy\.js/, `${file} 应该引用共享策略模块`);
        assert.match(source, /normalizeRequest/, `${file} 应该走 normalizeRequest`);
        assert.doesNotMatch(source, /"MKCOL"/, `${file} 不得再自带一份方法白名单`);
        assert.doesNotMatch(source, /"authorization"/, `${file} 不得再自带一份请求头白名单`);
    }
}

const tests = [
    testSharedBaseline,
    testPublicPolicyIsStricter,
    testLoopbackPolicyKeepsSelfHostedServers,
    testNetlifyFunctionUsesPublicPolicy,
    testLocalServerProxy,
    testNoProxyKeepsItsOwnRules
];

(async () => {
    for (const test of tests) {
        try {
            await test();
        } catch (error) {
            console.error(`${test.name} 失败`);
            throw error;
        }
    }
    console.log(`WebDAV proxy policy tests passed (${tests.length} cases)`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
