// UAT P-b2 · kịch bản 2 — chat-web (A=thomas.tran người bắt đầu, B=vio.ngo, C=edgar.nguyen: Group kiểm sdlc-reviewers).
// Quy trình pb2-uat-edit (đã sửa bằng canvas ở admin.mjs): bước1[Phân tích] -> bước2[Test hồi quy | Rà soát code] -> bước3[Tổng hợp].
import { chromium, viCtx, EVD, runner, results } from "./pw.mjs";
import { writeFileSync } from "node:fs";
import { q, view, hub, tk, sleep } from "./lib2.mjs";

const ROOM = "d2a00000-0000-4000-8000-000000000002";
const CHAT = "http://localhost:3100";
const b = await chromium.launch();
const mk = async (user) => {
  const c = await viCtx(b, { width: 1440, height: 900 });
  const p = await c.newPage();
  await p.goto(CHAT + "/login");
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByLabel("Mật khẩu").fill("1234567890");
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL(/\/c\/new$/);
  return p;
};
const A = await mk("thomas.tran");
const B = await mk("vio.ngo");
const C = await mk("edgar.nguyen");
const step0 = runner("chat", () => ({ A, B, C }));
const ONLY = process.env.ONLY;
const step = (id, t, fn) => (ONLY && !ONLY.split(",").includes(id) ? Promise.resolve() : step0(id, t, fn));
const shot = (p, name, full = false) => p.screenshot({ path: `${EVD}/${name}.png`, fullPage: full });
const card = (p, stage) => p.getByRole("region", { name: `Kiểm ${stage}` });
const stagesOf = async (id) => (await view("vio.ngo", id)).stages.map((s) => `${s.name}:${s.status}:r${s.round}`).join(" | ");
async function waitStages(id, want, ms = 90000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    const v = await view("vio.ngo", id);
    last = v.stages.map((s) => `${s.name}:${s.status}`).join(" | ");
    if (want(v)) return v;
    await sleep(1500);
  }
  throw new Error("chờ quá hạn: " + last);
}
const st = (v, name) => v.stages.find((s) => s.name === name);
async function startRun(p, key) {
  await p.goto(`${CHAT}/rooms/${ROOM}`);
  await p.getByRole("textbox", { name: /Tin nhắn cho/ }).waitFor();
  await p.getByRole("button", { name: "Quy trình", exact: true }).click();
  await p.getByRole("listbox", { name: "Quy trình" }).getByRole("option").filter({ hasText: `!${key}` }).click();
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && /\/process-runs$/.test(r.url()));
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
  const f = p.getByRole("dialog", { name: /Thông tin cho quy trình/ });
  if (await f.count()) await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  const r = await resp;
  return (await r.json()).id;
}
const pass = async (p, id, stage) => {
  await p.goto(`${CHAT}/runs/${id}`);
  const c = card(p, stage);
  await c.waitFor({ timeout: 20000 });
  await c.getByRole("button", { name: "Đạt", exact: true }).click();
};
const failBack = async (p, id, stage, fb, shotName) => {
  await p.goto(`${CHAT}/runs/${id}`);
  const c = card(p, stage);
  await c.waitFor({ timeout: 20000 });
  await c.getByRole("button", { name: "Chưa đạt", exact: true }).click();
  const rg = c.getByRole("radiogroup", { name: "Chưa đạt thì…" });
  await rg.getByRole("radio", { name: "Quay lại bước 1" }).check();
  await c.getByRole("textbox", { name: "Góp ý" }).fill(fb);
  if (shotName) { await c.evaluate((e) => e.scrollIntoView({ block: "center" })); await shot(p, shotName); }
  await c.getByRole("button", { name: "Gửi chưa đạt" }).click();
};
let RUN = null;

await step("C01", "thomas bắt đầu pb2-uat-edit trong phòng; StageStrip theo bước (bước 2 song song)", async () => {
  RUN = await startRun(A, "pb2-uat-edit");
  await waitStages(RUN, (v) => st(v, "Phân tích").status === "waiting_review");
  await A.goto(`${CHAT}/rooms/${ROOM}`);
  const blk = A.getByRole("article", { name: "Quy trình UAT P-b2 canvas" }).last();
  const strip = blk.getByRole("list", { name: "Tiến độ quy trình" });
  await strip.waitFor({ timeout: 20000 });
  const par = strip.getByRole("list", { name: "Bước 2 — chạy song song" });
  const n = await par.getByRole("listitem").count();
  await blk.scrollIntoViewIfNeeded();
  await shot(A, "01-A-room-strip-step1");
  if (n !== 2) throw new Error("bước 2 song song có " + n + " mục");
});

