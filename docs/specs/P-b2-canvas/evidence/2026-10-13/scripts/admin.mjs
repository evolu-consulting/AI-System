// UAT P-b2 · kịch bản 1 — admin-web canvas (julian.bui, tenant_admin evolu). Node + Playwright.
import { chromium, viCtx, EVD, adminLogin, openDef, runner, results } from "./pw.mjs";
import { writeFileSync } from "node:fs";
import { login, hub } from "./lib.mjs";

const b = await chromium.launch();
const c = await viCtx(b, { width: 1440, height: 1000 });
const p = await c.newPage();
const step = runner("admin", () => ({ A: p }));
const canvas = () => p.getByRole("application", { name: "Canvas quy trình" });
const panel = () => p.getByRole("complementary", { name: "Chi tiết giai đoạn" });
const node = (n) => p.getByRole("button", { name: new RegExp(`^Giai đoạn \\d+: ${n}`) });
const spin = () => panel().getByRole("spinbutton", { name: "Chạy ở bước" });
const snap = async (name) => {
  await p.getByRole("tablist", { name: "Chế độ xem" }).evaluate((e) => e.scrollIntoView({ block: "start" }));
  await p.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight + 50) el.scrollTop -= 90; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${EVD}/${name}.png`, fullPage: true });
};
const defStages = async () => {
  const t = await login("evolu", "julian.bui");
  const l = await hub(t, "GET", "/process-defs?include_templates=false&limit=100");
  const d = l.json.items.find((x) => x.key === "pb2-uat-edit");
  return (await hub(t, "GET", "/process-defs/" + d.id)).json;
};
await adminLogin(p, "julian.bui");

await step("A01", "mở editor: canvas, 4 nút Giai đoạn, panel chọn sẵn giai đoạn 1", async () => {
  await openDef(p, "pb2-uat-edit", "UAT P-b2 canvas");
  await canvas().waitFor({ timeout: 15000 });
  const n = await canvas().getByRole("button", { name: /^Giai đoạn [1-4]: / }).count();
  if (n !== 4) throw new Error("số nút stage " + n);
  await panel().getByRole("region", { name: "Giai đoạn 1: Phân tích" }).waitFor();
  await snap("01-A-canvas-initial");
});

await step("A02", "tab Danh sách ⇄ Canvas", async () => {
  const tabs = p.getByRole("tablist", { name: "Chế độ xem" });
  await tabs.getByRole("tab", { name: "Danh sách" }).click();
  await p.getByRole("button", { name: /^Giai đoạn 3: Test hồi quy/ }).waitFor();
  await snap("02-A-list-mode");
  await tabs.getByRole("tab", { name: "Canvas" }).click();
  await canvas().waitFor();
});

await step("A03", "kéo 'Test hồi quy' (chuột) sang cột bước 2 => bước đổi thành 2", async () => {
  const src = node("Test hồi quy");
  const dst = node("Rà soát code");
  await src.scrollIntoViewIfNeeded();
  const a = await src.boundingBox();
  const d = await dst.boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(d.x + d.width / 2, d.y + d.height + 40, { steps: 14 });
  await snap("03-A-dragging");
  await p.mouse.up();
  await p.waitForTimeout(500);
  await node("Test hồi quy").click();
  const v = await spin().inputValue();
  await snap("03-A-after-drag");
  if (v !== "2") throw new Error("Chạy ở bước = " + v + " (mong 2)");
});

await step("A04", "Alt+← trên 'Tổng hợp' => vào bước 2 (đủ 3 giai đoạn song song); status live", async () => {
  const n = node("Tổng hợp");
  await n.click();
  await n.focus();
  await p.keyboard.press("Alt+ArrowLeft");
  await p.getByRole("status").filter({ hasText: /chuyển sang bước 2$/ }).waitFor({ timeout: 5000 });
  if ((await spin().inputValue()) !== "2") throw new Error("spin != 2");
  await snap("04-A-three-parallel");
});

await step("A05", "bước 2 đầy: Alt+→ trên 'Phân tích' => alert 'Bước 2 đã đủ 3…'; bước không đổi; nút '+ vào bước 2' aria-disabled", async () => {
  const n = node("Phân tích");
  await n.click();
  await n.focus();
  await p.keyboard.press("Alt+ArrowRight");
  await p.getByRole("alert").filter({ hasText: "Bước 2 đã đủ 3 giai đoạn song song." }).waitFor({ timeout: 5000 });
  if ((await spin().inputValue()) !== "1") throw new Error("bước đổi dù đầy");
  const dis = await p.getByRole("button", { name: "Thêm giai đoạn vào bước 2" }).getAttribute("aria-disabled");
  if (dis !== "true") throw new Error("aria-disabled=" + dis);
  await snap("05-A-step-full-error");
});

await step("A06", "Alt+→ trên 'Tổng hợp' trả về bước 3; Alt+↑ đổi thứ tự trong cột; focus ở lại", async () => {
  const n = node("Tổng hợp");
  await n.click();
  await n.focus();
  await p.keyboard.press("Alt+ArrowRight");
  await p.getByRole("status").filter({ hasText: /chuyển sang bước 3$/ }).waitFor({ timeout: 5000 });
  if (!(await node("Tổng hợp").evaluate((e) => e === document.activeElement))) throw new Error("focus mất");
  const t = node("Test hồi quy");
  await t.click();
  await t.focus();
  await p.keyboard.press("Alt+ArrowUp");
  await p.waitForTimeout(300);
  const name = await canvas().getByRole("button", { name: /^Giai đoạn 2: / }).innerText();
  await snap("06-A-steps-1-2x2-3");
  if (!/Test hồi quy/.test(name)) throw new Error("Alt+↑ không đổi thứ tự: Giai đoạn 2 = " + name.split("\n")[0]);
});

await step("A07", "'Nếu bị trượt': Rà soát + Test => bước 1; Tổng hợp => bước 1 và 2; bước đầu có câu 'Bước đầu không có…'", async () => {
  await node("Phân tích").click();
  const g0 = panel().getByRole("group", { name: "Nếu bị trượt" });
  await g0.getByText("Bước đầu không có bước nào phía trước.").waitFor();
  for (const nm of ["Rà soát code", "Test hồi quy"]) {
    await node(nm).click();
    await panel().getByRole("group", { name: "Nếu bị trượt" }).getByRole("checkbox", { name: "Quay lại bước 1" }).check();
  }
  await node("Tổng hợp").click();
  const g = panel().getByRole("group", { name: "Nếu bị trượt" });
  await g.getByRole("checkbox", { name: "Quay lại bước 1" }).check();
  await g.getByRole("checkbox", { name: "Quay lại bước 2" }).check();
  const desc = await g.getByRole("checkbox", { name: "Quay lại bước 2" }).getAttribute("aria-describedby");
  if (!desc) throw new Error("thiếu aria-describedby");
  await snap("07-A-back-edges");
  await panel().scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${EVD}/07-A-panel-back.png` });
});

