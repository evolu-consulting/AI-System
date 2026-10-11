// usage: node chat.mjs <processKey> <prefix> [text]
import { launch, ctx, step, shot, CHAT, OUT, save } from "./h.mjs";
import { expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import { spawnSync } from "node:child_process";
const [key, pre, extra = ""] = process.argv.slice(2);
const q = (s) => spawnSync("docker", ["exec", "ai-system-postgres-1", "psql", "-U", "ai", "-d", "ai_system", "-tA", "-F|", "-c", s]).stdout.toString().trim();
const b = await launch(); const c = await ctx(b, CHAT); const p = await c.newPage();
const reqs = []; p.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/process-runs")) reqs.push(r.postData()); });
await step(pre + "-login", "Đăng nhập chat-web evolu/thomas.tran, mở phòng Evolu team", p, async () => {
  await p.goto("/login");
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill("thomas.tran");
  await p.getByLabel("Mật khẩu").fill("1234567890");
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL(/\/c\/new$/);
  await p.goto("/rooms/d2a00000-0000-4000-8000-000000000002");
  await p.getByRole("textbox", { name: /Tin nhắn cho/ }).waitFor();
});
const before = q("select count(*) from hub.process_runs");
await step(pre + "-pick", `Chọn quy trình !${key} từ nút Quy trình`, p, async () => {
  await p.getByRole("button", { name: "Quy trình", exact: true }).click();
  await shot(p, `${pre}-01-A-process-list`);
  await p.getByRole("listbox", { name: "Quy trình" }).getByRole("option").filter({ hasText: `!${key}` }).click();
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
});
await step(pre + "-form", "Form thông tin (inputs) hiện; điền và Bắt đầu", p, async () => {
  const f = p.getByRole("dialog", { name: /Thông tin cho quy trình/ });
  if (await f.count()) {
    await expect(f).toBeVisible();
    const cb = f.getByRole("combobox");
    if (await cb.count()) { await cb.first().selectOption("ai-system-repo"); }
    const txt = f.getByRole("textbox");
    const n = await txt.count();
    for (let i = 0; i < n; i++) { const nm = await txt.nth(i).getAttribute("aria-label"); if (!/Nhánh/.test(nm ?? "")) await txt.nth(i).fill(extra || "UAT P-b"); }
    await shot(p, `${pre}-02-A-inputs-form`);
    await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  } else await shot(p, `${pre}-02-A-no-form`);
});
await step(pre + "-run", "Run được tạo và chạy tới trạng thái cuối", p, async () => {
  let row = "";
  for (let i = 0; i < 90; i++) {
    row = q(`select id,status from hub.process_runs order by started_at desc limit 1`);
    if (q("select count(*) from hub.process_runs") !== before && /\|(completed|done|succeeded|failed|needs_decision|cancelled|awaiting_review|awaiting_decision)/.test(row)) break;
    await p.waitForTimeout(3000);
  }
  console.log("RUN", row);
  await shot(p, `${pre}-03-A-run-state`);
  if (!/\|(completed|done|succeeded)/.test(row) && !/awaiting_review/.test(row)) throw new Error("run cuối: " + row);
});
console.log("REQ", JSON.stringify(reqs));
await p.waitForTimeout(1500); await shot(p, `${pre}-04-A-final`);
await b.close(); save();
