const { contextBridge, ipcRenderer } = require("electron");

// 把 WebDAV 请求能力暴露给渲染进程。请求实际使用 Electron 网络栈发出，
// 同时绕过浏览器 CORS，并继承系统代理和证书配置。
// sandbox 模式下 contextBridge / ipcRenderer 仍可用，无需关闭沙箱。
contextBridge.exposeInMainWorld("xiuliDav", {
    request: options => ipcRenderer.invoke("webdav:request", options)
});

contextBridge.exposeInMainWorld("xiuliCalendar", {
    addEvent: options => ipcRenderer.invoke("calendar:add-event", options),
    getLaunchUrl: () => ipcRenderer.invoke("calendar:get-launch-url"),
    onDeepLink: callback => {
        if (typeof callback !== "function") return () => {};
        const listener = (_event, url) => callback(url);
        ipcRenderer.on("calendar:deep-link", listener);
        return () => ipcRenderer.removeListener("calendar:deep-link", listener);
    }
});

contextBridge.exposeInMainWorld("xiuliMail", {
    compose: options => ipcRenderer.invoke("mail:compose", options)
});

contextBridge.exposeInMainWorld("xiuliGoogleCalendar", {
    status: () => ipcRenderer.invoke("google-calendar:status"),
    connect: clientId => ipcRenderer.invoke("google-calendar:connect", clientId),
    sync: events => ipcRenderer.invoke("google-calendar:sync", events),
    disconnect: () => ipcRenderer.invoke("google-calendar:disconnect")
});
