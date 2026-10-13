// UAT K1 phần C: chạy quy trình sdlc-delivery (evolu) với agent intake-analyst đã tick kh-main; xem KnowledgeNotice; duyệt gate; kiểm KH mock nhận /vector/add.
// Dùng: node k1-run.mjs <outDir> <key: sdlc-delivery|bug-fix> <defId>
import { launch, chatLogin, adminLogin, mkSnap, mkStep, expect, CHAT, ADMIN } from "./lib.mjs";
import { setHits, kh } from "./hits.mjs";
import { writeFileSync } from "node:fs";
import { chromium } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
const OUT = process.argv[2];
const KEY = process.argv[3] ?? "sdlc-delivery";
const DEF = process.argv[4];
const PRE = KEY === "sdlc-delivery" ? "30" : "50";
const SEC0 = KEY === "sdlc-delivery"
  ? ["Mục tiêu", "Trong phạm vi", "Ngoài phạm vi", "Điều kiện ký chốt", "Bàn giao", "Tóm tắt"]
  : ["Hiện tượng", "Cách tái hiện", "Mức ảnh hưởng", "Bàn giao", "Tóm tắt"];
const ALL = [...new Set(["Mục tiêu","Trong phạm vi","Ngoài phạm vi","Điều kiện ký chốt","Mốc","Phân công","Rủi ro","Yêu cầu","Luật nghiệp vụ","Tiêu chí chấp nhận","Thành phần","Contract","Dữ liệu","Nhánh","Task đã xong","Lệnh test","Kết luận","Phát hiện","Việc phải sửa","Độ phủ theo AC","Lỗi tìm thấy","Kịch bản","Evidence","Ghi chú phát hành","Tài liệu cập nhật","Hiện tượng","Cách tái hiện","Mức ảnh hưởng","Vị trí liên quan","Nguyên nhân gốc","Thay đổi","Test hồi quy","Ca đã chạy","Lỗi còn lại","Theo dõi sau phát hành","Bàn giao","Tóm tắt"])];
const STAGE0 = KEY === "sdlc-delivery" ? "Chốt phạm vi" : null;
const { browser, page: A } = await launch(OUT);
const mk = async (lang = "vi") => { const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN", storageState: (await import("./lib.mjs")).storage(lang) }); return c.newPage(); };
const B = await mk(), C = await mk();
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ A, B, C }), snap);
let runId = null, stageRunIds = [];
const INPUT = KEY === "sdlc-delivery"
  ? 'Thêm tính năng xuất báo cáo PDF (UAT K1). #fake:tool=kh-query #fake:args={"query":"Quy ước đặt tên module và RLS","project":"evolu"}'
  : 'Lỗi: nút Lưu báo 500 khi tên có dấu (UAT K1). #fake:tool=kh-query #fake:args={"query":"Mọi query lọc tenant_id","project":"evolu"}';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await step(`${PRE}-01`, `Chuẩn bị: reset mock KH, hit chứa các mục của stage đầu; thomas.tran (evolu) bắt đầu !${KEY} ở chat-web`, async () => {
  await fetch("http://localhost:4030/__mock/kh/reset", { method: "POST" });
  await setHits(ALL);
  await chatLogin(A, "thomas.tran");
  await A.getByRole("textbox", { name: "Tin nhắn" }).fill(`!${KEY} ${INPUT}`);
  await snap(A, `${PRE}-A-composer`);
  await A.keyboard.press("Enter");
  await A.waitForURL(/\/runs\//);
  runId = A.url().split("/runs/")[1].split(/[?#]/)[0];
  await expect(A.getByRole("button", { name: "Đạt", exact: true })).toBeVisible({ timeout: 90000 });
  await snap(A, `${PRE}-A-gate0`, true);
});
await step(`${PRE}-02`, "Mock KH nhận /vector/query đúng project, có khoá hợp lệ (header), không lộ khoá ở nơi khác", async () => {
  const d = await kh();
  const q = d.calls.filter((c) => c.path === "/vector/query");
  expect(q.length).toBe(1);
  expect(q[0].sent_key && q[0].key_ok).toBe(true);
  expect(q[0].body.project).toBe("evolu");
  expect(JSON.stringify(q[0].body)).not.toContain("mock-kh-key");
  const html = await A.content();
  expect(html).not.toContain("mock-kh-key");
});
await step(`${PRE}-03`, "chat-web trang Run: KnowledgeNotice hiện 'Tri thức: 1/5 lần hỏi · Tóm tắt…' (plan-frontend màn 5)", async () => {
  await expect(A.getByText(/Tri thức: 1\/5 lần hỏi/)).toBeVisible({ timeout: 5000 });
  await snap(A, `${PRE}-A-notice`);
});
await step(`${PRE}-04`, "admin-web (julian.bui): trang run → Xem kết quả → KnowledgeNotice trong dialog", async () => {
  await adminLogin(C, "julian.bui", "evolu");
  await C.goto(`${ADMIN}/processes/${DEF}/runs/${runId}`);
  await C.waitForTimeout(2500);
  await snap(C, `${PRE}-C-admin-run`, true);
  await C.getByRole("button", { name: /Xem kết quả|View result|View output/i }).first().click();
  const dlg = C.getByRole("dialog").first();
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText(/Tri thức: 1\/5 lần hỏi|Knowledge: 1\/5 queries/)).toBeVisible({ timeout: 5000 });
  await snap(C, `${PRE}-C-admin-dialog`);
});
await step(`${PRE}-05`, "vio.ngo (Beta testers) duyệt gate Đạt → stage xong → /vector/add id kw-<run>-<stage_run>-v<ver>, subject <quy trình>/<stage>", async () => {
  await chatLogin(B, "vio.ngo");
  await B.goto(`${CHAT}/runs/${runId}`);
  await snap(B, `${PRE}-B-gate0`, true);
  await B.getByRole("button", { name: "Đạt", exact: true }).click();
  let adds = [];
  for (let i = 0; i < 30 && adds.length === 0; i++) { await sleep(2000); adds = (await kh()).calls.filter((c) => c.path === "/vector/add"); }
  expect(adds.length).toBeGreaterThan(0);
  const d = await kh();
  const v = d.vectors[0];
  console.log("vector", v.id, JSON.stringify(v.scope), JSON.stringify(v.metadata));
  expect(v.id).toMatch(new RegExp(`^kw-${runId}-[0-9a-f-]{36}-v\\d+$`));
  expect(v.writes).toBe(1);
  expect(JSON.stringify(v)).not.toContain("mock-kh-key");
  expect(JSON.stringify(v.metadata) + JSON.stringify(v.scope) + v.text.slice(0, 0)).toContain(KEY);
});
await step(`${PRE}-06`, "Chạy tiếp tới hết: B duyệt các gate còn lại (Đạt) tới khi run Hoàn tất", async () => {
  for (let i = 0; i < 50; i++) {
    const st = await fetchStatus(runId);
    if (["done", "cancelled", "failed", "expired"].includes(st)) break;
    if (st === "needs_decision") break; // sdlc: stage nhóm "Hiện thực" ⇒ team_no_change với fake-cli (giới hạn, xem REPORT)
    await B.goto(`${CHAT}/runs/${runId}`);
    await B.waitForTimeout(1500);
    const ok = B.getByRole("button", { name: "Đạt", exact: true });
    if (await ok.count()) { await ok.first().click(); await sleep(3000); } else await sleep(4000);
  }
  const st = await fetchStatus(runId);
  console.log("final status", st);
  if (KEY === "sdlc-delivery") {
    expect(st).toBe("needs_decision"); // dừng ở stage nhóm (giới hạn fake-cli); 4 stage đầu đã Đạt
    const T = await token();
    const v = await (await fetch(`http://localhost:4000/process-runs/${runId}`, { headers: { authorization: `Bearer ${T}` } })).json();
    expect(v.stages.slice(0, 4).map((x) => x.status)).toEqual(["done", "done", "done", "done"]);
    expect(v.stages[4].status).toBe("needs_decision");
    await C.goto(`${ADMIN}/processes/${DEF}/runs/${runId}`);
    await C.waitForTimeout(2500);
    await snap(C, `${PRE}-C-needs-decision-team`, true);
  } else expect(st).toBe("done");
  const tj = JSON.stringify(await (await fetch(`http://localhost:4000/process-runs/${runId}`, { headers: { authorization: `Bearer ${await token()}` } })).json());
  console.log("permission_lost in run JSON:", tj.includes("permission_lost"));
  expect(tj.includes("permission_lost")).toBe(false); // Minor 6: seed đủ quyền, không cấp tay
  await A.goto(`${CHAT}/runs/${runId}`); // người khởi chạy (thomas.tran) mới xem được toàn bộ tiến độ
  await A.waitForTimeout(2500);
  const nNotice = await A.getByText(/Tri thức: \d+\/5 lần hỏi/).count();
  console.log("KnowledgeNotice count on /runs page:", nNotice);
  expect(nNotice).toBe(KEY === "sdlc-delivery" ? 9 : 6); // M1: mỗi stage (cả chưa tới) hiện 1 dòng notice
  await snap(A, `${PRE}-A-done-notices`, true);
});
await step(`${PRE}-07`, "Admin: dialog kết quả stage đầu sau khi ghi Tóm tắt: 'Tóm tắt: đã ghi (ghi vào evolu · kh-main)'", async () => {
  await C.goto(`${ADMIN}/processes/${DEF}/runs/${runId}`);
  await C.waitForTimeout(2500);
  await C.getByRole("button", { name: /Xem kết quả|View result|View output/i }).first().click();
  const dlg = C.getByRole("dialog").first();
  await expect(dlg.getByText(/Tóm tắt: đã ghi|Summary: written/)).toBeVisible({ timeout: 5000 });
  await expect(dlg).toContainText("evolu · kh-main");
  await snap(C, `${PRE}-C-dialog-written`);
});
await step(`${PRE}-08`, "Mỗi stage xong có đúng một vector kw-<run>-<stage_run>-v1 (ghi 1 lần), subject <quy trình>/<stage>", async () => {
  const d = await kh();
  const expectN = KEY === "sdlc-delivery" ? 4 : 6;
  await sleep(12000);
  const d2 = await kh();
  console.log("vectors", d2.vectors.map((x) => `${x.id.slice(-12)}|${x.metadata?.subject}|w${x.writes}`).join(" ; "));
  expect(d2.vectors.length).toBe(expectN);
  for (const x of d2.vectors) { expect(x.id).toMatch(new RegExp(`^kw-${runId}-[0-9a-f-]{36}-v1$`)); expect(x.writes).toBe(1); expect(x.metadata.subject.startsWith(`${KEY}/`)).toBe(true); }
  writeFileSync(`${OUT}/kh-mock-calls.json`, JSON.stringify({ calls: d2.calls.map((c) => ({ ...c, body: c.path === "/vector/add" ? { ...c.body, text: String(c.body?.text ?? "").slice(0, 80) } : c.body })), vectors: d2.vectors.map((x) => ({ id: x.id, writes: x.writes, metadata: x.metadata, text: x.text.slice(0, 120) })) }, null, 2));
  if (KEY === "sdlc-delivery") { // dọn: huỷ run đang dừng để không treo
    await fetch(`http://localhost:4000/process-runs/${runId}/cancel`, { method: "POST", headers: { authorization: `Bearer ${await token()}` } });
  }
});
save(); await browser.close();

async function token() {
  return (await (await fetch("http://localhost:3001/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: "evolu", username: "thomas.tran", password: "1234567890" }) })).json()).access_token;
}
async function fetchStatus(id) {
  const t = await token();
  const r = await (await fetch(`http://localhost:4000/process-runs/${id}`, { headers: { authorization: `Bearer ${t}` } })).json();
  return r.status;
}
