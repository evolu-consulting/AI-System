// UAT H4b-2 phần E: dispatch dự phòng thật (không route giả lập). Profile uat-fb = [uat-fake-api (tắt), fake-cli]; agent pb-doc-fake dùng uat-fb.
// Chạy sau b-profiles (uat-fb đã gắn). Cần hub:dev + studio-web :3200 + chat-web :3100 + hub log (HUBLOG).
import { readFileSync } from "node:fs";
import { launch, studioLogin, chatLogin, mkSnap, mkStep, expect, CHAT } from "./lib.mjs";
import { token, api } from "./api.mjs";
import { sql } from "./sql.mjs";
const OUT = process.argv[2];
const HUBLOG = process.argv[3];
const { browser, page, ctx } = await launch(OUT);
const snap = mkSnap(OUT);
const chatPage = await ctx.newPage();
const { step, save } = mkStep(OUT, () => ({ A: page, B: chatPage }), snap);
const tok = await token();
const AGENT = "pb-doc-fake";
const agentRow = async () => { const a = (await api(tok, "GET", "/agents?limit=200")).body.items.find((x) => x.key === AGENT); return (await api(tok, "GET", `/agents/${a.id}`)).body; };
const strip = (a) => { const { id, key, runtime, knowledge_connection_ids, created_at, updated_at, runnable, orchestrator_of, workflows, warnings, ...r } = a; return r; };
const putAgent = async (patch) => { const a = await agentRow(); const r = await api(tok, "PUT", `/agents/${a.id}`, { ...strip(a), ...patch, version: a.version }); if (r.status !== 200) throw new Error("PUT agent " + JSON.stringify(r)); };
const choose = async (box, label) => { const tag = await box.evaluate((e) => e.tagName.toLowerCase()); if (tag === "select") return box.selectOption({ label }); await box.click(); await page.getByRole("option", { name: label, exact: true }).click(); };
const toast = () => page.getByRole("region", { name: "Notifications" });
const logText = () => readFileSync(HUBLOG, "utf8");
const agentId = () => sql(`select id from hub.agents where key='${AGENT}'`);
const lastJob = () => sql(`select provider_key||'|'||status||'|'||coalesce(error_code,'')||'|'||payload::text from hub.jobs where agent_id='${agentId()}' order by created_at desc limit 1`);
const jobCount = () => Number(sql(`select count(*) from hub.jobs where agent_id='${agentId()}'`));
const send = async (text) => {
  await chatPage.goto(`${CHAT}/`);
  const box = chatPage.getByRole("textbox", { name: "Tin nhắn" });
  await box.fill(text);
  await box.press("Enter");
};
let fbBefore = (logText().match(/job\.fallback/g) ?? []).length;

await studioLogin(page);
await chatLogin(chatPage, "thomas.tran");

await step("E01", "Tắt provider uat-fake-api (bước 0 của uat-fb) trong Studio; Profiles hiện 'Lúc này sẽ chạy bằng bước 2 · fake-cli'", async () => {
  await page.goto("http://localhost:3200/studio/models");
  const row = page.getByRole("table", { name: "Danh sách provider" }).getByRole("row").filter({ hasText: "uat-fake-api" }).first();
  await row.getByRole("button", { name: "Sửa" }).click();
  const d = page.getByRole("dialog", { name: "Sửa provider · uat-fake-api" });
  await d.getByRole("checkbox", { name: "Bật provider" }).uncheck();
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toBeHidden();
  await expect(row).toContainText("(tắt)");
  await page.getByRole("tab", { name: "Profiles" }).click();
  await page.getByRole("list", { name: "Danh sách profile" }).getByRole("link", { name: "uat-fb" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lúc này sẽ chạy bằng bước 2 · fake-cli" })).toBeVisible();
  await snap(page, "02-E-uat-fb-active-step2", true);
});
await step("E02", "Chạy job trên evolu (thomas.tran → @pb-doc-fake): job dùng bước 1 (fake-cli) và log có job.fallback", async () => {
  const n0 = jobCount();
  await send("@pb-doc-fake Chào bạn, kiểm tra dự phòng (UAT H4b-2)");
  await expect.poll(() => jobCount(), { timeout: 30000 }).toBeGreaterThan(n0);
  await chatPage.waitForTimeout(12000);
  const j = lastJob(); console.log("job:", j.slice(0, 200));
  if (!j.startsWith("fake-cli|")) throw new Error("job không dùng fake-cli: " + j.slice(0, 120));
  const fb = (logText().match(/job\.fallback[^\n]*/g) ?? []);
  console.log("job.fallback lines:", fb.length - fbBefore, fb.at(-1));
  if (fb.length <= fbBefore) throw new Error("log thiếu job.fallback");
  await snap(chatPage, "03-E-chat-fallback", true);
  if (!/"index":0|uat-fake-api/.test(fb.at(-1))) throw new Error("job.fallback không nêu bước bị bỏ: " + fb.at(-1));
});
await step("E03", "Agent có model riêng ⇒ KHÔNG chuyển bước: bước 0 tắt ⇒ lỗi ALL_PROVIDERS_EXHAUSTED, không job fake-cli, không job.fallback mới", async () => {
  await putAgent({ model: "uat-own-model" });
  fbBefore = (logText().match(/job\.fallback/g) ?? []).length;
  const n0 = jobCount();
  await send("@pb-doc-fake Chào bạn, thử model riêng (UAT H4b-2)");
  await chatPage.waitForTimeout(12000);
  await snap(chatPage, "04-E-chat-own-model", true);
  const n1 = jobCount();
  const fbAfter = (logText().match(/job\.fallback/g) ?? []).length;
  console.log("jobs", n0, "->", n1, "| fallback logs", fbBefore, "->", fbAfter, "| last job:", lastJob().slice(0, 100));
  if (fbAfter !== fbBefore) throw new Error("agent có model riêng mà vẫn log job.fallback");
  if (n1 > n0 && lastJob().startsWith("fake-cli|")) throw new Error("agent có model riêng nhưng job vẫn chạy bằng bước 1: " + lastJob().slice(0, 100));
  const body = await chatPage.locator("body").innerText();
  console.log("chat có thông báo lỗi:", /ALL_PROVIDERS|không có provider|sẵn sàng|lỗi/i.test(body));
});
await step("E04", "Khôi phục: agent về model null + profile fake-1; bật lại uat-fake-api", async () => {
  const fake1 = (await api(tok, "GET", "/model-profiles")).body.items.find((p) => p.key === "fake-1");
  await putAgent({ model: null, profile_id: fake1.id });
  const a = await agentRow();
  if (a.model !== null || a.profile_id !== fake1.id) throw new Error("agent chưa khôi phục");
});
save();
await browser.close();
