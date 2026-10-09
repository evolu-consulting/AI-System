// UAT CR-054 — Agent Forge: danh mục model thật từ CLI + chặn tắt agent mặc định.
import { chromium, expect, STUDIO, platformCreds, makeRunner, login } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const OUT = process.argv[2];
const R = makeRunner(OUT, "studio");
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: "vi-VN" })).newPage();
R.pages.push(p);
const notes = {};
const pc = platformCreds();
const apiCalls = [];
let apiBody = null;
p.on("response", async (r) => { if (!r.url().includes("/studio/api/models")) return; apiCalls.push(r.status()); if (r.status() === 200 && !apiBody) apiBody = await r.json().catch(() => null); });

await R.step("10", "Đăng nhập Agent Forge (platform_admin), mở danh sách agent", async () => {
  await login(p, STUDIO, "platform", pc.user, pc.pass, (u) => !u.pathname.endsWith("/login"));
  await p.goto(`${STUDIO}/agents`);
  await expect(p.getByRole("switch", { name: /consultant/i })).toBeVisible({ timeout: 20000 });
  await R.snap(p, "10-C-studio-agents");
});

await R.step("11", "Trang sửa consultant: danh mục model là dữ liệu thật từ CLI", async () => {
  await p.getByRole("link", { name: /Evolu Consultant/ }).first().click();
  await expect(p.getByRole("group", { name: "Model", exact: true })).toBeVisible({ timeout: 20000 });
  await p.getByRole("group", { name: "Model", exact: true }).scrollIntoViewIfNeeded();
  await R.snap(p, "11-C-model-picker");
  const grp = p.getByRole("group", { name: "Model", exact: true });
  notes.pickerText = (await grp.innerText()).replace(/\n+/g, " | ");
  for (const w of ["Default", "Opus", "Sonnet", "Haiku", "Fable"]) expect(notes.pickerText).toContain(w);
  // thẻ đang chọn
  notes.selected = await grp.getByRole("button", { pressed: true }).allInnerTexts();
  expect(notes.selected.join(" ")).toMatch(/sonnet/i);
  // API thật
  await p.waitForTimeout(500);
  notes.api = apiBody;
  expect(apiCalls[0]).toBe(200);
});

await R.step("12", "Studio: tắt Orchestrator (agent mặc định) bị chặn", async () => {
  await p.goto(`${STUDIO}/agents`);
  const keys = await p.getByRole("switch").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  notes.switches = keys;
  const orch = p.getByRole("switch", { name: /orchestrator/i });
  await expect(orch).toBeVisible({ timeout: 20000 });
  notes.orchDisabled = await orch.isDisabled();
  notes.orchCheckedBefore = await orch.getAttribute("aria-checked");
  if (!notes.orchDisabled) await orch.click({ force: true }).catch(() => {});
  await p.waitForTimeout(1500);
  await R.snap(p, "12-C-orchestrator-disable-attempt");
  await p.reload();
  const o2 = p.getByRole("switch", { name: /orchestrator/i });
  await expect(o2).toBeVisible();
  notes.orchCheckedAfter = await o2.getAttribute("aria-checked");
  if (notes.orchCheckedAfter !== notes.orchCheckedBefore) {
    await o2.click(); await p.waitForTimeout(1500); notes.restored = true;
    throw new Error("Orchestrator bị tắt được (đã khôi phục)");
  }
  await R.snap(p, "12-C-orchestrator-still-on");
});

R.finish();
writeFileSync(`${OUT}/notes-studio.json`, JSON.stringify({ ...notes, apiCalls }, null, 2));
await b.close();
console.log(`DONE ${R.log.filter((x) => x.ok).length}/${R.log.length}`);
