const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

// 静态文件根目录：开发时是仓库根目录，打包后是 app.asar 根目录。
const root = path.join(__dirname, "..");

const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://xiuli`;

// 用自定义协议而不是 file://：页面里农历、节假日 JSON 是通过 fetch 加载的，
// file:// 下 fetch 会失败并退回内置备用数据；标准安全协议下 fetch 和
// localStorage 都正常，且 origin 固定，用户数据不会因端口变化丢失。
protocol.registerSchemesAsPrivileged([
    {
        scheme: APP_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
]);

function handleAppRequest(request) {
    const url = new URL(request.url);
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return new Response("Bad request", { status: 400 });
    }
    const requested = pathname === "" || pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = path.resolve(root, requested);
    const relative = path.relative(root, file);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response("Not found", { status: 404 }));
}

function openExternally(url) {
    if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url);
    }
}

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 360,
        minHeight: 560,
        autoHideMenuBar: true,
        backgroundColor: "#f6f3ed",
        icon: path.join(root, "icons", "icon-512.png"),
        webPreferences: {
            contextIsolation: true,
            sandbox: true
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        openExternally(url);
        return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith(`${APP_ORIGIN}/`)) {
            event.preventDefault();
            openExternally(url);
        }
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    mainWindow.loadURL(`${APP_ORIGIN}/`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        Menu.setApplicationMenu(null);
        protocol.handle(APP_SCHEME, handleAppRequest);
        createWindow();
        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on("window-all-closed", () => {
        app.quit();
    });
}
