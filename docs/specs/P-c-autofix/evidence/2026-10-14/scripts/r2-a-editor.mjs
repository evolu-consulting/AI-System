// Kịch bản 1 — editor StageAutofix (admin-web, julian.bui tenant_admin evolu)
import { launch, adminLogin, mkSnap, mkStep } from "./lib.mjs";
import { login, hub } from "./api.mjs";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14/round2"; 
const { browser, page } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, log, save } = mkStep(OUT, () => ({ A: page }), snap);
const pn = page.getByRole("complementary", { name: "Chi tiết giai đoạn" });
const sw = pn.getByRole("switch", { name: "Tự sửa mã" });
const stageBtn = (n) => ({ click: async () => { const b = page.getByRole("button", { name: new RegExp(`^Giai đoạn \\d+: ${n}`) }).first(); await b.click({ timeout: 4000 }).catch(() => {}); } });
const save_ = async () => { const put = page.waitForResponse((r) => r.request().method() === "PUT" && /process-defs/.test(r.url())); await page.getByRole("button", { name: "Lưu", exact: true }).click(); return (await put); };
const panelShot = (name) => pn.screenshot({ path: `${OUT}/${name}.png` });
const T = async () => login("evolu", "julian.bui");
const defRow = async () => { const t = await T(); const r = await hub(t, "GET", "/process-defs?include_templates=false&limit=100"); const it = r.json.items.find((d) => d.key === "fixbug-apply"); return (await hub(t, "GET", "/process-defs/" + it.id)).json; };

