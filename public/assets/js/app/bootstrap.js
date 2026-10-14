/* 休历 · RestCal —— 常量、模块级状态与启动
 *
 * 主脚本里所有「立即执行」的顶层语句都集中在这里，并保持原有先后顺序；
 * 其余文件只包含函数声明。这样做有两个好处：
 *   1. 不必再推敲「这个 const 在那个函数跑之前初始化了吗」——声明全在函数之后、
 *      启动之前执行；
 *   2. 拆分文件时不会踩到暂时性死区。原先 init() 写在一半声明的前面，只是恰好
 *      赶在碰到它们之前遇到 await 才没出事。
 * 本文件必须最后加载。
 */

const STORAGE_KEY = "xiuli-state-v1";
const WEBDAV_KEY = "xiuli-webdav-v1";
const WEBDAV_FILENAME = "xiuli-backup.json";
// 本地由 server.js 处理；在线版由同源 Netlify Function 处理。
const WEBDAV_PROXY_URL = "/__webdav";
const THEME_KEY = "xiuli-theme";
const PALETTE_KEY = "xiuli-palette";
const PALETTES = ["paper", "forest", "ocean", "plum"];
const THEME_SEQUENCE = ["auto", "light", "dark"];
const PRODUCT_TOUR_VERSION = 2;
const THEME_META = {
    auto: {icon: "circle-half", label: "主题：跟随系统"},
    light: {icon: "sun", label: "主题：浅色"},
    dark: {icon: "moon", label: "主题：深色"}
};
const NAV_ICONS = {calendar: "calendar-blank", stats: "chart-bar", tools: "toolbox"};
const darkSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const CALENDAR_API = {
    sourceName: "Chinese Days",
    localYearJson: year => `assets/vendor/chinese-days/years/${year}.json`,
    remoteYearJson: year => `https://cdn.jsdelivr.net/npm/chinese-days/dist/years/${year}.json`
};
const CSV_REQUIRED_HEADERS = ["日期", "状态", "请假类型", "请假理由", "是否节假日", "是否周末", "备注"];
const CSV_HEADERS = ["日期", "状态", "请假类型", "请假理由", "加班工时", "调休倍率", "加班事由", "是否节假日", "是否周末", "备注", "更新时间"];
const CSV_USER_DATA_HEADER = "用户设置(JSON)";
const STATUS_LABELS = {
    work: "出勤",
    personal: "事假",
    sick: "病假",
    annual: "年假",
    comp: "调休",
    overtime: "加班"
};
const LEAVE_STATUSES = ["personal", "sick", "annual", "comp"];
const DEFAULT_OVERVIEW_MODULES = ["attendance", "leaveDeduction", "nextHoliday"];
const OVERVIEW_MODULE_IDS = [
    "attendance",
    "annualQuota",
    "leaveDeduction",
    "estimatedSalary",
    "nextHoliday",
    "ticketSale",
    "payday",
    "overtime",
    "habit"
];
const HABIT_ICONS = [
    {id: "flag", icon: "flag", label: "旗子"},
    {id: "book", icon: "book-open", label: "阅读"},
    {id: "leaf", icon: "plant", label: "自然"},
    {id: "flame", icon: "fire", label: "坚持"},
    {id: "heart", icon: "heart", label: "健康"},
    {id: "dumbbell", icon: "barbell", label: "运动"},
    {id: "cup", icon: "coffee", label: "饮水"},
    {id: "moon", icon: "moon", label: "睡眠"},
    {id: "sun", icon: "sun", label: "早起"},
    {id: "music", icon: "music-notes", label: "音乐"},
    {id: "star", icon: "star", label: "目标"},
    {id: "pencil", icon: "pencil-simple", label: "学习"}
];
// 税率表、起征点和默认扣薪比例都由 assets/js/payroll.js 定义，这里不再出现第二份。
const DEFAULT_RATES = XiuliPayroll.DEFAULT_LEAVE_RATES;
const DEFAULT_USER_DATA = {
    profile: {name: "", company: "", hireDate: ""},
    workSchedule: {workdaysPerWeek: 5, restDays: [0, 6], dailyWorkHours: 8, scheduleType: "standard"},
    salary: {monthlySalary: 0, fixedDeductions: 0, estimatedTax: 0, specialDeductions: 0, taxMode: "simple", payday: null},
    quotaRules: {annualExpireRule: "next-03-31", compExpireRule: "none"},
    ticketPreferences: {departureRule: "holiday-start", returnRule: "holiday-end", reminderTime: "09:00", advanceDays: 14, origin: "", destination: "", transfers: [], flightOrigin: "", flightDestination: ""},
    integrations: {
        googleCalendar: {autoSync: true, include: {leave: true, overtime: true, work: false, notes: true}},
        email: {defaultRecipient: ""}
    },
    dashboard: {version: 1, overviewModules: [...DEFAULT_OVERVIEW_MODULES]},
    habits: [],
    onboardingCompleted: false,
    onboardingSkipped: false
};

