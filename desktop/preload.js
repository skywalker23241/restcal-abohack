const { contextBridge, ipcRenderer } = require("electron");

// 把 WebDav 请求能力暴露给渲染进程。请求实际在主进程用 Node 发出，
// 绕过浏览器的同源/CORS 限制，从而兼容坚果云、Nextcloud、群晖等服务器。
// sandbox 模式下 contextBridge / ipcRenderer 仍可用，无需关闭沙箱。
contextBridge.exposeInMainWorld("xiuliDav", {
    request: options => ipcRenderer.invoke("webdav:request", options)
});
