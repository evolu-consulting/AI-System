// UAT CR-095 · phan 2: HĐ moi (nhap tay + DOCX), chi tiet, sua, duyet (nguong, cap, MST mo lai duyet).
import { browser, userPage, snap, step, ok, settle, body, rows, CW, apiTok, hub } from "./lib.mjs";
const DOCX = "F:/workspace/evolu-platform/reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx";
const b = await browser();
const tk = { chu: await apiTok("chu"), soan: await apiTok("soan"), xem: await apiTok("xem") };
const all = async () => (await hub(tk.chu, "GET", "/contracts?page=1&page_size=100")).j.items;
const byNo = async (n) => (await all()).find((x) => x.number === n);
// --- soan: nhap tay qua UI
{ const { p, done } = await userPage(b, "soan");
  await step("HĐ mới: nhập tay (UI)", "soan", async () => {
    await p.goto(CW + "/contracts/new"); await settle(p);
    await p.getByRole("radio", { name: /Bán ra/ }).check().catch(() => {}); await p.getByRole("radio", { name: /Mua vào/ }).check().catch(() => {});
    await p.getByRole("textbox", { name: "Số hợp đồng" }).fill("UAT-001"); await p.getByRole("textbox", { name: "Tên hợp đồng" }).fill("HĐ UAT nhập tay Gamma");
    await p.getByRole("textbox", { name: "Đối tác", exact: true }).fill("Công ty Gamma"); await p.getByRole("textbox", { name: "MST đối tác" }).fill("0311111999");
    await p.getByRole("spinbutton", { name: /Giá trị/ }).fill("30000000").catch(async () => p.getByRole("textbox", { name: /Giá trị/ }).fill("30000000"));
    const e0 = await snap(p, "06-new-manual-filled");
    await p.getByRole("button", { name: "Lưu hợp đồng" }).click(); await p.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 15000 }); await settle(p);
    const t = await body(p); ok(/HĐ UAT nhập tay Gamma/.test(t), "không thấy tên HĐ ở trang chi tiết"); return { evidence: e0 + ", " + await snap(p, "06-new-manual-detail") }; }, p);
  await step("HĐ mới: tải DOCX lên (trích xuất AI)", "soan", async () => {
    await p.goto(CW + "/contracts"); await settle(p);
    const [fc] = await Promise.all([p.waitForEvent("filechooser", { timeout: 8000 }), p.getByRole("button", { name: /Thêm hợp đồng/ }).first().click()]);
    await fc.setFiles(DOCX); await p.waitForTimeout(6000); await settle(p, 1000);
    const t = await body(p); const e = await snap(p, "06-new-docx-upload");
    const m = t.match(/(Đang đọc hợp đồng…|Không đọc được hợp đồng này\.|Đang trích xuất[^\n]*|Tải lên[^\n]*)/);
    const r = await hub(tk.soan, "GET", "/contracts?page=1&page_size=100"); const last = r.j.items.find((x) => /Minh Phát|bao bì/i.test(x.title || "") && ["extracting", "extract_failed", "needs_review"].includes(x.status) && x.number !== "BB-01");
    return { result: "chờ key", evidence: e, note: `upload nhận file; trạng thái hiện ${last ? last.status : "?"}; UI: ${m ? m[1] : t.slice(0, 80).replace(/\n/g, " ")}. Trích xuất AI cần ANTHROPIC_API_KEY` }; }, p);
  await done(); }
