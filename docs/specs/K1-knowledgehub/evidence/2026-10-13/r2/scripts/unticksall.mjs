// Dọn trước vòng 2: bỏ tick kh-main ở mọi agent CLI (để k1-a dựng lại kết nối từ đầu).
import { launch, studioLogin } from "./lib.mjs";
const T = process.argv[2];
const ids = (await (await fetch("http://localhost:4000/studio/api/agents?limit=200", { headers: { authorization: `Bearer ${T}` } })).json()).items.filter((a) => a.runtime === "agentic-cli");
const { browser, page } = await launch("/tmp/x");
await studioLogin(page);
for (const a of ids) {
  await page.goto(`http://localhost:3200/studio/agents/${a.id}`);
  const cb = page.getByRole("region", { name: "KnowledgeHub" }).getByRole("checkbox", { name: "kh-main" });
  try { await cb.waitFor({ timeout: 6000 }); } catch { continue; }
  if (await cb.isChecked()) {
    await cb.uncheck();
    await page.getByRole("region", { name: "KnowledgeHub" }).getByRole("button", { name: "Lưu" }).click();
    await page.getByRole("region", { name: "Notifications" }).getByText("Đã lưu kết nối của agent").first().waitFor();
    console.log("unticked", a.key);
  }
}
await browser.close();
