// UAT CR-054 — Hỏi AI (thomas.tran): tin không tag → agent mặc định; tin @invoices. Tối đa 2 tin thật (giới hạn 3).
import { chromium, expect, CHAT, PW, makeRunner, login } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const OUT = process.argv[2];
const R = makeRunner(OUT, "chat");
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, locale: "vi-VN" })).newPage();
R.pages.push(p);
const notes = { sent: 0 };
const box = () => p.getByRole("textbox", { name: "Tin nhắn", exact: true });
const bodies = [];
p.on("response", async (r) => { if (r.request().method() === "POST" && /\/(runs|messages|chat)/.test(r.url())) bodies.push(`${r.status()} ${r.url().slice(0, 100)}`); });

async function ask(text) {
  await box().fill(text);
  await box().press("Enter");
  notes.sent++;
  // chờ xong: nút "Dừng" biến mất và có trạng thái hoàn tất (Xem các bước / ✓ n bước)
  await expect(p.getByText(/✓ \d+ bước/).last()).toBeVisible({ timeout: 180000 });
}
const stepsText = async () => {
  await p.getByText(/✓ \d+ bước/).last().click();
  const ul = p.getByRole("list", { name: "Các bước" }).last();
  await expect(ul).toBeVisible();
  return (await ul.innerText()).replace(/\n+/g, " | ");
};

await R.step("13", "thomas.tran đăng nhập Hỏi AI", async () => {
  await login(p, CHAT, "evolu", "thomas.tran", PW, /\/c\//);
  await expect(box()).toBeVisible({ timeout: 20000 });
  await R.snap(p, "13-D-chat-new");
});

await R.step("14", "Tin không tag → agent thật trả lời; 'Quá trình' có tên agent + model, còn sau khi xong và sau reload", async () => {
  await ask("Công ty mình có quy định nghỉ phép thế nào?");
  await R.snap(p, "14-D-untagged-answer");
  notes.untaggedSteps = await stepsText();
  await R.snap(p, "14-D-untagged-steps-open");
  expect(notes.untaggedSteps).toMatch(/·/);
  notes.untaggedUrl = p.url();
  notes.untaggedMain = (await p.locator("main").innerText()).slice(0, 1500);
  await p.reload();
  await expect(p.getByText(/✓ \d+ bước/).last()).toBeVisible({ timeout: 30000 });
  notes.untaggedStepsAfterReload = await stepsText();
  await R.snap(p, "14-D-untagged-after-reload");
  expect(notes.untaggedStepsAfterReload).toMatch(/·/);
});

await R.step("15", "Tin @invoices: hiện tên agent Invoices", async () => {
  await p.goto(`${CHAT}/c/new`);
  await expect(box()).toBeVisible({ timeout: 20000 });
  await ask("@invoices Bạn kiểm tra được hoá đơn nào? Trả lời một câu ngắn.");
  await R.snap(p, "15-D-invoices-answer");
  notes.invoicesSteps = await stepsText();
  await R.snap(p, "15-D-invoices-steps-open");
  expect(notes.invoicesSteps).toMatch(/Invoices/);
  notes.invoicesMain = (await p.locator("main").innerText()).slice(0, 1500);
});

R.finish();
writeFileSync(`${OUT}/notes-chat.json`, JSON.stringify({ ...notes, bodies }, null, 2));
await b.close();
console.log(`DONE ${R.log.filter((x) => x.ok).length}/${R.log.length} sent=${notes.sent}`);
