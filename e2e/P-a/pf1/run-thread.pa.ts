// CHAT-AC-52 · U1 · T7 · T9 · HUB-FR-113 · e2e P-a PF1 · E-P3, E-P17 (test-plan-e2e §2; plan-frontend-thread §4–§5): run trong
// phòng = khối quy trình + thread `?flow=`. A gửi "!hoa-don-t HD-12" ⇒ A, B, X thấy tin gọi + khối ngay sau (không reload);
// "Trả lời tiếp" ⇒ pane có "Kết quả Đọc hoá đơn v1"; chỉ B (assignee) có "Kiểm ngay"; composer thread không có "Quy trình";
// "▶ Quy trình" chỉ tạo khối. E-P17: tin người↔người trong thread, `@agent` ⇒ alert, `!…` là chữ.
import { expect, test } from "@playwright/test";
import {
  badgeOf,
  block,
  flowBox,
  flowLog,
  flowPane,
  hub,
  mkRoom,
  openThread,
  outputMsg,
  processBtn,
  roomBox,
  roomLog,
  rtScript,
  settle,
  startUi,
  tok,
  users,
  waitingNote,
} from "../_pa-support";

test.afterEach(() => settle());

test('CHAT-AC-52 · U1 · E-P3 · A gửi "!hoa-don-t HD-12" ⇒ A, B, X thấy tin gọi + khối "Quy trình Hoá đơn T" ngay sau; trạng thái đổi khi stage xong (không reload); "Trả lời tiếp" ⇒ "Kết quả Đọc hoá đơn v1"; B có "Kiểm ngay", X có "Đang chờ …"; composer thread không có nút "Quy trình"', async ({
  browser,
}) => {
  const room = await mkRoom("EP3");
  const u = await users(browser, "A", "B", "X");
  try {
    await rtScript("hoa-don-t", 0, [{ kind: "hold" }]);
    for (const p of [u.A, u.B, u.X]) await p.goto(`/rooms/${room.id}`);
    const { runId } = await startUi(u.A, "!hoa-don-t HD-12");
    for (const p of [u.A, u.B, u.X]) {
      const call = roomLog(p).getByRole("article").filter({ hasText: "!hoa-don-t HD-12" });
      await expect(call).toBeVisible();
      await expect(block(p)).toBeVisible();
      await expect(block(p)).toHaveAttribute("data-run-id", runId);
      // khối ngay sau tin gọi trong timeline
      const arts = roomLog(p).getByRole("article");
      const names = await arts.evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") ?? ""),
      );
      const i = names.indexOf("Quy trình Hoá đơn T");
      expect(i).toBeGreaterThan(0);
      await expect(arts.nth(i - 1)).toContainText("!hoa-don-t HD-12");
    }
    await expect(block(u.X)).toContainText("Đang chạy");
    await rtScript("hoa-don-t", 0, [{ kind: "done" }]);
    // trạng thái sống: chờ kiểm (không reload)
    await expect(block(u.X)).toContainText(/Chờ kiểm|Đang chờ/);
    await expect(block(u.B).getByRole("button", { name: "Kiểm ngay" })).toBeVisible();
    await expect(block(u.X).getByRole("button", { name: "Kiểm ngay" })).toHaveCount(0);
    await expect(
      waitingNote(block(u.X), /Đang chờ .* kiểm — chỉ người kiểm mới bấm được\./),
    ).toBeVisible();
    // timeline không có Đạt/Chưa đạt
    await expect(block(u.B).getByRole("button", { name: "Đạt", exact: true })).toHaveCount(0);

    await block(u.X).getByRole("button", { name: "Trả lời tiếp" }).click();
    await expect(u.X).toHaveURL(/[?&]flow=/);
    await expect(flowPane(u.X)).toBeVisible();
    await expect(outputMsg(flowPane(u.X))).toBeVisible();
    await expect(flowPane(u.X).getByRole("button", { name: "Quy trình", exact: true })).toHaveCount(
      0,
    );

    // "▶ Quy trình" (nút) ⇒ khối không có tin gọi
    const userCount = async () =>
      (
        (await hub(await tok("A"), "GET", `/rooms/${room.id}/messages?limit=100`)).json?.items ?? []
      ).filter((m: { sender_type: string }) => m.sender_type === "user").length;
    const before = await userCount();
    await processBtn(u.A).click();
    await u.A.getByRole("listbox", { name: "Quy trình" })
      .getByRole("option")
      .filter({ hasText: "!hoa-don-t" })
      .click();
    await u.A.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(block(u.A)).toHaveCount(2);
    expect(await userCount()).toBe(before);
  } finally {
    await u.close();
  }
});

test('T7 · T9 · CHAT-AC-52 · E-P17 · X gửi "Đã xem" trong thread ⇒ A, B thấy (không khối/run mới); "@hd-read xem lại" ⇒ alert, chữ giữ; "!hoa-don-t x" trong thread ⇒ chữ thường; B ở phòng khác ⇒ huy hiệu chưa đọc R tăng khi có tin kết quả', async ({
  browser,
}) => {
  const room = await mkRoom("EP17");
  const other = await mkRoom("EP17-khac", ["B"]);
  const u = await users(browser, "A", "B", "X");
  try {
    await rtScript("hoa-don-t", 0, [{ kind: "hold" }]);
    await u.A.goto(`/rooms/${room.id}`);
    const { runId } = await startUi(u.A, "!hoa-don-t HD-17");
    await openThread(u.X, room.id);
    await openThread(u.A, room.id);
    await expect(flowBox(u.X)).toBeVisible();
    await expect(u.X.getByText(/Đây là trao đổi giữa người với người/)).toBeVisible();

    await flowBox(u.X).fill("Đã xem");
    await flowPane(u.X).getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(flowLog(u.A).getByRole("article").filter({ hasText: "Đã xem" })).toBeVisible();
    await expect(block(u.A)).toHaveCount(1);

    await flowBox(u.X).fill("@hd-read xem lại");
    await flowPane(u.X).getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(
      u.X.getByRole("alert").filter({
        hasText:
          "Trong luồng quy trình không gọi được agent bằng @. Hãy gọi ở khung chat chính của phòng.",
      }),
    ).toBeVisible();
    await expect(flowBox(u.X)).toHaveValue("@hd-read xem lại");
    await expect(
      flowLog(u.A).getByRole("article").filter({ hasText: "@hd-read xem lại" }),
    ).toHaveCount(0);

    await flowBox(u.X).fill("!hoa-don-t x");
    const r = u.X.waitForResponse(
      (x) => x.request().method() === "POST" && /\/messages$/.test(new URL(x.url()).pathname),
    );
    await flowPane(u.X).getByRole("button", { name: "Gửi", exact: true }).click();
    expect((await r).headers()["x-process-run-id"]).toBeUndefined();
    await expect(
      flowLog(u.A).getByRole("article").filter({ hasText: "!hoa-don-t x" }),
    ).toBeVisible();
    await expect(block(u.A)).toHaveCount(1);
    await expect(block(u.A)).toHaveAttribute("data-run-id", runId);

    // B ở phòng khác ⇒ huy hiệu chưa đọc R tăng khi có tin kết quả (như X2b)
    await u.B.goto(`/rooms/${other.id}`);
    await rtScript("hoa-don-t", 0, [{ kind: "done" }]);
    await expect(badgeOf(u.B, room.name)).toBeVisible();
    await expect(roomBox(u.B)).toBeVisible();
  } finally {
    await u.close();
  }
});
