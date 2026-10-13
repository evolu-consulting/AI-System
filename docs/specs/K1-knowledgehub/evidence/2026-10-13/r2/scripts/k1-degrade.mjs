// UAT K1 phần D: KH lỗi (mock scenario server_error) → stage hạ cấp, cảnh báo ở admin OutputDialog (và chat-web)
import { launch, chatLogin, adminLogin, mkSnap, mkStep, expect, CHAT, ADMIN, storage } from "./lib.mjs";
import { setHits } from "./hits.mjs";
const OUT = process.argv[2], DEF = process.argv[3];
const { browser, page: A } = await launch(OUT);
const C = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN", storageState: storage("vi") })).newPage();
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A, C }), snap);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let runId;
await step("60-01", "Mock KH trả 500 cho /vector/*; thomas bắt đầu !bug-fix có kh-query → stage vẫn chạy (không có tri thức)", async () => {
  await fetch("http://localhost:4030/__mock/kh/reset", { method: "POST" });
  await setHits(["Hiện tượng", "Cách tái hiện", "Mức ảnh hưởng", "Bàn giao", "Tóm tắt"]);
  await fetch("http://localhost:4030/__mock/kh", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "server_error" }) });
  await chatLogin(A, "thomas.tran");
  await A.getByRole("textbox", { name: "Tin nhắn" }).fill('!bug-fix Lỗi: nút Lưu báo 500 (UAT K1, KH down). #fake:tool=kh-query #fake:args={"query":"tenant","project":"evolu"}');
  await A.keyboard.press("Enter");
  await A.waitForURL(/\/runs\//);
  runId = A.url().split("/runs/")[1].split(/[?#]/)[0];
  await sleep(25000);
  await A.reload(); await A.waitForTimeout(2000);
  await snap(A, "60-A-run-degraded", true);
});
await step("60-02", "Admin OutputDialog: Alert 'Không truy cập được KnowledgeHub — stage đã chạy không có tri thức.' + lý do", async () => {
  await adminLogin(C, "julian.bui", "evolu");
  await C.goto(`${ADMIN}/processes/${DEF}/runs/${runId}`);
  await C.waitForTimeout(2500);
  await snap(C, "60-C-admin-run", true);
  await C.getByRole("button", { name: /Xem kết quả|View output|View result/i }).first().click();
  const dlg = C.getByRole("dialog").first();
  await expect(dlg.getByRole("status").filter({ hasText: /Không truy cập được KnowledgeHub|KnowledgeHub is unreachable|Cannot reach KnowledgeHub|unreachable/i })).toBeVisible({ timeout: 5000 });
  await snap(C, "60-C-admin-dialog-warning");
});
await fetch("http://localhost:4030/__mock/kh/reset", { method: "POST" });
await fetch(`http://localhost:4000/process-runs/${runId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${(await (await fetch("http://localhost:3001/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: "evolu", username: "thomas.tran", password: "1234567890" }) })).json()).access_token}` } }).catch(() => {});
save(); await browser.close();