const HOLIDAY_DATA = {
    2026: {
        holidays: [
            ...rangeDates("2026-01-01", "2026-01-03").map(date => ({date, name: "元旦"})),
            ...rangeDates("2026-02-15", "2026-02-23").map(date => ({date, name: "春节"})),
            ...rangeDates("2026-04-04", "2026-04-06").map(date => ({date, name: "清明节"})),
            ...rangeDates("2026-05-01", "2026-05-05").map(date => ({date, name: "劳动节"})),
            ...rangeDates("2026-06-19", "2026-06-21").map(date => ({date, name: "端午节"})),
            ...rangeDates("2026-09-25", "2026-09-27").map(date => ({date, name: "中秋节"})),
            ...rangeDates("2026-10-01", "2026-10-07").map(date => ({date, name: "国庆节"}))
        ],
        makeupWorkdays: [
            {date: "2026-01-04", name: "元旦调休上班"},
            {date: "2026-02-14", name: "春节调休上班"},
            {date: "2026-02-28", name: "春节调休上班"},
            {date: "2026-05-09", name: "劳动节调休上班"},
            {date: "2026-09-20", name: "国庆节调休上班"},
            {date: "2026-10-10", name: "国庆节调休上班"}
        ]
    }
};

const state = loadState();
const webdavConfig = loadWebDavConfig();
const calendarApi = {
    years: new Map(),
    failedYears: new Set(),
    status: "loading",
    message: "正在加载日历数据"
};
const today = new Date();
let currentYear = today.getFullYear();
let currentMonth = today.getMonth() + 1;
let activeDate = null;
let selectedDate = null;
let pendingStatus = null;
let pendingOvertime = false;
let overtimeTouched = false;
let pendingHabitCheckins = new Set();
let habitTouched = false;
let selectedHabitIcon = "flag";
let renderVersion = 0;
let settingsRenderTimer = 0;
let statsPeriodMode = "month";
let yearStatsMode = "months";
let currentView = "calendar";
let activeSettingsPanel = "profile";
const CAL_MODE_KEY = "xiuli-calendar-mode";
const CAL_MODES = ["day", "week", "month", "year"];
let calendarMode = (() => {
    try {
        const saved = localStorage.getItem(CAL_MODE_KEY);
        return CAL_MODES.includes(saved) ? saved : "month";
    } catch {
        return "month";
    }
})();
// 日/周视图的锚点日期；月/年视图仅使用其年月部分
let anchorDate = new Date();
let currentReceipt = null;
let currentSalaryReceipt = null;
let salaryReceiptRenderVersion = 0;
let currentLeaveReceipt = null;
const enhancedSelects = new Map();
const enhancedDateInputs = new Map();
let enhancedSelectEventsBound = false;
const narrowScreenQuery = window.matchMedia("(max-width: 760px)");
// 与 styles.css 里“手机端月历”的 @media (max-width: 768px) 保持同一断点。
const compactMonthQuery = window.matchMedia("(max-width: 768px)");
const openBackdrops = new Set();
let searchRenderTimer = 0;
let onboardingStep = 0;
let onboardingDraft = null;
let productTour = null;
let noteTooltipTarget = null;
let dayModalBackdropPress = false;
let googleConnection = {connected: false};
let googleSyncTimer = 0;
let lastGoogleSyncSignature = "";
let stationPickerTarget = "";

