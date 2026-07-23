/* 每日一言同源转发函数。
 * api.quotable.io 的 HTTPS 证书长期处于过期状态，浏览器无法直连；
 * 由服务端改走明文 HTTP 转发（内容为公开格言，不含敏感信息）。
 */

export default async function handler() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
        const upstream = await fetch("http://api.quotable.io/quotes/random?maxLength=120", {
            signal: controller.signal
        });
        if (!upstream.ok) {
            return Response.json({error: `格言服务返回 ${upstream.status}`}, {status: 502});
        }
        const data = await upstream.json();
        // 确保返回的是正确格式（API 既可能返回对象也可能返回数组）
        const quote = Array.isArray(data) ? data[0] : data;
        if (quote?.content) {
            return Response.json(quote, {
                headers: {"Cache-Control": "no-store"}
            });
        } else {
            return Response.json({error: "格言服务响应异常"}, {status: 502});
        }
    } catch (error) {
        const message = error && error.name === "AbortError" ? "连接格言服务超时" : "无法连接格言服务";
        return Response.json({error: message}, {status: 502});
    } finally {
        clearTimeout(timer);
    }
}

export const config = {
    path: "/__quote"
};