await step("A08", "Lưu => 200; tải lại còn nguyên (step, back_to_steps); Hub tự thêm mục Bàn giao (R10)", async () => {
  const put = p.waitForResponse((r) => r.request().method() === "PUT" && /process-defs/.test(r.url()));
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  const st = (await put).status();
  if (st !== 200) throw new Error("PUT " + st);
  await p.waitForTimeout(800);
  await p.reload();
  await canvas().waitFor({ timeout: 15000 });
  const d = await defStages();
  const info = d.stages.map((s) => ({ k: s.key, step: s.step, back: s.after.back_to_steps, req: s.output.required_sections }));
  writeFileSync(EVD + "/api-def-after-save.json", JSON.stringify(info, null, 1));
  const steps = info.map((i) => i.step).join(",");
  if (steps !== "0,1,1,2") throw new Error("steps=" + steps);
  if (JSON.stringify(info[3].back) !== "[0,1]") throw new Error("back Tổng hợp " + JSON.stringify(info[3].back));
  if (!info[3].req.includes("Bàn giao")) throw new Error("Tổng hợp thiếu Bàn giao: " + info[3].req);
  await node("Tổng hợp").click();
  const chk = await panel().getByRole("group", { name: "Nếu bị trượt" }).getByRole("checkbox", { name: "Quay lại bước 2" }).isChecked();
  if (!chk) throw new Error("checkbox không còn sau tải lại");
  await snap("08-A-reloaded");
});