const els = {
    app: document.querySelector("main.app"),
    brandHome: document.getElementById("brandHome"),
    yearSelect: document.getElementById("yearSelect"),
    monthSelect: document.getElementById("monthSelect"),
    prevMonth: document.getElementById("prevMonth"),
    nextMonth: document.getElementById("nextMonth"),
    todayBtn: document.getElementById("todayBtn"),
    languageToggle: document.getElementById("languageToggle"),
    settingsToggle: document.getElementById("settingsToggle"),
    searchToggle: document.getElementById("searchToggle"),
    themeToggle: document.getElementById("themeToggle"),
    guideToggle: document.getElementById("guideToggle"),
    recentRecordsToggle: document.getElementById("recentRecordsToggle"),
    recentRecordsPanel: document.getElementById("recentRecordsPanel"),
    closeRecentRecords: document.getElementById("closeRecentRecords"),
    calendarSource: document.getElementById("calendarSource"),
    calendarGrid: document.getElementById("calendarGrid"),
    noteTooltip: document.getElementById("noteTooltip"),
    calendarFooter: document.getElementById("calendarFooter"),
    monthStats: document.getElementById("monthStats"),
    yearStats: document.getElementById("yearStats"),
    statsPeriodMode: document.getElementById("statsPeriodMode"),
    monthStatsPanel: document.getElementById("monthStatsPanel"),
    yearStatsPanel: document.getElementById("yearStatsPanel"),
    yearStatsMode: document.getElementById("yearStatsMode"),
    monthSummary: document.getElementById("monthSummary"),
    overviewCustomize: document.getElementById("overviewCustomize"),
    overviewCustomizeModal: document.getElementById("overviewCustomizeModal"),
    closeOverviewCustomize: document.getElementById("closeOverviewCustomize"),
    overviewCustomizeDone: document.getElementById("overviewCustomizeDone"),
    overviewCustomizeReset: document.getElementById("overviewCustomizeReset"),
    overviewCustomizerPreview: document.getElementById("overviewCustomizerPreview"),
    overviewCustomizerList: document.getElementById("overviewCustomizerList"),
    overviewCustomizerCount: document.getElementById("overviewCustomizerCount"),
    overviewCustomizerStatus: document.getElementById("overviewCustomizerStatus"),
    homeAlerts: document.getElementById("homeAlerts"),
    recentRecords: document.getElementById("recentRecords"),
    welcomeCard: document.getElementById("welcomeCard"),
    welcomeTitle: document.getElementById("welcomeTitle"),
    welcomeSubtitle: document.getElementById("welcomeSubtitle"),
    setupBannerStart: document.getElementById("setupBannerStart"),
    setupBannerDismiss: document.getElementById("setupBannerDismiss"),
    salaryInput: document.getElementById("salaryInput"),
    deductionInput: document.getElementById("deductionInput"),
    estimatedTaxInput: document.getElementById("estimatedTaxInput"),
    specialDeductionInput: document.getElementById("specialDeductionInput"),
    taxCalculationMode: document.getElementById("taxCalculationMode"),
    paydayInput: document.getElementById("paydayInput"),
    personalRateInput: document.getElementById("personalRateInput"),
    sickRateInput: document.getElementById("sickRateInput"),
    annualRateInput: document.getElementById("annualRateInput"),
    compRateInput: document.getElementById("compRateInput"),
    salaryResult: document.getElementById("salaryResult"),
    salaryReceiptLabel: document.getElementById("salaryReceiptLabel"),
    salaryReceiptPeriod: document.getElementById("salaryReceiptPeriod"),
    salaryReceiptYear: document.getElementById("salaryReceiptYear"),
    salaryReceiptMonth: document.getElementById("salaryReceiptMonth"),
    salaryReceiptPrev: document.getElementById("salaryReceiptPrev"),
    salaryReceiptNext: document.getElementById("salaryReceiptNext"),
    annualQuotaInput: document.getElementById("annualQuotaInput"),
    compQuotaInput: document.getElementById("compQuotaInput"),
    annualExpireRule: document.getElementById("annualExpireRule"),
    compExpireRule: document.getElementById("compExpireRule"),
    profileNameInput: document.getElementById("profileNameInput"),
    companyInput: document.getElementById("companyInput"),
    hireDateInput: document.getElementById("hireDateInput"),
    workdaysInput: document.getElementById("workdaysInput"),
    dailyHoursInput: document.getElementById("dailyHoursInput"),
    scheduleTypeInput: document.getElementById("scheduleTypeInput"),
    restDaysPicker: document.getElementById("restDaysPicker"),
    quotaSummary: document.getElementById("quotaSummary"),
    settingsQuotaStatus: document.getElementById("settingsQuotaStatus"),
    exportCsv: document.getElementById("exportCsv"),
    importCsv: document.getElementById("importCsv"),
    icsToolBtn: document.getElementById("icsToolBtn"),
    exportIcsCurrentYear: document.getElementById("exportIcsCurrentYear"),
    exportIcsAll: document.getElementById("exportIcsAll"),
    csvNotice: document.getElementById("csvNotice"),
    dataStatusLine: document.getElementById("dataStatusLine"),
    toolsWebdavHint: document.getElementById("toolsWebdavHint"),
    webdavUrl: document.getElementById("webdavUrl"),
    webdavUsername: document.getElementById("webdavUsername"),
    webdavPassword: document.getElementById("webdavPassword"),
    webdavTest: document.getElementById("webdavTest"),
    webdavUpload: document.getElementById("webdavUpload"),
    webdavDownload: document.getElementById("webdavDownload"),
    webdavStatus: document.getElementById("webdavStatus"),
    webdavBadge: document.getElementById("webdavBadge"),
    webdavMeta: document.getElementById("webdavMeta"),
    webdavConfigure: document.getElementById("webdavConfigure"),
    webdavConfigModal: document.getElementById("webdavConfigModal"),
    webdavConfigArea: document.getElementById("webdavConfigArea"),
    webdavConfigStatus: document.getElementById("webdavConfigStatus"),
    closeWebdavConfig: document.getElementById("closeWebdavConfig"),
    webdavConfigDone: document.getElementById("webdavConfigDone"),
    googleCalendarMeta: document.getElementById("googleCalendarMeta"),
    googleCalendarBadge: document.getElementById("googleCalendarBadge"),
    googleCalendarOptions: document.getElementById("googleCalendarOptions"),
    googleCalendarAutoSync: document.getElementById("googleCalendarAutoSync"),
    googleCalendarConnect: document.getElementById("googleCalendarConnect"),
    googleCalendarSync: document.getElementById("googleCalendarSync"),
    googleCalendarDisconnect: document.getElementById("googleCalendarDisconnect"),
    googleCalendarFeedback: document.getElementById("googleCalendarFeedback"),
    openIcsExport: document.getElementById("openIcsExport"),
    defaultRecipientEmail: document.getElementById("defaultRecipientEmail"),
    googleConfigModal: document.getElementById("googleConfigModal"),
    googleClientId: document.getElementById("googleClientId"),
    googleClientSecret: document.getElementById("googleClientSecret"),
    googleConfigStatus: document.getElementById("googleConfigStatus"),
    closeGoogleConfig: document.getElementById("closeGoogleConfig"),
    googleConfigCancel: document.getElementById("googleConfigCancel"),
    googleConfigContinue: document.getElementById("googleConfigContinue"),
    ticketToolToggle: document.getElementById("ticketToolToggle"),
    ticketToolHint: document.getElementById("ticketToolHint"),
    ticketToolPanel: document.getElementById("ticketToolPanel"),
    ticketReminders: document.getElementById("ticketReminders"),
    ticketGuideText: document.getElementById("ticketGuideText"),
    ticketDepartureRule: document.getElementById("ticketDepartureRule"),
    ticketOrigin: document.getElementById("ticketOrigin"),
    ticketDestination: document.getElementById("ticketDestination"),
    ticketReturnRule: document.getElementById("ticketReturnRule"),
    ticketAdvanceDays: document.getElementById("ticketAdvanceDays"),
    icsTicketTime: document.getElementById("icsTicketTime"),
    habitToolToggle: document.getElementById("habitToolToggle"),
    habitToolHint: document.getElementById("habitToolHint"),
    habitToolPanel: document.getElementById("habitToolPanel"),
    habitCreateForm: document.getElementById("habitCreateForm"),
    habitCreateControl: document.getElementById("habitCreateControl"),
    habitNameCreate: document.getElementById("habitNameCreate"),
    habitIconToggle: document.getElementById("habitIconToggle"),
    habitIconPreview: document.getElementById("habitIconPreview"),
    habitIconMenu: document.getElementById("habitIconMenu"),
    habitList: document.getElementById("habitList"),
    applicantName: document.getElementById("applicantName"),
    leaveGeneratorModal: document.getElementById("leaveGeneratorModal"),
    closeLeaveGenerator: document.getElementById("closeLeaveGenerator"),
    leaveGeneratorDone: document.getElementById("leaveGeneratorDone"),
    downloadLeaveReceipt: document.getElementById("downloadLeaveReceipt"),
    emailLeaveDoc: document.getElementById("emailLeaveDoc"),
    leaveApplicantDoc: document.getElementById("leaveApplicantDoc"),
    leaveRecipientDoc: document.getElementById("leaveRecipientDoc"),
    leaveTypeForDoc: document.getElementById("leaveTypeForDoc"),
    leaveStart: document.getElementById("leaveStart"),
    leaveEnd: document.getElementById("leaveEnd"),
    leaveReasonDoc: document.getElementById("leaveReasonDoc"),
    leaveHandoffDoc: document.getElementById("leaveHandoffDoc"),
    leaveRecipientInput: document.getElementById("leaveRecipientInput"),
    personalReasonInput: document.getElementById("personalReasonInput"),
    sickReasonInput: document.getElementById("sickReasonInput"),
    leaveHandoffInput: document.getElementById("leaveHandoffInput"),
    generateDoc: document.getElementById("generateDoc"),
    leaveReceipt: document.getElementById("leaveReceipt"),
    leaveOutput: document.getElementById("leaveOutput"),
    searchModal: document.getElementById("searchModal"),
    closeSearch: document.getElementById("closeSearch"),
    searchInput: document.getElementById("searchInput"),
    searchStatus: document.getElementById("searchStatus"),
    searchFrom: document.getElementById("searchFrom"),
    searchTo: document.getElementById("searchTo"),
    searchResults: document.getElementById("searchResults"),
    searchClear: document.getElementById("searchClear"),
    searchApply: document.getElementById("searchApply"),
    settingsModal: document.getElementById("settingsModal"),
    settingsPage: document.querySelector(".settings-page"),
    settingsBack: document.getElementById("settingsBack"),
    closeSettings: document.getElementById("closeSettings"),
    settingsDone: document.getElementById("settingsDone"),
    confirmModal: document.getElementById("confirmModal"),
    confirmTitle: document.getElementById("confirmTitle"),
    confirmMessage: document.getElementById("confirmMessage"),
    confirmCancel: document.getElementById("confirmCancel"),
    confirmOk: document.getElementById("confirmOk"),
    receiptModal: document.getElementById("receiptModal"),
    receiptModalTitle: document.getElementById("receiptModalTitle"),
    receiptModalBody: document.getElementById("receiptModalBody"),
    closeReceipt: document.getElementById("closeReceipt"),
    receiptDone: document.getElementById("receiptDone"),
    downloadReceipt: document.getElementById("downloadReceipt"),
    guideModal: document.getElementById("guideModal"),
    closeGuide: document.getElementById("closeGuide"),
    guideDone: document.getElementById("guideDone"),
    onboardingBackdrop: document.getElementById("onboardingBackdrop"),
    onboardingContent: document.getElementById("onboardingContent"),
    onboardingStepLabel: document.getElementById("onboardingStepLabel"),
    onboardingProgress: document.getElementById("onboardingProgress"),
    onboardingBack: document.getElementById("onboardingBack"),
    onboardingSkip: document.getElementById("onboardingSkip"),
    onboardingNext: document.getElementById("onboardingNext"),
    toastRegion: document.getElementById("toastRegion"),
    rerunOnboarding: document.getElementById("rerunOnboarding"),
    exportPersonalSettings: document.getElementById("exportPersonalSettings"),
    clearPersonalSettings: document.getElementById("clearPersonalSettings"),
    clearAllData: document.getElementById("clearAllData"),
    dayModal: document.getElementById("dayModal"),
    modalTitle: document.getElementById("modalTitle"),
    modalSubtitle: document.getElementById("modalSubtitle"),
    modalAdvanced: document.getElementById("modalAdvanced"),
    modalHabits: document.getElementById("modalHabits"),
    modalHabitList: document.getElementById("modalHabitList"),
    modalStartDate: document.getElementById("modalStartDate"),
    modalEndDate: document.getElementById("modalEndDate"),
    modalReasonField: document.getElementById("modalReasonField"),
    modalReason: document.getElementById("modalReason"),
    modalOvertimeField: document.getElementById("modalOvertimeField"),
    modalOvertimeHours: document.getElementById("modalOvertimeHours"),
    modalOvertimeRate: document.getElementById("modalOvertimeRate"),
    modalOvertimeScope: document.getElementById("modalOvertimeScope"),
    modalOvertimeReason: document.getElementById("modalOvertimeReason"),
    modalNote: document.getElementById("modalNote"),
    modalRangeNotice: document.getElementById("modalRangeNotice"),
    modalGenerateDoc: document.getElementById("modalGenerateDoc"),
    modalClear: document.getElementById("modalClear"),
    modalAddCalendar: document.getElementById("modalAddCalendar"),
    modalSave: document.getElementById("modalSave"),
    closeModal: document.getElementById("closeModal"),
    modalCancel: document.getElementById("modalCancel")
};