await step("C02", "stage 1 không có 'quay lại' (back_to rỗng): 'Chưa đạt' hành vi cũ, rồi Đạt => bước 2 chạy song song", async () => {
  await B.goto(`${CHAT}/runs/${RUN}`);
  const c = card(B, "Phân tích");
  await c.waitFor({ timeout: 20000 });
  await c.getByRole("button", { name: "Chưa đạt", exact: true }).click();
  const radios = await c.getByRole("radiogroup", { name: "Chưa đạt thì…" }).count();
  await shot(B, "02-B-stage1-fail-no-back");
  if (radios !== 0) throw new Error("stage 1 không được có lựa chọn quay lại");
  await B.reload();
  await c.waitFor({ timeout: 20000 });
  await c.getByRole("button", { name: "Đạt", exact: true }).click();
  await waitStages(RUN, (v) => st(v, "Rà soát code").status === "waiting_review" && st(v, "Test hồi quy").status === "waiting_review");
});

await step("C03", "bước 2 cả hai chờ duyệt (nhóm 'Bước 2'); Đạt Rà soát chỉ đóng task stage đó, bước 3 chưa chạy", async () => {
  await B.goto(`${CHAT}/runs/${RUN}`);
  const g = B.getByRole("group", { name: "Bước 2" });
  await g.waitFor({ timeout: 20000 });
  const cards = await g.getByRole("region", { name: /^Kiểm / }).count();
  await shot(B, "03-B-run-step2-two-cards");
  if (cards !== 2) throw new Error("số thẻ trong nhóm Bước 2 = " + cards);
  await card(B, "Rà soát code").getByRole("button", { name: "Đạt", exact: true }).click();
  const v = await waitStages(RUN, (v) => st(v, "Rà soát code").status === "done");
  const tong = st(v, "Tổng hợp").status;
  const test = st(v, "Test hồi quy").status;
  await B.waitForTimeout(1500);
  await shot(B, "03-B-after-pass-one");
  if (test !== "waiting_review") throw new Error("Test hồi quy bị ảnh hưởng: " + test);
  if (tong !== "pending") throw new Error("Tổng hợp không còn pending: " + tong);
});

await step("C04", "edgar chấm Chưa đạt 'Test hồi quy': panel 'Quay lại bước 1', góp ý bắt buộc, cảnh báo còn 3 lần", async () => {
  await C.goto(`${CHAT}/runs/${RUN}`);
  const c = card(C, "Test hồi quy");
  await c.waitFor({ timeout: 20000 });
  await c.getByRole("button", { name: "Chưa đạt", exact: true }).click();
  const rg = c.getByRole("radiogroup", { name: "Chưa đạt thì…" });
  await rg.waitFor();
  if (!(await rg.getByRole("radio", { name: "Làm lại giai đoạn này" }).isChecked())) throw new Error("mặc định không phải 'Làm lại giai đoạn này'");
  await rg.getByRole("radio", { name: "Quay lại bước 1" }).check();
  const note = await c.getByRole("note").innerText();
  await c.evaluate((e) => e.scrollIntoView({ block: "center" }));
  await shot(C, "04-C-fail-panel-back");
  if (!/Còn 3 lần quay lại/.test(note)) throw new Error("cảnh báo: " + note);
  await c.getByRole("button", { name: "Gửi chưa đạt" }).click();
  await c.getByText("Nhập góp ý trước khi gửi.").waitFor({ timeout: 5000 });
  await shot(C, "04-C-feedback-required");
  await c.getByRole("textbox", { name: "Góp ý" }).fill("Thiếu ca hồi quy cho luồng đăng nhập");
  await c.getByRole("button", { name: "Gửi chưa đạt" }).click();
  await C.getByText("Đã quay lại bước 1. Các giai đoạn sẽ chạy lại với góp ý của bạn.").waitFor({ timeout: 8000 });
  await shot(C, "04-C-toast-went-back");
});

