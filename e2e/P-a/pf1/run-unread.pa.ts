// CHAT-AC-52 · T9 · e2e P-a PF1 · E-P19 (test-plan-e2e §2; như X2b chưa đọc): X ở phòng khác — tin quy trình mới (output) ⇒
// huy hiệu chưa đọc R tăng; vào R ⇒ FlowRecent của F có "Chưa xem"; mở thread ⇒ "Chưa xem" mất, huy hiệu về 0. Với A (người
// khởi chạy) tin quy trình VẪN tính chưa đọc. Xem trước phòng ở sidebar = "Hoá đơn T: <đoạn đầu tin>".
import { expect, test } from "@playwright/test";
import { badgeOf, block, mkRoom, roomLink, rtScript, settle, startUi, users } from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-52 · T9 · E-P19 · tin quy trình mới ⇒ huy hiệu chưa đọc R tăng (cả X và A khởi chạy); FlowRecent "Chưa xem" tới khi mở thread; xem trước sidebar "Hoá đơn T: …"', async ({
  browser,
}) => {
  const room = await mkRoom("EP19");
  const other = await mkRoom("EP19-khac", ["X"]);
  const u = await users(browser, "A", "X");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await rtScript("hoa-don-t", 0, [{ kind: "hold" }]);
    const { runId } = await startUi(u.A, "!hoa-don-t HD-19");
    await expect(block(u.A)).toBeVisible();
    // cả hai ra phòng khác rồi stage xong ⇒ tin output mới
    await u.A.goto(`/rooms/${other.id}`);
    await u.X.goto(`/rooms/${other.id}`);
    await rtScript(runId, 0, [{ kind: "done" }]);
    for (const p of [u.X, u.A]) {
      await expect(badgeOf(p, room.name)).toBeVisible();
      await expect(roomLink(p, room.name)).toContainText(/Hoá đơn T: /);
    }

    await roomLink(u.X, room.name).click();
    const recent = block(u.X);
    await expect(recent.getByText("Chưa xem")).toBeVisible();
    await recent.getByRole("button", { name: "Trả lời tiếp" }).click();
    await expect(u.X.getByRole("complementary", { name: "Flow đang mở" })).toBeVisible();
    await expect(recent.getByText("Chưa xem")).toHaveCount(0);
    await u.X.goto(`/rooms/${other.id}`);
    await expect(badgeOf(u.X, room.name)).toHaveCount(0);
  } finally {
    await u.close();
  }
});
