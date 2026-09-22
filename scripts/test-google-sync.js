/* Google 日历单向同步协议的回归测试。
 *
 * 对着内存版 Google Calendar API 跑，不需要 Electron、网络或真实账号，
 * 所以可以进 CI。最关键的一条断言是「永远不访问 calendars/primary」：
 * 授权用的 calendar.app.created scope 不覆盖主日历，写 primary 会被 Google 拒绝。
 */

const assert = require("node:assert/strict");
const sync = require("../desktop/google-calendar-sync.js");

const API = sync.CALENDAR_API;

// 最小可用的 Google Calendar 替身：记录每一次调用，并按真实 API 的错误语义
// 报 404（日历/事件不存在），以便驱动 PUT → POST 回退和重建日历分支。
function createFakeGoogle() {
    const calendars = new Map();
    const calls = [];
    let created = 0;
    // 测试可以挂一个钩子来注入故障；返回的状态码会被抛成带 status 的 Error。
    let interceptor = null;

    function fail(status, message) {
        const error = new Error(message);
        error.status = status;
        throw error;
    }

    async function request(url, options = {}) {
        const method = (options.method || "GET").toUpperCase();
        calls.push(`${method} ${url}`);

        const injected = interceptor?.({method, url, index: calls.length - 1});
        if (injected) fail(injected, `injected ${injected}`);

        if (method === "POST" && url === `${API}/calendars`) {
            const id = `restcal-calendar-${++created}@group.calendar.google.com`;
            calendars.set(id, new Map());
            return {id, summary: JSON.parse(options.body).summary};
        }

        const match = url.match(new RegExp(`^${API}/calendars/([^/]+)(?:/events(?:/(.+))?)?$`));
        if (!match) fail(404, `unexpected url ${url}`);
        const calendarId = decodeURIComponent(match[1]);
        const eventId = match[2] ? decodeURIComponent(match[2]) : null;
        const events = calendars.get(calendarId);
        if (!events) fail(404, `no calendar ${calendarId}`);

        if (!match[0].includes("/events")) return {id: calendarId};
        if (method === "POST") {
            const event = JSON.parse(options.body);
            events.set(event.id, event);
            return event;
        }
        if (method === "PUT") {
            if (!events.has(eventId)) fail(404, `no event ${eventId}`);
            events.set(eventId, JSON.parse(options.body));
            return events.get(eventId);
        }
        if (method === "DELETE") {
            if (!events.has(eventId)) fail(404, `no event ${eventId}`);
            events.delete(eventId);
            return {};
        }
        return fail(405, `unsupported ${method}`);
    }

    return {
        request,
        calls,
        calendars,
        intercept: hook => { interceptor = hook; },
        eventIds: calendarId => [...(calendars.get(calendarId)?.keys() || [])].sort()
    };
}

function createSession(google, bundle = {}) {
    const session = {
        bundle: {accessToken: "token", ...bundle},
        request: google.request,
        async save(next) {
            // 模拟落盘：深拷一份，避免测试里意外共享引用而掩盖问题。
            session.bundle = JSON.parse(JSON.stringify(next));
            session.saves += 1;
        },
        saves: 0
    };
    return session;
}

function calendarEvent(id, summary = `事项 ${id}`) {
    return {id, summary, start: {date: "2026-09-16"}, end: {date: "2026-09-17"}};
}

function assertNeverPrimary(calls) {
    const offender = calls.find(call => call.includes("/calendars/primary"));
    assert.equal(
        offender,
        undefined,
        `calendar.app.created 不授权主日历，不得访问 calendars/primary：${offender}`
    );
}

async function rejects(run) {
    try {
        await run();
    } catch (error) {
        return error;
    }
    return assert.fail("预期抛出异常，实际成功返回");
}

// 1. 首次同步：创建专属日历，事件写进它，全程不碰 primary。
async function testFirstSyncCreatesDedicatedCalendar() {
    const google = createFakeGoogle();
    const session = createSession(google);
    const result = await sync.syncEvents(session, [calendarEvent("restcal20260916"), calendarEvent("restcal20260917")]);

    assert.equal(result.ok, true);
    assert.equal(result.synced, 2);
    assert.ok(result.calendarId, "应该返回专属日历 ID");
    assert.equal(session.bundle.calendarId, result.calendarId, "calendarId 必须落盘");
    assert.deepEqual(google.eventIds(result.calendarId), ["restcal20260916", "restcal20260917"]);
    assert.deepEqual([...session.bundle.syncedEventIds].sort(), ["restcal20260916", "restcal20260917"]);
    assert.ok(google.calls.includes(`POST ${API}/calendars`), "首次同步应该创建日历");
    assertNeverPrimary(google.calls);
}

