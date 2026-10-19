// HD4-AC08 · HD4-FR-06 · S05 · Luật 4b: thẻ "Hạn chót hành động" + "Ghi nhận xử lý" trên màn HĐ đã duyệt (backend giả
// `page.route`). Chọn kết quả ⇒ POST `/handled` đúng thân, tải lại chi tiết ⇒ "Đã xử lý: …". HĐ chưa duyệt ⇒ không có thẻ.
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Sent = { method: string; path: string; body: unknown };
const iso = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    return json(r, 200, { ...contractAsHub(), status, action_deadline: iso(20), handled });
  });
  return sent;
}

test("HD4-AC08 · S05 · HĐ đã duyệt: hạn chót + còn 20 ngày; chọn «Đang đàm phán» ⇒ POST /handled ⇒ «Đã xử lý»", async ({
  page,
}) => {
  const sent = await install(page, "expiring");
  await page.goto(`/contracts/${contract.id}`);
  const panel = page.getByTestId("deadline-panel");
  await expect(panel).toContainText("Hạn chót hành động");
  await expect(panel).toContainText(iso(20).split("-").reverse().join("/"));
  await expect(panel).toContainText("còn 20 ngày");
  await panel.getByRole("combobox").selectOption("negotiating");
  await expect(panel).toContainText("Đã xử lý: Đang đàm phán");
  expect(sent).toEqual([
    {
      method: "POST",
      path: `/pack/contracts/contracts/${contract.id}/handled`,
      body: { outcome: "negotiating" },
    },
  ]);
});

test("HD4-AC08 · S05 · HĐ chờ kiểm (needs_review) ⇒ không có thẻ hạn chót", async ({ page }) => {
  await install(page, "needs_review");
  await page.goto(`/contracts/${contract.id}`);
  await expect(page.getByLabel("Giá trị (đ)")).toBeVisible();
  await expect(page.getByTestId("deadline-panel")).toHaveCount(0);
});