await step("A09", "422 theo stage: ép PUT body 4 stage cùng bước 0 (route chặn, MÔ PHỎNG; Hub trả 422 thật) => UI báo lỗi theo stage", async () => {
  const re = /process-defs\/[0-9a-f-]+$/;
  let r422 = null;
  await p.route(re, async (route) => {
    const rq = route.request();
    if (rq.method() !== "PUT") return route.continue();
    const body = JSON.parse(rq.postData());
    body.stages.forEach((s) => { s.step = 0; });
    const resp = await route.fetch({ postData: JSON.stringify(body) });
    r422 = { status: resp.status(), text: await resp.text() };
    await route.fulfill({ response: resp });
  });
  await node("Tổng hợp").click();
  const nm = p.getByRole("textbox", { name: "Tên giai đoạn" });
  await nm.fill("Tổng hợp ");
  await nm.fill("Tổng hợp");
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  await p.waitForTimeout(1200);
  await snap("09-A-422-per-stage");
  await p.unroute(re);
  const lines = [JSON.stringify(r422)];
  const flagged = [];
  for (const n of ["Phân tích", "Rà soát code", "Test hồi quy", "Tổng hợp"]) {
    const btn = node(n);
    const txt = await btn.innerText();
    await btn.click();
    await p.waitForTimeout(250);
    const pt = await panel().innerText();
    const msg = pt.split(String.fromCharCode(10)).filter((l) => /không hợp lệ|chưa hợp lệ|đủ 3|không|Bước \d+ /.test(l) && l.length < 160 && !/Rà nguồn|Bước đầu không/.test(l));
    lines.push(`${n}: node="${txt.split(String.fromCharCode(10)).join(" / ")}" | thông báo trong panel: ${JSON.stringify(msg)}`);
    if (/Có lỗi/.test(txt)) flagged.push(n);
  }
  writeFileSync(EVD + "/a09-422-detail.txt", lines.join(String.fromCharCode(10)));
  if (!r422 || r422.status !== 422) throw new Error("PUT status " + r422?.status + " (mong 422)");
  if (flagged.length === 0) throw new Error("không stage nào có dấu 'Có lỗi'");
  if (!lines.slice(1).some((l) => /đủ 3 giai đoạn song song|chưa hợp lệ/.test(l))) throw new Error("panel không có dòng thông báo lỗi nào (stage lỗi: " + flagged.join(", ") + ")");
});

await step("A10", "chế độ chỉ xem: mẫu sdlc — thông báo, không nút Thêm, Alt+→ vô tác dụng", async () => {
  await p.goto("http://localhost:3000/processes");
  await p.waitForLoadState("networkidle");
  await p.getByRole("tab", { name: "Mẫu" }).click();
  await p.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "!sdlc" }).getByRole("link").first().click();
  await p.getByText("Đây là quy trình mẫu, chỉ xem. Chép mẫu để chỉnh sửa.").waitFor();
  await canvas().waitFor();
  if ((await p.getByRole("button", { name: "Thêm giai đoạn", exact: true }).count()) !== 0) throw new Error("còn nút Thêm giai đoạn");
  const f = canvas().getByRole("button", { name: /^Giai đoạn 1: / });
  await f.click();
  const v = await spin().inputValue();
  await f.focus();
  await p.keyboard.press("Alt+ArrowRight");
  if ((await spin().inputValue()) !== v) throw new Error("đổi bước ở chế độ chỉ xem");
  await snap("10-A-readonly-template");
});

await step("A11", "mobile 390 px: mặc định Danh sách; panel Sheet", async () => {
  const c2 = await viCtx(b, { width: 390, height: 844 });
  const q = await c2.newPage();
  await adminLogin(q, "julian.bui");
  await q.goto("http://localhost:3000/processes");
  await q.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "pb2-uat-edit" }).getByRole("link", { name: "UAT P-b2 canvas" }).click();
  await q.waitForTimeout(1500);
  const sel = await q.getByRole("tablist", { name: "Chế độ xem" }).getByRole("tab", { name: "Danh sách" }).getAttribute("aria-selected");
  await q.getByRole("button", { name: /^Giai đoạn 2: / }).scrollIntoViewIfNeeded();
  await q.screenshot({ path: `${EVD}/11-A-mobile-list.png` });
  await q.getByRole("button", { name: /^Giai đoạn 2: / }).click();
  await q.waitForTimeout(800);
  await q.screenshot({ path: `${EVD}/11-A-mobile-sheet.png` });
  await c2.close();
  if (sel !== "true") throw new Error("không mặc định Danh sách");
});

writeFileSync(EVD + "/result-admin.json", JSON.stringify(results, null, 1));
await b.close();
console.log(results.filter((r) => !r.ok).length + " FAIL / " + results.length);