// 2. 再次同步：复用同一个日历，已存在的事件走 PUT 更新，移除的记录被删除。
async function testSecondSyncReusesCalendarAndPrunes() {
    const google = createFakeGoogle();
    const session = createSession(google);
    const first = await sync.syncEvents(session, [calendarEvent("restcal20260916"), calendarEvent("restcal20260917")]);
    google.calls.length = 0;

    const second = await sync.syncEvents(session, [calendarEvent("restcal20260916", "改了标题")]);

    assert.equal(second.calendarId, first.calendarId, "不应该重复创建日历");
    assert.equal(google.calls.filter(call => call === `POST ${API}/calendars`).length, 0);
    assert.deepEqual(google.eventIds(first.calendarId), ["restcal20260916"]);
    assert.equal(google.calendars.get(first.calendarId).get("restcal20260916").summary, "改了标题");
    assert.ok(
        google.calls.some(call => call.startsWith("DELETE ") && call.includes("restcal20260917")),
        "移除的记录应该从日历删除"
    );
    assert.deepEqual(session.bundle.syncedEventIds, ["restcal20260916"]);
    assertNeverPrimary(google.calls);
}

// 3. 用户在 Google 日历里删掉了专属日历：下次同步重建，而不是报错卡住。
async function testRecreatesCalendarDeletedByUser() {
    const google = createFakeGoogle();
    const session = createSession(google);
    const first = await sync.syncEvents(session, [calendarEvent("restcal20260916")]);
    google.calendars.delete(first.calendarId);

    const second = await sync.syncEvents(session, [calendarEvent("restcal20260916")]);

    assert.notEqual(second.calendarId, first.calendarId, "日历被删后应该重建");
    assert.equal(session.bundle.calendarId, second.calendarId);
    assert.deepEqual(google.eventIds(second.calendarId), ["restcal20260916"]);
    assertNeverPrimary(google.calls);
}

// 4. 权限类错误（403）不得被当成「日历不存在」，否则会在用户账号里堆出同名日历。
async function testPermissionErrorDoesNotRecreateCalendar() {
    const google = createFakeGoogle();
    const session = createSession(google);
    await sync.syncEvents(session, [calendarEvent("restcal20260916")]);

    google.intercept(({method}) => (method === "GET" ? 403 : null));
    const error = await rejects(() => sync.syncEvents(session, [calendarEvent("restcal20260916")]));

    assert.equal(error.status, 403, "403 应该原样抛出");
    assert.equal(google.calls.filter(call => call === `POST ${API}/calendars`).length, 1, "不得重复建日历");
}

// 5. 同步中途失败：已打算写入的事件 ID 必须先落盘，否则残留事件永远清理不掉。
async function testInterruptedSyncKeepsCleanupTrail() {
    const google = createFakeGoogle();
    const session = createSession(google);

    // 放行第一个事件的写入，在第二个事件的新建上断掉。
    let eventInserts = 0;
    google.intercept(({method, url}) => {
        if (method !== "POST" || !url.endsWith("/events")) return null;
        eventInserts += 1;
        return eventInserts === 2 ? 500 : null;
    });

    const error = await rejects(() =>
        sync.syncEvents(session, [calendarEvent("restcal20260916"), calendarEvent("restcal20260917")])
    );
    assert.equal(error.status, 500, "非 404 的写入错误应该冒泡给调用方");
    assert.deepEqual(
        [...session.bundle.syncedEventIds].sort(),
        ["restcal20260916", "restcal20260917"],
        "失败前应该已经记下本次打算写入的全部 ID"
    );

    // 下一次同步（记录清空）把残留事件清干净，并忽略未曾写入成功的 404。
    google.intercept(null);
    const calendarId = session.bundle.calendarId;
    await sync.syncEvents(session, []);
    assert.deepEqual(google.eventIds(calendarId), [], "残留事件应该被下一次同步清理");
    assert.deepEqual(session.bundle.syncedEventIds, []);
}

// 5b. 累积清单必须是「旧 ∪ 新」而不是「新」。上一条用例是首次同步，previous 为空，
//     两者恰好相等，分辨不出区别。这里让失败发生在清理阶段，已存在的旧事件必须
//     仍然留在清单里，否则它会永远留在用户日历里删不掉。
async function testCleanupTrailKeepsPreviousIds() {
    const google = createFakeGoogle();
    const session = createSession(google);
    const first = await sync.syncEvents(session, [calendarEvent("restcalaaaaa"), calendarEvent("restcalbbbbb")]);
    assert.deepEqual(google.eventIds(first.calendarId), ["restcalaaaaa", "restcalbbbbb"]);

    // 只保留 aaaaa：bbbbb 应该被删，但删除请求失败了。
    google.intercept(({method}) => (method === "DELETE" ? 500 : null));
    const error = await rejects(() => sync.syncEvents(session, [calendarEvent("restcalaaaaa")]));
    assert.equal(error.status, 500);
    assert.ok(
        session.bundle.syncedEventIds.includes("restcalbbbbb"),
        "删除失败后，bbbbb 必须还在清单里，下次才能再试——这正是并集存在的理由"
    );

    google.intercept(null);
    await sync.syncEvents(session, [calendarEvent("restcalaaaaa")]);
    assert.deepEqual(google.eventIds(first.calendarId), ["restcalaaaaa"], "下一次同步应该成功清掉 bbbbb");
}