await step("C05", "sau quay lại: DB (round 2, back_rounds=1, event), StageStrip ×2 + vệt 'Quay lại bước 1'", async () => {
  const v = await waitStages(RUN, (v) => st(v, "Phân tích").status === "waiting_review" && st(v, "Phân tích").round === 2);
  const r = await hub(await tk("vio.ngo"), "GET", "/process-runs/" + RUN);
  const stages = r.json.stages.map((s) => `${s.name}:${s.status}:r${s.round}`).join(" | ");
  const info = `back_rounds=${r.json.back_rounds} back_limit=${r.json.back_limit} events=${r.json.back_events.length}; ${stages}`;
  writeFileSync(EVD + "/c05-run-state.txt", info);
  await A.goto(`${CHAT}/rooms/${ROOM}`);
  const blk = A.getByRole("article", { name: "Quy trình UAT P-b2 canvas" }).last();
  await blk.getByRole("list", { name: "Tiến độ quy trình" }).waitFor();
  await blk.scrollIntoViewIfNeeded();
  await shot(A, "05-A-room-strip-x2");
  const txt = await blk.innerText();
  if (r.json.back_rounds !== 1 || r.json.back_events.length !== 1) throw new Error(info);
  if (!/×2/.test(txt)) throw new Error("không thấy ×2 trong block: " + txt.slice(0, 300));
  if (!/Quay lại bước 1/.test(txt)) throw new Error("không thấy vệt 'Quay lại bước 1'");
});

await step("C06", "trang Run: nhóm bước ×lần, Lịch sử quay lại (BackTimeline), tab phiên bản đầu ra", async () => {
  await A.goto(`${CHAT}/runs/${RUN}`);
  await A.getByRole("list", { name: "Lịch sử quay lại" }).waitFor({ timeout: 20000 });
  await shot(A, "06-A-run-page-timeline", true);
  const items = await A.getByRole("list", { name: "Lịch sử quay lại" }).getByRole("listitem").count();
  const g2 = await A.getByRole("group", { name: "Bước 2" }).innerText();
  const tabs = await A.getByRole("tab", { name: /^Bản 1/ }).count();
  const tl = await A.getByRole("list", { name: "Lịch sử quay lại" }).innerText();
  writeFileSync(EVD + "/c06-timeline.txt", tl + "\n---\n" + g2);
  if (items !== 1) throw new Error("số vòng " + items);
  if (!/Thiếu ca hồi quy/.test(tl)) throw new Error("timeline thiếu góp ý: " + tl);
  if (!/×2/.test(g2)) throw new Error("nhóm Bước 2 thiếu ×2: " + g2.slice(0, 200));
  if (tabs < 1) throw new Error("không có tab 'Bản 1'");
  const t2 = A.getByRole("tab", { name: /^Bản 2/ }).first();
  await t2.waitFor({ timeout: 5000 });
  await t2.scrollIntoViewIfNeeded();
  await shot(A, "06-A-output-versions");
});

