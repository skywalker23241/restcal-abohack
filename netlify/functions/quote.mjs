/* 每日一言同源转发函数。
 * 上游源与「为什么要代理」的说明集中在 shared/quote-sources.js，
 * 本地开发用的 server.js 的 /__quote 用的是同一份配置。
 */

import {quoteRequestUrl, quoteSource} from "../../shared/quote-sources.js";

export default async function handler(request) {
    let lang = "en";
    try {
        lang = new URL(request.url).searchParams.get("lang") || "en";
    } catch {
        // 解析失败时保持默认英文源
    }
    const source = quoteSource(lang);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
        const upstream = await fetch(quoteRequestUrl(source), {
            signal: controller.signal
        });
        if (!upstream.ok) {
            return Response.json({error: `格言服务返回 ${upstream.status}`}, {status: 502});
        }
        const data = await upstream.json();
        // 确保返回的是正确格式（API 既可能返回对象也可能返回数组）
        const quote = Array.isArray(data) ? data[0] : data;
        if (quote && quote[source.textField]) {
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