// --- chu duyet
const tp = await byNo("TP-03"), sm = await byNo("SM-02"), old = (await all()).find((x) => x.number === "HĐ-3214");
{ const { p, done } = await userPage(b, "soan");
  await step("Duyệt: người gửi (soan) không tự duyệt HĐ của mình", "soan", async () => {
    await p.goto(CW + "/contracts/" + tp.id); await settle(p); const t = await body(p);
    ok(!(await p.getByRole("button", { name: "Xác nhận", exact: true }).count()), "người gửi vẫn thấy nút Xác nhận"); return { evidence: await snap(p, "07-approval-starter-soan"), note: /Đang chờ[^\n]*/.exec(t)?.[0] || "" }; }, p);
  await done(); }
{ const { p, done } = await userPage(b, "chu");
  await step("Duyệt: cấp 1 Xác nhận (240 tr < ngưỡng 500 tr → hiệu lực)", "chu", async () => {
    await p.goto(CW + "/contracts/" + tp.id); await settle(p); const e0 = await snap(p, "07-approval-l1-before");
    await p.getByRole("button", { name: "Xác nhận", exact: true }).click(); await settle(p, 2500);
    const st = (await hub(tk.chu, "GET", "/contracts/" + tp.id)).j; ok(st.status === "active" || st.contract?.status === "active" || JSON.stringify(st).includes('"status":"active"'), "trạng thái không thành active: " + JSON.stringify(st).slice(0, 150)); return { evidence: e0 + ", " + await snap(p, "07-approval-l1-after") }; }, p);
  await step("Duyệt: cấp 2 Duyệt (1,2 tỷ ≥ ngưỡng, Ban giám đốc)", "chu", async () => {
    await p.goto(CW + "/contracts/" + sm.id); await settle(p); const e0 = await snap(p, "07-approval-l2-before");
    await p.getByRole("button", { name: "Duyệt", exact: true }).click(); await settle(p, 2500);
    ok(JSON.stringify((await hub(tk.chu, "GET", "/contracts/" + sm.id)).j).includes('"status":"active"'), "SM-02 chưa active"); return { evidence: e0 + ", " + await snap(p, "07-approval-l2-after") }; }, p);
  await step("Duyệt: người gửi (chu) không duyệt HĐ do chính mình tạo", "chu", async () => {
    await p.goto(CW + "/contracts/" + old.id); await settle(p); const n = await p.getByRole("button", { name: /^(Xác nhận|Duyệt)$/ }).count(); ok(n === 0, "người gửi thấy nút duyệt"); return { evidence: await snap(p, "07-approval-starter-chu") }; }, p);
  // Tu choi
  const rj = (await hub(tk.soan, "POST", "/contracts/manual", { direction: "purchase", number: "UAT-RJ", title: "HĐ UAT sẽ bị từ chối", partner_name: "Công ty Từ Chối", partner_tax_id: "0399999999", total_value: 30000000, items: [] })).j;
  await step("Duyệt: Từ chối kèm lý do", "chu", async () => {
    await p.goto(CW + "/contracts/" + rj.id); await settle(p); await p.getByRole("button", { name: "Từ chối", exact: true }).click(); await p.waitForTimeout(500);
    await p.getByRole("textbox", { name: /Lý do từ chối/ }).fill("Thiếu điều khoản thanh toán"); const e0 = await snap(p, "07-approval-reject-form");
    await p.getByRole("button", { name: /Từ chối|Gửi|Xác nhận/ }).last().click(); await settle(p, 2500);
    const st = JSON.stringify((await hub(tk.chu, "GET", "/contracts/" + rj.id)).j); ok(st.includes('"status":"rejected"'), "chưa rejected: " + st.slice(0, 160)); return { evidence: e0 + ", " + await snap(p, "07-approval-rejected") }; }, p);
  await step("Duyệt: Đọc lại (AI đọc lại HĐ)", "chu", async () => ({ result: "chờ key", note: "nút Đọc lại gọi lại trích xuất AI — cần ANTHROPIC_API_KEY" }), p);
  await done(); }
