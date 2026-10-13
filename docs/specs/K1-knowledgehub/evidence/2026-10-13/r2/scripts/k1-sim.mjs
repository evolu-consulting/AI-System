// Mô phỏng (page.route vá StageView.knowledge) để xem Alert hạ cấp ở admin OutputDialog — KHÔNG phải kết quả thật (fake-cli không tạo được stage hạ cấp mà vẫn qua mẫu).
import { launch, adminLogin, mkSnap, mkStep, expect, ADMIN } from "./lib.mjs";
const OUT = process.argv[2], DEF = process.argv[3], RUN = process.argv[4];
const { browser, page: C } = await launch(OUT);
const snap = mkSnap(OUT);
const { step, save } = mkStep(OUT, () => ({ C }), snap);
await adminLogin(C, "julian.bui", "evolu");
await C.route((u) => u.pathname === `/process-runs/${RUN}`, async (route) => {
  if (route.request().method() !== "GET") return route.continue();
  const res = await route.fetch(); const body = await res.json();
  body.stages[0].knowledge = { write_to: { connection: "kh-main", project: "evolu" }, queries: 2, query_limit: 5, warning: "unreachable", summary: "pending" };
  return route.fulfill({ response: res, json: body });
});
await step("61-01", "[MÔ PHỎNG] admin OutputDialog với knowledge.warning=unreachable: Alert vàng + dòng Tri thức 2/5 · Tóm tắt đang chờ", async () => {
  await C.goto(`${ADMIN}/processes/${DEF}/runs/${RUN}`);
  await C.waitForTimeout(2500);
  await C.getByRole("button", { name: /View output|Xem kết quả/i }).first().click();
  const dlg = C.getByRole("dialog").first();
  await expect(dlg.getByRole("status").first()).toBeVisible({ timeout: 5000 });
  await snap(C, "61-C-sim-warning");
  console.log(await dlg.getByRole("status").first().innerText());
});
save(); await browser.close();
