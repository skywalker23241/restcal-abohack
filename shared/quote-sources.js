/* 每日一言的上游配置，Netlify Function 与本地 server.js 的 /__quote 共用。
 *
 * 英文源 api.quotable.io 的 HTTPS 证书长期处于过期状态，浏览器无法直连，由服务端改走
 * 明文 HTTP 转发；中文源一言（hitokoto.cn）证书正常，代理只为让前端两种语言共用同一
 * 入口（内容为公开格言，不含敏感信息）。
 *
 * 与 webdav-policy.js 一样保持 CommonJS，Netlify Functions（ESM）直接 import 即可。
 */

const QUOTE_SOURCES = {
    zh: {url: "https://v1.hitokoto.cn/?c=d&c=i&c=k&max_length=60", textField: "hitokoto"},
    en: {url: "http://api.quotable.io/quotes/random?maxLength=120", textField: "content"}
};

// 语言参数缺失或不认识时回落英文源。
function quoteSource(lang) {
    return QUOTE_SOURCES[lang] || QUOTE_SOURCES.en;
}

// 追加时间戳参数：一言经 Cloudflare，相同 URL 短时间内会命中边缘缓存返回同一条。
// 两个源的 URL 都已经带查询串，所以用 & 拼接。
function quoteRequestUrl(source, now = Date.now()) {
    return `${source.url}&_=${now}`;
}

module.exports = {QUOTE_SOURCES, quoteSource, quoteRequestUrl};
