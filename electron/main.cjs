const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");

const PORT = 48721;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let window;

function waitForServer(attempts = 80) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(`http://127.0.0.1:${PORT}/api/status`, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (attempts-- <= 0) reject(new Error("Local server did not start."));
        else setTimeout(check, 150);
      });
    };
    check();
  });
}

async function createWindow() {
  process.env.NODE_ENV = "production";
  process.env.PORT = String(PORT);
  process.env.KBM_FFMPEG = path.join(process.resourcesPath, "vendor", "ffmpeg", "ffmpeg.exe");
  require(path.join(app.getAppPath(), "dist", "index.cjs"));
  await waitForServer();
  window = new BrowserWindow({
    icon: path.join(app.getAppPath(), "build", "icon.ico"),
    width: 1220,
    height: 850,
    minWidth: 820,
    minHeight: 650,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  await window.loadURL(`http://127.0.0.1:${PORT}`);
}

app.on("second-instance", () => {
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
