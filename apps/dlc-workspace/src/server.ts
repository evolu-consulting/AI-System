// dlc-dify · khởi động workspace DLC. Env: DLC_WS_DIR (thư mục dữ liệu, bắt buộc), DLC_WS_TOKEN (≥ 32 ký tự, bắt buộc),
// DLC_WS_PORT (mặc định 4600), DLC_WS_IMAGE (ảnh chạy lệnh, mặc định node:22-bookworm), DLC_WS_EXEC_MAX_S (mặc định 1800),
// DLC_WS_PUBLIC_HOST (host trong URL app đã deploy, vd IP máy chủ; mặc định localhost), DLC_WS_APP_PORTS (dải cổng cấp
// cho app, mặc định 4620-4699).
import { createApp } from "./app";
import { parsePortRange } from "./deploy-plan.rules";
import { Store } from "./store";

const dir = process.env.DLC_WS_DIR;
const token = process.env.DLC_WS_TOKEN;
if (!dir || !token || token.length < 32) {
  console.error("dlc-workspace: cần DLC_WS_DIR và DLC_WS_TOKEN (≥ 32 ký tự)");
  process.exit(1);
}
const port = Number(process.env.DLC_WS_PORT ?? 4600);
const app = createApp({
  store: new Store(dir),
  token,
  image: process.env.DLC_WS_IMAGE ?? "node:22-bookworm",
  execMaxS: Number(process.env.DLC_WS_EXEC_MAX_S ?? 1800),
  publicHost: process.env.DLC_WS_PUBLIC_HOST || "localhost",
  appPorts: parsePortRange(process.env.DLC_WS_APP_PORTS),
});
Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch, idleTimeout: 0 });
console.log(JSON.stringify({ msg: "dlc-workspace listening", port }));
