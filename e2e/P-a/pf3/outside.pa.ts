// CHAT-AC-56 · AC-H29 · HUB-BR-25 · e2e P-a PF3 · E-P13 (test-plan-e2e §2; plan-frontend-e2e §1 `/runs/$id`): T (Group duyệt,
// ngoài phòng) mở `/runs/<id>`: heading "Hoá đơn T", tab "Tiến độ" + "Token", KHÔNG tab "Nhật ký", banner "Bạn không ở phòng
// này. Bạn chỉ xem được phần cần xử lý…", không link "Quay lại …"; trang không chứa `ROOM-SECRET-P1`; T gõ `/rooms/<R>` ⇒
// "Không tìm thấy"; S (q06, người lạ) mở `/runs/<id>` ⇒ "Không tìm thấy".
import { expect, test } from "@playwright/test";
import { mkRoom, SECRET_ROOM, seedRun, sendRoom, settle, users } from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-56 · AC-H29 · E-P13 · T ngoài phòng: /runs/<id> có "Tiến độ"/"Token", không "Nhật ký", banner ngoài phòng, không link phòng, không lộ ROOM-SECRET-P1; /rooms/<R> ⇒ "Không tìm thấy"; người lạ /runs/<id> ⇒ "Không tìm thấy"', async ({
  browser,
}) => {
  const room = await mkRoom("EP13");
  const r = await seedRun(room.id, "waiting_review");
  const u = await users(browser, "A", "T", "S");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await sendRoom(u.A, `Ghi chú nội bộ ${SECRET_ROOM}`);

    const p = u.T;
    await p.goto(`/runs/${r.runId}`);
    await expect(p.getByRole("heading", { name: "Hoá đơn T" })).toBeVisible();
    await expect(p.getByRole("tab", { name: "Tiến độ" })).toBeVisible();
    await expect(p.getByRole("tab", { name: "Token" })).toBeVisible();
    await expect(p.getByRole("tab", { name: "Nhật ký" })).toHaveCount(0);
    await expect(
      p.getByText(/Bạn không ở phòng này\. Bạn chỉ xem được phần cần xử lý/),
    ).toBeVisible();
    await expect(p.getByRole("link", { name: /^Quay lại / })).toHaveCount(0);
    await expect(p.getByRole("link", { name: "Mở luồng trong phòng" })).toHaveCount(0);
    await expect(p.locator("body")).not.toContainText(SECRET_ROOM);

    await p.goto(`/rooms/${room.id}`);
    await expect(p.getByText("Không tìm thấy").first()).toBeVisible();

    await u.S.goto(`/runs/${r.runId}`);
    await expect(u.S.getByText("Không tìm thấy").first()).toBeVisible();
    await expect(u.S.getByRole("heading", { name: "Hoá đơn T" })).toHaveCount(0);
  } finally {
    await u.close();
  }
});