await step("A01", "mở def fixbug-apply (bản chép), khối Tự sửa mã hiện bật + ghi chú mạng", async () => {
  await adminLogin(page, "julian.bui", "evolu");
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quy trình", exact: true }).click();
  await page.getByRole("table", { name: "Quy trình" }).getByRole("row").filter({ hasText: "fixbug-apply" }).getByRole("link", { name: "Sửa lỗi tự áp (diff)" }).click();
  await stageBtn("Tự sửa mã").click();
  if (!(await sw.isChecked())) throw new Error("switch không bật");
  await pn.getByText("Container chạy agent và test không có mạng.", { exact: false }).waitFor();
  await snap(page, "01-A-editor-template-copy");
  await panelShot("01b-A-editor-autofix-block");
});
await step("A02", "tắt rồi bật lại giữ giá trị đã nhập (FC8); tắt ⇒ lưu autofix=null", async () => {
  await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("bun test --bail");
  await sw.click();
  if (await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).count()) throw new Error("ô còn hiện khi tắt");
  await snap(page, "02-A-editor-off");
  await sw.click();
  const v = await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).inputValue();
  if (v !== "bun test --bail") throw new Error("mất giá trị: " + v);
});
await step("A03", "nhập đủ (install, allowlist 2 dòng, test) ⇒ badge Hợp lệ ⇒ Lưu 200 ⇒ tải lại đúng giá trị", async () => {
  await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("bun test");
  await pn.getByRole("textbox", { name: "Lệnh cài phụ thuộc" }).fill("bun install --frozen-lockfile");
  await pn.getByRole("textbox", { name: "Đường dẫn được sửa" }).fill("src/**\ntest/**");
  await pn.getByText("Hợp lệ").waitFor();
  await panelShot("03-A-editor-valid");
  const r = await save_();
  if (r.status() !== 200) throw new Error("PUT " + r.status());
  const d = await defRow();
  const af = d.stages[0].autofix;
  if (JSON.stringify(af, Object.keys(af).sort()) !== JSON.stringify({ install_cmd: "bun install --frozen-lockfile", source_key: "repo", test_cmd: "bun test", write_allowlist: ["src/**", "test/**"] })) throw new Error("DB: " + JSON.stringify(af));
  await page.reload(); await stageBtn("Tự sửa mã").click();
  if ((await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).inputValue()) !== "bun test") throw new Error("không giữ sau reload");
  await snap(page, "03b-A-editor-reloaded");
});
await step("A04", "xoá lệnh test ⇒ alert 'Nhập lệnh kiểm thử…'; allowlist > 20 mẫu ⇒ alert err.allow", async () => {
  await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("");
  await page.getByRole("alert").filter({ hasText: "Nhập lệnh kiểm thử (tối đa 1000 ký tự)." }).waitFor();
  await panelShot("04-A-editor-test-empty");
  await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("bun test");
  await pn.getByRole("textbox", { name: "Đường dẫn được sửa" }).fill(Array.from({ length: 21 }, (_, i) => `d${i}/**`).join("\n"));
  await page.getByRole("alert").filter({ hasText: "Tối đa 20 mẫu" }).waitFor();
  await panelShot("04b-A-editor-allow-21");
  await pn.getByRole("textbox", { name: "Đường dẫn được sửa" }).fill("src/**\ntest/**");
});
await step("A05", "AUTOFIX_EXECUTOR: đổi 'Làm bởi' sang Nhóm ⇒ alert 'phải do agent'", async () => {
  await pn.getByRole("combobox", { name: "Làm bởi" }).click();
  await page.getByRole("option", { name: "Nhóm hiện thực" }).click();
  await page.getByRole("alert").filter({ hasText: "Stage tự sửa mã phải do agent thực hiện." }).first().waitFor();
  await panelShot("05-A-editor-executor-err");
  await pn.getByRole("combobox", { name: "Làm bởi" }).click();
  await page.getByRole("option", { name: "Tự sửa lỗi", exact: true }).click();
});
await step("A06", "AUTOFIX_REVIEW: 'Sau giai đoạn' = Tự chạy tiếp ⇒ alert 'luôn phải qua người duyệt'", async () => {
  await pn.getByRole("combobox", { name: "Sau giai đoạn" }).click();
  await page.getByRole("option", { name: "Tự chạy tiếp" }).click();
  await page.getByRole("alert").filter({ hasText: "luôn phải qua người duyệt" }).first().waitFor();
  await panelShot("06-A-editor-review-err");
  await pn.getByRole("combobox", { name: "Sau giai đoạn" }).click();
  await page.getByRole("option", { name: "Duyệt bởi Group" }).click();
});
await step("A07", "AUTOFIX_MAX: thêm giai đoạn 2 bật Tự sửa mã ⇒ alert 'chỉ có một stage tự sửa mã'", async () => {
  await page.getByRole("button", { name: "Thêm giai đoạn" }).first().click();
  const second = page.getByRole("button", { name: /^Giai đoạn 2:/ });
  await second.click();
  await sw.click();
  await pn.getByRole("combobox", { name: "Nguồn" }).click();
  await page.getByRole("option", { name: /repo/ }).first().click();
  await pn.getByRole("textbox", { name: "Lệnh kiểm thử" }).fill("bun test");
  await page.getByRole("alert").filter({ hasText: "Mỗi quy trình chỉ có một stage tự sửa mã" }).first().waitFor();
  await panelShot("07-A-editor-max-err");
  await snap(page, "07b-A-editor-max-page");
});
await step("A08", "Lưu def lỗi (2 stage autofix) ⇒ server/Client chặn, không có 200", async () => {
  const resp = page.waitForResponse((r) => r.request().method() === "PUT" && /process-defs/.test(r.url()), { timeout: 4000 }).then((r) => r.status(), () => "no-request");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  const s = await resp;
  console.log("  PUT status:", s);
  await snap(page, "08-A-save-invalid");
  if (s === 200) throw new Error("lưu được def sai luật!");
  log.push({ id: "A08-info", title: "PUT status khi lưu def sai", ok: true, note: String(s) });
});
await step("A09", "hoàn tác (Huỷ) ⇒ def gốc 1 stage", async () => {
  await page.getByRole("button", { name: "Huỷ" }).click().catch(() => {});
  await page.reload();
  const d = await defRow();
  if (d.stages.length !== 1) throw new Error("def đã đổi: " + d.stages.length);
});
save("result-r2-editor"); await browser.close();