// --- nguong / cap qua API (khong co UI cai dat duyet)
await step("Duyệt: đổi ngưỡng 100 tr → HĐ 150 tr cần cấp 2", "chu", async () => {
  const cur = (await hub(tk.chu, "GET", "/approval-settings")).j; ok(cur.threshold === 500000000, "ngưỡng mặc định " + cur.threshold);
  const put = await hub(tk.chu, "PUT", "/approval-settings", { threshold: 100000000 }); ok(put.s === 200, "PUT approval-settings " + put.s + JSON.stringify(put.j).slice(0, 100));
  const c = (await hub(tk.soan, "POST", "/contracts/manual", { direction: "purchase", number: "UAT-TH", title: "HĐ UAT ngưỡng 150tr", partner_name: "Công ty Ngưỡng", partner_tax_id: "0388888888", total_value: 150000000, items: [] })).j;
  const l1 = await hub(tk.chu, "POST", `/contracts/${c.id}/approval`, { action: "approve" }); const ap = (await hub(tk.chu, "GET", `/contracts/${c.id}/approval`)).j;
  await hub(tk.chu, "PUT", "/approval-settings", { threshold: 500000000 });
  ok(ap.step === "level2", `sau cấp 1 phải ở level2, thực tế step=${ap.step} run=${ap.run_status} (L1 ${l1.s})`); return { note: "ngưỡng khôi phục 500 tr" }; });
await step("Duyệt: nhóm duyệt cấp 1/2 đổi được (approval-settings)", "chu", async () => {
  const r = await hub(tk.chu, "PUT", "/approval-settings", { level1_group_key: "khong-co-nhom" }); ok(r.s === 422 || r.s === 400, "nhóm không tồn tại phải bị từ chối, nhận " + r.s); return { note: "nhóm sai → " + r.s + " " + (r.j.error?.code || "") }; });
await step("Duyệt: viewer không đổi được cài đặt duyệt", "xem", async () => { const r = await hub(tk.xem, "PUT", "/approval-settings", { threshold: 1 }); ok(r.s === 403, "viewer PUT approval-settings = " + r.s); return { note: "403" }; });
// --- sua MST tren HĐ da hieu luc -> mo lai duyet
{ const bb = await byNo("BB-01"); const { p, done } = await userPage(b, "soan");
  await step("Sửa MST bên bán của HĐ đã hiệu lực → mở lại duyệt", "soan", async () => {
    await p.goto(CW + "/contracts/" + bb.id); await settle(p); const before = (await hub(tk.soan, "GET", "/contracts/" + bb.id)).j; const e0 = await snap(p, "08-edit-tax-before");
    const f = p.getByRole("textbox", { name: "MST bên bán" }); await f.fill("0312345999"); await p.getByRole("button", { name: "Lưu", exact: true }).first().click(); await settle(p, 2500);
    const after = (await hub(tk.soan, "GET", "/contracts/" + bb.id)).j; const ap = (await hub(tk.soan, "GET", `/contracts/${bb.id}/approval`)).j;
    const st = JSON.stringify(after).match(/"status":"([a-z_]+)"/)?.[1];
    ok(st === "needs_review" && ap.step === "level1", `sau sửa MST: status=${st}, approval.step=${ap.step}, run=${ap.run_status}`); return { evidence: e0 + ", " + await snap(p, "08-edit-tax-after"), note: `status ${JSON.stringify(before).match(/"status":"([a-z_]+)"/)?.[1]} → ${st}; duyệt mở lại ${ap.step}` }; }, p);
  await step("Sửa trường thường (người ký) HĐ đã hiệu lực không mở lại duyệt", "soan", async () => {
    const tp2 = await byNo("TP-03"); await p.goto(CW + "/contracts/" + tp2.id); await settle(p);
    await p.getByRole("textbox", { name: "Người ký bên bán" }).fill("Nguyễn Văn Z"); await p.getByRole("button", { name: "Lưu", exact: true }).first().click(); await settle(p, 2000);
    const st = JSON.stringify((await hub(tk.soan, "GET", "/contracts/" + tp2.id)).j).match(/"status":"([a-z_]+)"/)?.[1]; return { evidence: await snap(p, "08-edit-signer"), note: "status sau sửa: " + st, result: ["active", "expiring"].includes(st) ? "OK" : "LỖI" }; }, p);
  await done(); }
await b.close();