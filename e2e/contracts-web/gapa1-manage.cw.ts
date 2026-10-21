// gap-a1 · trang chi tiết HĐ — "Giao cho" (#7), "Lịch sử thay đổi" (#4), sửa hoa hồng % (#16), "AI đọc lại từ đầu" + "Thử lại" (#5),
// "Tạo tóm tắt bằng AI" (#17): mỗi hành động đúng MỘT yêu cầu ghi với đúng thân; viewer không thấy ô sửa. Backend giả `page.route`; chờ
// phần tử, không sleep. (Viết trong lát, chạy ở cuối đợt — Luật 0b.)
import { expect, type Page, type Route, test } from "@playwright/test";
import type { Role } from "./dataset";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const BASE = `**/pack/contracts/contracts/${ACTIVE_ID}`;
const PEOPLE = [
  { id: "a1000000-0000-4000-8000-000000000001", name: "Chi Nguyễn" },
  { id: "a1000000-0000-4000-8000-000000000002", name: "Hòa Trần" },
];

async function open(page: Page, role: Role, over: Record<string, unknown> = {}) {
  await installV2f(page, { role, contract: () => activeContract({ has_source: true, ...over }) });
  const sent: { method: string; path: string; body: unknown }[] = [];
  const rec = (r: Route, reply: unknown, status = 200) => {
    const q = r.request();
    sent.push({
      method: q.method(),
      path: new URL(q.url()).pathname,
      body: q.postData() ? q.postDataJSON() : null,
    });
    return json(r, status, reply);
  };
  await page.route("**/pack/contracts/assignees", (r) => json(r, 200, { items: PEOPLE }));
  await page.route(`${BASE}/owner`, (r) => rec(r, { id: ACTIVE_ID, owner_user_id: PEOPLE[1]?.id }));
  await page.route(`${BASE}/commission`, (r) =>
    rec(r, { id: ACTIVE_ID, version: 2, commission_pct: 7.5 }),
  );
  await page.route(`${BASE}/extract`, (r) => rec(r, { id: ACTIVE_ID, status: "extracting" }, 202));
  await page.route(`${BASE}/summary`, (r) =>
    rec(r, {
      id: ACTIVE_ID,
      summary: { main: "Tóm tắt thử", deadlines: [], penalties: [], bonuses: [], clauses: [] },
    }),
  );
  await page.route(`${BASE}/history`, (r) =>
    json(r, 200, {
      items: [
        {
          type: "field_edited",
          actor_user_id: PEOPLE[0]?.id,
          at: "2026-10-17T02:00:00Z",
          data: { changes: [{ key: "title", old: "Cũ", new: "Mới" }] },
        },
      ],
    }),
  );
  await page.goto(`/contracts/${ACTIVE_ID}`);
  return sent;
}

test("editor: giao cho người khác ⇒ một PUT /owner; mở lịch sử thấy khác biệt trường", async ({
  page,
}) => {
  const sent = await open(page, "editor");
  await page.getByTestId("owner-select").selectOption(PEOPLE[1]?.id as string);
  await expect.poll(() => sent.filter((s) => s.path.endsWith("/owner")).length).toBe(1);
  expect(sent.find((s) => s.path.endsWith("/owner"))?.body).toEqual({
    owner_user_id: PEOPLE[1]?.id,
  });
  await page.getByTestId("history-toggle").click();
  await expect(page.getByTestId("history")).toContainText("Cũ");
  await expect(page.getByTestId("history")).toContainText("Mới");
});

test("editor: HĐ Giới thiệu sửa hoa hồng % ⇒ một PUT /commission kèm version", async ({ page }) => {
  const sent = await open(page, "editor", { deal: "referral", commission_pct: 5, version: 1 });
  await page.locator("#commission-pct").fill("7,5");
  await page.getByTestId("commission-save").click();
  await expect.poll(() => sent.filter((s) => s.path.endsWith("/commission")).length).toBe(1);
  expect(sent.find((s) => s.path.endsWith("/commission"))?.body).toEqual({
    version: 1,
    commission_pct: 7.5,
  });
});

test("editor: HĐ chờ xác nhận ⇒ xác nhận hộp thoại rồi một POST /extract", async ({ page }) => {
  const sent = await open(page, "editor", { status: "needs_review" });
  await page.getByTestId("reextract").click();
  await page.getByTestId("reextract-confirm").click();
  await expect.poll(() => sent.filter((s) => s.path.endsWith("/extract")).length).toBe(1);
});

test("editor: đọc lỗi ⇒ nút Thử lại gọi POST /extract", async ({ page }) => {
  const sent = await open(page, "editor", { status: "extract_failed", error: "AGENT_FAILED" });
  await page.getByTestId("reextract").click();
  await page.getByTestId("reextract-confirm").click();
  await expect.poll(() => sent.filter((s) => s.path.endsWith("/extract")).length).toBe(1);
});

test("editor: chưa có tóm tắt AI ⇒ Tạo tóm tắt bằng AI gọi POST /summary", async ({ page }) => {
  const sent = await open(page, "editor", { ai: null });
  await page.getByTestId("generate-summary").click();
  await expect.poll(() => sent.filter((s) => s.path.endsWith("/summary")).length).toBe(1);
});

test("viewer: không có ô giao, nút đọc lại, hoa hồng, tạo tóm tắt", async ({ page }) => {
  await open(page, "viewer", { deal: "referral", status: "needs_review", ai: null });
  await expect(page.getByTestId("owner-row")).toBeVisible();
  await expect(page.getByTestId("owner-select")).toHaveCount(0);
  await expect(page.getByTestId("reextract")).toHaveCount(0);
  await expect(page.getByTestId("commission-row")).toHaveCount(0);
  await expect(page.getByTestId("generate-summary")).toHaveCount(0);
});
