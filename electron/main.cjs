const { app, BrowserWindow, session, shell } = require("electron");
const { randomBytes } = require("crypto");
const path = require("path");
const http = require("http");

const PORT = 48721;
const APP_ORIGIN = `http://127.0.0.1:${PORT}`;
const EXTERNAL_HOSTS = new Set(["github.com", "steamcommunity.com", "ffmpeg.org"]);
const apiToken = randomBytes(32).toString("hex");
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let window;

function waitForServer(attempts = 80) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(APP_ORIGIN, (response) => {
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
  process.env.KBM_API_TOKEN = apiToken;
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
  await session.defaultSession.cookies.set({
    url: APP_ORIGIN,
    name: "kbm_session",
    value: apiToken,
    httpOnly: true,
    sameSite: "strict",
  });
  window.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" && !target.username && !target.password && !target.port && EXTERNAL_HOSTS.has(target.hostname)) shell.openExternal(url);
    } catch { /* Ignore invalid external links. */ }
    return { action: "deny" };
  });
  await window.loadURL(APP_ORIGIN);
}

app.on("second-instance", () => {
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
