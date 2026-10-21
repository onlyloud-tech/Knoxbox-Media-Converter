import assert from "assert/strict";
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import http from "http";
import net from "net";
import path from "path";
import { checkUploadSpace, InsufficientSpaceError } from "../server/disk";

async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a test port.");
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

function request(port: number, url: string, options: http.RequestOptions = {}, body = "") {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const call = http.request({ host: "127.0.0.1", port, path: url, ...options }, response => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode || 0, headers: response.headers }));
    });
    call.on("error", reject);
    call.end(body);
  });
}

const port = await unusedPort();
assert.throws(() => checkUploadSpace(process.cwd(), process.cwd(), 1024 ** 5), InsufficientSpaceError);
const token = randomBytes(32).toString("hex");
const child = spawn(process.execPath, [path.resolve("dist/index.cjs")], {
  env: { ...process.env, PORT: String(port), NODE_ENV: "production", KBM_API_TOKEN: token },
  windowsHide: true,
  stdio: "ignore",
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await request(port, "/"); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(ready, "Packaged server did not start.");
  const cookie = `kbm_session=${token}`;
  assert.equal((await request(port, "/api/status")).status, 401);
  assert.equal((await request(port, "/api/status", { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await request(port, "/api/status", { headers: { Cookie: cookie, Origin: "https://attacker.example" } })).status, 403);
  assert.equal((await request(port, "/api/status", { headers: { Cookie: cookie, Host: `attacker.example:${port}` } })).status, 403);
  assert.equal((await request(port, "/api/packs", { method: "POST", headers: { Cookie: cookie, Origin: "https://attacker.example", "Content-Type": "application/x-www-form-urlencoded" } }, "modId=Injected")).status, 403);
  const page = await request(port, "/");
  assert.equal(page.status, 200);
  assert.match(String(page.headers["content-security-policy"]), /default-src 'self'/);
  console.log("Security test passed: session, Origin, Host, cross-site mutation, and CSP.");
} finally {
  child.kill();
}