await step("C07", "quay lại thêm 2 lần (vòng 2, 3); lần 4 => needs_decision back_limit; 'Thêm 1 lần làm lại' chạy tiếp", async () => {
  const cycle = async (n, last) => {
    await waitStages(RUN, (v) => st(v, "Phân tích").status === "waiting_review");
    await pass(B, RUN, "Phân tích");
    await waitStages(RUN, (v) => st(v, "Rà soát code").status === "waiting_review" && st(v, "Test hồi quy").status === "waiting_review");
    await card(B, "Rà soát code").waitFor();
    await B.goto(`${CHAT}/runs/${RUN}`);
    await card(B, "Rà soát code").getByRole("button", { name: "Đạt", exact: true }).click();
    await waitStages(RUN, (v) => st(v, "Rà soát code").status === "done");
    await failBack(C, RUN, "Test hồi quy", "Vòng " + n + ": vẫn thiếu số liệu", last ? "07-C-fail-4th-back" : null);
    if (last) await C.waitForTimeout(1500);
  };
  await cycle(2, false);
  await waitStages(RUN, (v) => v.back_rounds === 2 && st(v, "Phân tích").status === "waiting_review");
  await cycle(3, false);
  await waitStages(RUN, (v) => v.back_rounds === 3 && st(v, "Phân tích").status === "waiting_review");
  await cycle(4, true);
  const v = await waitStages(RUN, (v) => v.status === "needs_decision");
  writeFileSync(EVD + "/c07-back-limit-state.txt", `status=${v.status} back_rounds=${v.back_rounds} back_limit=${v.back_limit} decision=${JSON.stringify(v.decision)}`);
  await A.goto(`${CHAT}/runs/${RUN}`);
  await A.getByText("Đã quay lại tối đa 3 lần mà chưa đạt.").waitFor({ timeout: 20000 });
  for (const t of ["Thêm 1 lần làm lại", "Dùng bản hiện có", "Huỷ lượt chạy"]) await A.getByRole("button", { name: t }).waitFor({ timeout: 5000 });
  await A.getByText("Đã quay lại tối đa 3 lần mà chưa đạt.").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await shot(A, "07-A-back-limit-card");
  await A.getByRole("button", { name: "Thêm 1 lần làm lại" }).click();
  const v2 = await waitStages(RUN, (v) => v.back_limit === 4 && v.status !== "needs_decision");
  writeFileSync(EVD + "/c07-after-add.txt", `status=${v2.status} back_rounds=${v2.back_rounds} back_limit=${v2.back_limit} stages=` + v2.stages.map((s) => `${s.name}:${s.status}:r${s.round}`).join(" | "));
  await A.waitForTimeout(2500);
  await A.goto(`${CHAT}/runs/${RUN}`);
  await A.getByRole("list", { name: "Lịch sử quay lại" }).waitFor();
  await shot(A, "07-A-after-add-attempt", true);
});

await step("C08", "huỷ run khi một stage đã Đạt, stage kia (Claude thật) còn chạy => huỷ được", async () => {
  const id = await startRun(A, "pb2-uat-cancel");
  const v = await waitStages(id, (v) => st(v, "Nhánh nhanh (fake)").status === "waiting_review");
  await B.goto(`${CHAT}/runs/${id}`);
  await card(B, "Nhánh nhanh (fake)").getByRole("button", { name: "Đạt", exact: true }).click();
  const v1 = await waitStages(id, (v) => st(v, "Nhánh nhanh (fake)").status === "done");
  const slow = st(v1, "Nhánh chậm (Claude)").status;
  const jobsRunning = q(`select count(*) from hub.jobs j join hub.process_runs p on p.conversation_id=j.conversation_id where p.id='${id}' and j.status in ('queued','running','dispatched')`);
  writeFileSync(EVD + "/c08-before-cancel.txt", `nhanh nhanh: done; nhanh cham: ${slow}; jobs đang chạy/xếp: ${jobsRunning}`);
  await A.goto(`${CHAT}/runs/${id}`);
  await A.getByRole("button", { name: "Huỷ lượt chạy" }).first().waitFor();
  await shot(A, "08-A-before-cancel");
  if (slow === "done" || slow === "waiting_review") throw new Error("nhánh chậm đã xong trước khi huỷ (" + slow + ") — không đạt điều kiện ca");
  const r = await hub(await tk("thomas.tran"), "GET", "/process-runs/" + id);
  await A.getByRole("button", { name: "Huỷ lượt chạy" }).first().click();
  await A.getByRole("button", { name: "Xác nhận huỷ" }).click();
  const v2 = await waitStages(id, (v) => v.status === "cancelled", 30000);
  await A.waitForTimeout(1500);
  await shot(A, "08-A-after-cancel", true);
  await sleep(2000);
  const jobsAfter = q(`select j.status,count(*) from hub.jobs j join hub.process_runs p on p.conversation_id=j.conversation_id where p.id='${id}' group by 1`);
  writeFileSync(EVD + "/c08-after-cancel.txt", `run=${v2.status}; stages=` + v2.stages.map((s) => `${s.name}:${s.status}`).join(" | ") + `; jobs sau huỷ:\n${jobsAfter}`);
  void r;
});

writeFileSync(EVD + (ONLY ? `/result-chat-${ONLY}.json` : "/result-chat.json"), JSON.stringify(results, null, 1));
await b.close();
console.log(results.filter((r) => !r.ok).length + " FAIL / " + results.length + "; RUN=" + RUN);
