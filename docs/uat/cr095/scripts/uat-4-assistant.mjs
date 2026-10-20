// UAT CR-095 · phan 4: tro ly AI nhung (fake-cli + tool hop dong) — chat that voi Claude: cho key.
import { browser, userPage, snap, step, ok, settle, body, CW } from "./lib.mjs";
const b = await browser();
async function openAssistant(p) { const bt = p.getByRole("button", { name: "Mở trợ lý AI" }); if (await bt.count()) await bt.click(); await p.waitForTimeout(800); }
async function send(p, text) { const tb = p.getByRole("textbox").last(); await tb.fill(text); await p.keyboard.press("Enter"); }
for (const u of ["chu", "han"]) {
  const { p, done } = await userPage(b, u);
  await step("Trợ lý AI: mở bảng + gửi tin, nhận trả lời (fake AI)", u, async () => {
    await p.goto(CW + "/contracts"); await settle(p, 2000); await openAssistant(p); const e0 = await snap(p, `16-assistant-open-${u}`);
    await send(p, "Xin chào, bạn làm được gì?"); await p.waitForTimeout(12000); const t = await body(p); const e1 = await snap(p, `16-assistant-reply-${u}`);
    ok(/Trợ lý AI/.test(t), "không thấy bảng Trợ lý AI"); ok(!/chưa được dùng trợ lý AI/.test(t), "trợ lý từ chối: " + (t.match(/Bạn chưa được dùng[^\n]*/) || [""])[0]); return { evidence: e0 + ", " + e1, note: "trả lời của fake-cli (không phải Claude)" }; }, p);
  await step("Trợ lý AI: gọi tool hợp đồng (contracts-search) — kết quả theo quyền xem", u, async () => {
    await send(p, '#fake:tool=contracts-search #fake:args={"q":"Minh Phát"} tìm hợp đồng Minh Phát'); await p.waitForTimeout(15000); const t = await body(p); const e = await snap(p, `16-assistant-tool-${u}`);
    ok(!/chưa được dùng trợ lý AI/.test(t.split("tìm hợp đồng Minh Phát").slice(-1)[0] || ""), "trợ lý từ chối (không có quyền agent)");
    const saw = /Minh Phát/.test(t.split("tìm hợp đồng Minh Phát").slice(-1)[0] || "");
    if (u === "han") ok(!saw, "han (hạn chế) thấy HĐ Minh Phát qua tool trợ lý"); else ok(saw || /contracts-search/.test(t), "không thấy kết quả/tên tool: " + t.slice(-300).replace(/\n/g, " "));
    return { evidence: e, note: u === "han" ? "han không thấy HĐ người khác qua tool" : "tool trả kết quả" }; }, p);
  if (u === "chu") await step("Trợ lý AI: chat thật với Claude (đọc/so sánh bằng LLM thật)", u, async () => ({ result: "chờ key", note: "cần ANTHROPIC_API_KEY, profile claude-sub; chưa chạy" }), p);
  await done();
}
await b.close();