// 6. 不完整的事件跳过，重复 ID 只写一次。
async function testSkipsIncompleteAndDuplicateEvents() {
    const google = createFakeGoogle();
    const session = createSession(google);
    const result = await sync.syncEvents(session, [
        {id: "restcalnosummary", start: {date: "2026-09-16"}, end: {date: "2026-09-17"}},
        {summary: "缺 id", start: {date: "2026-09-16"}, end: {date: "2026-09-17"}},
        {id: "restcalnodate", summary: "缺日期"},
        calendarEvent("restcal20260916"),
        calendarEvent("restcal20260916")
    ]);

    assert.equal(result.synced, 1);
    assert.deepEqual(google.eventIds(result.calendarId), ["restcal20260916"]);
}

// 7. 超过上限的部分截断，不把 Google 配额打满。
async function testCapsEventCount() {
    const google = createFakeGoogle();
    const session = createSession(google);
    const events = Array.from({length: sync.MAX_EVENTS + 5}, (_, index) => calendarEvent(`restcalbulk${index}`));

    const result = await sync.syncEvents(session, events);

    assert.equal(result.synced, sync.MAX_EVENTS);
    assert.equal(google.eventIds(result.calendarId).length, sync.MAX_EVENTS);
}

// 8. session 约定：刷新令牌后替换的 session.bundle 不得被同步过程回写覆盖。
//    旧实现逐事件从磁盘回读 bundle，就是在这里会丢掉刚刷新的 accessToken。
async function testKeepsRefreshedToken() {
    const google = createFakeGoogle();
    const session = createSession(google, {accessToken: "old"});
    const inner = session.request;
    let refreshed = false;
    session.request = async (url, options = {}) => {
        if (!refreshed && (options.method || "GET") === "POST") {
            refreshed = true;
            session.bundle = {...session.bundle, accessToken: "fresh"};
        }
        return inner(url, options);
    };

    await sync.syncEvents(session, [calendarEvent("restcal20260916")]);

    assert.equal(refreshed, true, "测试本身应该触发过一次刷新");
    assert.equal(session.bundle.accessToken, "fresh", "刷新后的 accessToken 不得丢失");
    assert.ok(session.bundle.calendarId);
}

// 9. 断开→重连不得重复创建日历。calendar.app.created 不授权列出已有日历，
//    calendarId 一旦丢失就再也找不回来，每次重连都会在用户账号里多一个同名日历。
async function testDisconnectKeepsCalendarId() {
    const google = createFakeGoogle();
    const session = createSession(google);
    const first = await sync.syncEvents(session, [calendarEvent("restcalaaaaa")]);

    const connected = {...session.bundle, refreshToken: "r1", email: "a@example.com"};
    assert.equal(sync.isConnected(connected), true);

    const afterDisconnect = sync.bundleAfterDisconnect(connected);
    assert.deepEqual(afterDisconnect, {calendarId: first.calendarId}, "断开后只应该剩下 calendarId");
    assert.equal(sync.isConnected(afterDisconnect), false, "没有刷新令牌就是未连接");

    const reconnected = sync.bundleForReconnect(afterDisconnect, {refreshToken: "r2", accessToken: "a2"});
    assert.equal(reconnected.calendarId, first.calendarId, "重连必须沿用原来的日历");
    assert.equal(sync.isConnected(reconnected), true);

    // 重连后再同步：只能去 GET 验证旧日历，不能再 POST /calendars。
    const resumed = createSession(google, reconnected);
    google.calls.length = 0;
    const second = await sync.syncEvents(resumed, [calendarEvent("restcalaaaaa")]);
    assert.equal(second.calendarId, first.calendarId);
    assert.equal(google.calls.filter(c => c === `POST ${API}/calendars`).length, 0, "重连不得新建日历");
    assert.equal(google.calendars.size, 1, "用户账号里只应该有一个休历日历");

    // 从未连接过（没有 calendarId）时，断开应该允许直接删文件。
    assert.equal(sync.bundleAfterDisconnect({refreshToken: "r"}), null);
    assert.equal(sync.bundleAfterDisconnect(null), null);
}

const tests = [
    testFirstSyncCreatesDedicatedCalendar,
    testSecondSyncReusesCalendarAndPrunes,
    testRecreatesCalendarDeletedByUser,
    testPermissionErrorDoesNotRecreateCalendar,
    testInterruptedSyncKeepsCleanupTrail,
    testCleanupTrailKeepsPreviousIds,
    testSkipsIncompleteAndDuplicateEvents,
    testCapsEventCount,
    testKeepsRefreshedToken,
    testDisconnectKeepsCalendarId
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
    console.log(`Google calendar sync tests passed (${tests.length} cases)`);
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
