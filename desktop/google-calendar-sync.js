/* 休历 → Google 日历的单向同步协议。
 *
 * 这里刻意不引用 Electron：整套流程可以用 `node scripts/test-google-sync.js`
 * 对着内存版 Google API 跑完，不需要真实账号。Electron 那一侧只负责提供
 * 已鉴权的 request 和加密落盘的 save，见 desktop/google-calendar.js。
 *
 * session 约定：
 *   bundle   当前 token bundle；同步过程中会被 request/save 替换
 *   request  (url, options) => 解析好的 JSON；失败时抛出带 status 的 Error
 *   save     (bundle) => Promise，持久化并更新 session.bundle
 */

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// 同步目标是一个专属的次级日历，而不是 calendars/primary。
// 授权用的 calendar.app.created 只覆盖「本应用创建的次级日历」，主日历不在
// 范围内，写 primary 会被 Google 拒绝（403 insufficientPermissions）。专属日历
// 同时也是更好的产品行为：用户可以在 Google 日历里单独隐藏、配色或分享它，
// 休历的写入永远碰不到其他日程。
const CALENDAR_SUMMARY = "休历 RestCal";
const CALENDAR_DESCRIPTION = "由休历创建并维护的请假、加班与出勤安排。单向同步：在 Google 日历里的改动不会回写休历。";

// 单次同步的事件上限，避免记录异常膨胀时打满 Google 配额。
const MAX_EVENTS = 1000;

function isSyncableEvent(event) {
    return Boolean(event?.id && event?.summary && event?.start?.date && event?.end?.date);
}

function calendarUrl(calendarId, suffix = "") {
    return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}${suffix}`;
}

function eventUrl(calendarId, eventId) {
    return calendarUrl(calendarId, `/events/${encodeURIComponent(eventId)}`);
}

async function patchBundle(session, patch) {
    await session.save({...session.bundle, ...patch});
}

// 返回可写入的专属日历 ID：首次同步时创建，用户在 Google 日历里删掉后重建。
async function ensureCalendar(session) {
    const known = session.bundle.calendarId;
    if (known) {
        try {
            await session.request(calendarUrl(known));
            return known;
        } catch (error) {
            // 只有「确实不存在」才重建。403 等权限问题要原样抛出，
            // 否则会在用户账号里反复堆出同名日历。
            if (error.status !== 404 && error.status !== 410) throw error;
        }
    }
    const created = await session.request(`${CALENDAR_API}/calendars`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({summary: CALENDAR_SUMMARY, description: CALENDAR_DESCRIPTION})
    });
    if (!created?.id) throw new Error("创建休历专属 Google 日历失败");
    // 旧的事件 ID 随被删掉的日历一起没了，连同 calendarId 一起重置。
    await patchBundle(session, {calendarId: created.id, syncedEventIds: []});
    return created.id;
}

async function writeEvent(session, calendarId, event) {
    try {
        await session.request(eventUrl(calendarId, event.id), {
            method: "PUT",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(event)
        });
    } catch (error) {
        // 事件尚不存在时 PUT 会 404，改为新建。
        if (error.status !== 404) throw error;
        await session.request(calendarUrl(calendarId, "/events"), {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(event)
        });
    }
}

async function removeEvent(session, calendarId, eventId) {
    try {
        await session.request(eventUrl(calendarId, eventId), {method: "DELETE"});
    } catch (error) {
        // 用户已经自己删掉了，目标状态一致，不算失败。
        if (error.status !== 404 && error.status !== 410) throw error;
    }
}

async function syncEvents(session, events = []) {
    const calendarId = await ensureCalendar(session);
    const previous = new Set(session.bundle.syncedEventIds || []);

    const syncable = [];
    const desired = new Set();
    for (const event of events.slice(0, MAX_EVENTS)) {
        if (!isSyncableEvent(event) || desired.has(event.id)) continue;
        desired.add(event.id);
        syncable.push(event);
    }

    // 写入前先把新旧 ID 的并集落盘。同步中途失败时，已经写进 Google 的事项
    // 仍然记录在案，下一次同步才找得到并清理；否则会留下永远删不掉的孤儿事件。
    await patchBundle(session, {syncedEventIds: [...new Set([...previous, ...desired])]});

    for (const event of syncable) {
        await writeEvent(session, calendarId, event);
    }

    for (const staleId of previous) {
        if (desired.has(staleId)) continue;
        await removeEvent(session, calendarId, staleId);
    }

    const lastSyncedAt = new Date().toISOString();
    await patchBundle(session, {syncedEventIds: [...desired], lastSyncedAt});
    return {ok: true, synced: syncable.length, calendarId, lastSyncedAt};
}

// ---- 授权状态的变迁规则 ----
// 这三条是纯函数，与 Electron 的加密存储无关，放在这里才能进 CI 测。

// 是否算“已连接”：看有没有刷新令牌。断开后文件仍然存在（里面只剩 calendarId），
// 所以不能拿“文件存不存在”当判据。
function isConnected(bundle) {
    return Boolean(bundle && bundle.refreshToken);
}

// 断开连接后应该落盘的内容；返回 null 表示可以直接删文件。
// 丢掉的是用户的授权（刷新令牌、访问令牌、邮箱），保留的是应用自身的注册信息：
// - calendarId：calendar.app.created 不授权 calendarList.list，丢了就再也找不回已建的
//   日历，每次重连都会多堆出一个同名日历；
// - clientId / clientSecret：OAuth 客户端注册信息，与“哪个用户授权了”无关，留着
//   重连时不用重填。它们仍然在 safeStorage 加密的文件里。
function bundleAfterDisconnect(bundle) {
    if (!bundle) return null;
    const kept = {};
    if (bundle.calendarId) kept.calendarId = bundle.calendarId;
    if (bundle.clientId) kept.clientId = bundle.clientId;
    if (bundle.clientSecret) kept.clientSecret = bundle.clientSecret;
    return Object.keys(kept).length ? kept : null;
}

// 重新授权后的 bundle：新令牌 + 沿用旧的日历与已同步清单。
// 换账号时旧 calendarId 在新账号下会 404，ensureCalendar 会重建并重置清单。
function bundleForReconnect(previous, fresh) {
    return {
        ...fresh,
        calendarId: previous?.calendarId || "",
        syncedEventIds: Array.isArray(previous?.syncedEventIds) ? [...previous.syncedEventIds] : []
    };
}

module.exports = {
    CALENDAR_API,
    MAX_EVENTS,
    syncEvents,
    isConnected,
    bundleAfterDisconnect,
    bundleForReconnect
};
