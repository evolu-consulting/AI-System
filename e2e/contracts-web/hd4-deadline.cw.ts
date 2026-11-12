// HD4-AC08 · S05 · Luật 4b: HĐ chưa duyệt (nháp) ⇒ không có thẻ "Hạn chót hành động" (backend giả `page.route`). CR-127 Q10b: thẻ Hạn chót + «Ghi nhận xử lý» (POST /handled) đã gỡ — kết cục hiệu lực nay là Gia hạn/Chấm dứt (e2e/cr127).
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Sent = { method: string; path: string; body: unknown };
// Ngày theo múi giờ của trình duyệt trong cấu hình (Asia/Ho_Chi_Minh), không theo múi giờ máy chạy test (container UTC lệch ngày lúc 17–24 giờ UTC).
const iso = (days: number) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(),
  );
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function install(page: Page, status: string): Promise<Sent[]> {
  const sent: Sent[] = [];
  const d = asHub("editor");
  let handled: { outcome: string } | null = null;
  const json = (r: Parameters<Parameters<Page["route"]>[1]>[0], code: number, body: unknown) =>
    r.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(body) });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "POST" && path.endsWith("/handled")) {
      const body = req.postDataJSON() as { outcome: string };
      sent.push({ method: "POST", path, body });
      handled = { outcome: body.outcome };
      return json(r, 200, {
        id: contract.id,
        status,
        handled: { ...handled, by: contract.id, at: new Date().toISOString() },
        action_deadline: iso(20),
        version: 4,
      });
    }
    // CR-127 Q10b: chi tiết mới còn đọc các đường con (đối tác, duyệt…) — chỉ trả HĐ cho đúng đường của nó, còn lại 404.
    if (path.endsWith("/partner")) return json(r, 200, { party: null, name: null });
    if (path.endsWith(`/${contract.id}`))
      return json(r, 200, { ...contractAsHub(status), action_deadline: iso(20), handled });
    return json(r, 404, { error: { code: "NOT_FOUND", message: "x" } });
  });
  return sent;
}

test("HD4-AC08 · S05 · HĐ chờ kiểm (needs_review) ⇒ không có thẻ hạn chót", async ({ page }) => {
  await install(page, "needs_review");
  await page.goto(`/contracts/c/${contract.id}`);
  await expect(page.getByLabel("Giá trị")).toBeVisible();
  await expect(page.getByTestId("deadline-panel")).toHaveCount(0);
});