const backdropTimers = new WeakMap();
const modalReturnFocus = new WeakMap();
let lockedScrollY = -1;

let themeAnimTimer = 0;

// 旧版设置分组名 → 新分类
const SETTINGS_GROUP_ALIASES = {personal: "profile", webdav: "data"};

const DATE_RANGE_PAIRS = {
    searchFrom: ["searchFrom", "searchTo"],
    searchTo: ["searchFrom", "searchTo"],
    leaveStart: ["leaveStart", "leaveEnd"],
    leaveEnd: ["leaveStart", "leaveEnd"],
    modalStartDate: ["modalStartDate", "modalEndDate"],
    modalEndDate: ["modalStartDate", "modalEndDate"]
};

let lastCalendarKey = "";
let dayPageTransitionTimer = 0;

// ===== 日视图·每日一言（中文一言 Hitokoto / 英文 Quotable + 本地兜底） =====
const QUOTE_CACHE_KEY = "xiuli-day-quotes-v1";
const QUOTE_CACHE_LIMIT = 90;
// c=d 文学 / c=i 诗词 / c=k 哲学，贴合本地名句的调性；中文按字算宽，限 60 字
const HITOKOTO_URL = "https://v1.hitokoto.cn/?c=d&c=i&c=k&max_length=60";
const FALLBACK_QUOTES_ZH = [
    {content: "不积跬步，无以至千里。", author: "《荀子》"},
    {content: "逝者如斯夫，不舍昼夜。", author: "《论语》"},
    {content: "一张一弛，文武之道也。", author: "《礼记》"},
    {content: "业精于勤，荒于嬉。", author: "韩愈"},
    {content: "盛年不重来，一日难再晨。", author: "陶渊明"},
    {content: "千里之行，始于足下。", author: "《老子》"},
    {content: "会当凌绝顶，一览众山小。", author: "杜甫"},
    {content: "长风破浪会有时，直挂云帆济沧海。", author: "李白"},
    {content: "纸上得来终觉浅，绝知此事要躬行。", author: "陆游"},
    {content: "采菊东篱下，悠然见南山。", author: "陶渊明"},
    {content: "休对故人思故国，且将新火试新茶。", author: "苏轼"},
    {content: "宠辱不惊，闲看庭前花开花落。", author: "《菜根谭》"},
    {content: "静以修身，俭以养德。", author: "诸葛亮"},
    {content: "流水不争先，争的是滔滔不绝。", author: "《道德经》衍语"}
];
const FALLBACK_QUOTES_EN = [
    {content: "The early bird gets the worm.", author: "Proverb"},
    {content: "Every cloud has a silver lining.", author: "Proverb"},
    {content: "No pain, no gain.", author: "Proverb"},
    {content: "Time flies when you're having fun.", author: "Proverb"},
    {content: "Where there's a will, there's a way.", author: "Proverb"},
    {content: "A picture is worth a thousand words.", author: "Proverb"},
    {content: "Actions speak louder than words.", author: "Proverb"},
    {content: "All's well that ends well.", author: "William Shakespeare"},
    {content: "Fortune favors the bold.", author: "Virgil"},
    {content: "The only way out is through.", author: "Robert Frost"},
    {content: "Be the change you wish to see.", author: "Mahatma Gandhi"},
    {content: "Life is what you make it.", author: "Proverb"},
    {content: "Success is a journey, not a destination.", author: "Arthur Ashe"},
    {content: "Dream big and dare to fail.", author: "Norman Vaughan"}
];
const quoteInflight = new Set();

let confirmResolver = null;

const holidayCache = new Map();
const makeupCache = new Map();

const lunarTextCache = new Map();
const traditionalFestivalCache = new Map();

const solarTermCache = new Map();

// 启动放在最后：init() 会同步跑到第一个 await 为止，期间会碰到这个脚本里的
// 各种顶层 const / let（backdropTimers、themeAnimTimer、holidayCache 等）。
// 放在声明中间时，只要有任何一条同步路径碰到尚未初始化的那一个，就是 TDZ 报错。
init().catch(error => {
    calendarApi.status = "fallback";
    calendarApi.message = `日历数据加载异常，已使用本地备用数据：${error.message}`;
    renderStaticError(error);
});
