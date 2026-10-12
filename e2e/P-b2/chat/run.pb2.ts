// CHAT-AC-59 · CHAT-AC-60 · HUB-FR-113 · HUB-FR-118 · AC-PB2-01/08/11/12 · e2e P-b2 chat (test-plan §4 E-PB2-20…28): StageStrip
// theo bước, thẻ duyệt "Quay lại bước X", lịch sử quay lại + phiên bản, thẻ `back_limit`, người ngoài phòng. Nhãn NGUYÊN VĂN
// plan-frontend §7 + i18n §2–§3 (số bước UI = `step+1`). Run dựng bằng SQL (`seedPb2Run` a/a'/b/c/d); Runtime giả P-a chạy lại
// stage sau quay lại. 0024 vắng ⇒ seed `ready:false` ⇒ đỏ ở locator/expect UI.
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  addAssignee,
  block,
  DEF_PAR,
  failBtn,
  mkRoom,
  runView,
  seedPb2Run,
  seedRun,
  settle,
  users,
} from "../_pb2-support";

test.afterEach(() => settle());

const strip = (p: Page, name: string) =>
  block(p, name).getByRole("list", { name: "Tiến độ quy trình" });
const card = (p: Page, stage: string) => p.getByRole("region", { name: `Kiểm ${stage}` });
const WENT_BACK = "Đã quay lại bước 1. Các giai đoạn sẽ chạy lại với góp ý của bạn.";
const SUPERSEDED = "Giai đoạn này vừa được xử lý ở bước khác. Đã cập nhật.";

test("CHAT-AC-59 · E-PB2-20 · run pb2-par trong phòng: 'Tiến độ quy trình' 3 bước; bước 2 là list 'Bước 2 — chạy song song' 2 mục", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-20");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    const s = strip(u.A, DEF_PAR.name);
    await expect(s).toBeVisible();
    await expect(s.locator(":scope > li")).toHaveCount(3);
    const par = s.getByRole("list", { name: "Bước 2 — chạy song song" });
    await expect(par.getByRole("listitem")).toHaveCount(2);
    await expect(par).toContainText("Rà soát code");
    await expect(par).toContainText("Test hồi quy");
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("AC-PB2-01 · E-PB2-20b · run hoa-don-t (không step) ⇒ strip không có chữ 'Bước' (giao diện cũ)", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-20b");
  await seedRun(room.id, "waiting_review");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await expect(block(u.A)).toBeVisible();
    await expect(block(u.A)).not.toContainText("Bước");
  } finally {
    await u.close();
  }
});

test("CHAT-AC-60 · E-PB2-21 · seed (a): B ở trang Run thấy 2 thẻ duyệt nhóm dưới group 'Bước 2' (Q7)", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-21");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "B");
  try {
    await u.B.goto(`/runs/${r.runId}`);
    const g = u.B.getByRole("group", { name: "Bước 2" });
    await expect(card(u.B, "Rà soát code")).toBeVisible();
    await expect(g.getByRole("region", { name: /^Kiểm / })).toHaveCount(2);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-60 · HUB-FR-118 · E-PB2-22 · thẻ Test hồi quy: Chưa đạt ⇒ radiogroup; chọn 'Quay lại bước 1' ⇒ note; trống ⇒ lỗi; góp ý ⇒ toast; chạy lại ⇒ strip ×2", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-22");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "A", "B");
  try {
    await u.B.goto(`/runs/${r.runId}`);
    const c = card(u.B, "Test hồi quy");
    await failBtn(c).click();
    const rg = c.getByRole("radiogroup", { name: "Chưa đạt thì…" });
    await expect(rg.getByRole("radio", { name: "Làm lại giai đoạn này" })).toBeChecked();
    await rg.getByRole("radio", { name: "Quay lại bước 1" }).check();
    await expect(
      c.getByRole("note").filter({
        hasText: "Còn 3 lần quay lại. Các bước từ 1 trở đi sẽ chạy lại; kết quả cũ vẫn xem được.",
      }),
    ).toBeVisible();
    await c.getByRole("button", { name: "Gửi chưa đạt" }).click();
    await expect(c.getByText("Nhập góp ý trước khi gửi.")).toBeVisible();
    await c.getByRole("textbox", { name: "Góp ý" }).fill("Thiếu ca hồi quy");
    await c.getByRole("button", { name: "Gửi chưa đạt" }).click();
    await expect(u.B.getByText(WENT_BACK)).toBeVisible();
    await expect.poll(async () => (await runView("A", r.runId))?.back_rounds).toBe(1);
    await u.A.goto(`/rooms/${room.id}`);
    await expect(strip(u.A, DEF_PAR.name)).toContainText("×2", { timeout: 20_000 });
  } finally {
    await u.close();
  }
});

test("AC-PB2-07 · E-PB2-22b · seed (d) back_rounds=3: radio 'Quay lại bước 1' vẫn hiện; note hết lượt; gửi ⇒ run needs_decision back_limit", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-22b");
  const r = await seedPb2Run(room.id, "d");
  const u = await users(browser, "B");
  try {
    await u.B.goto(`/runs/${r.runId}`);
    const c = card(u.B, "Test hồi quy");
    await failBtn(c).click();
    const back = c
      .getByRole("radiogroup", { name: "Chưa đạt thì…" })
      .getByRole("radio", { name: "Quay lại bước 1" });
    await expect(back).toBeVisible();
    await back.check();
    await expect(
      c
        .getByRole("note")
        .filter({ hasText: "Đã hết 3 lần quay lại. Gửi sẽ chuyển cho người quyết." }),
    ).toBeVisible();
    await c.getByRole("textbox", { name: "Góp ý" }).fill("Vẫn thiếu");
    await c.getByRole("button", { name: "Gửi chưa đạt" }).click();
    await expect
      .poll(async () => {
        const v = await runView("A", r.runId);
        return [v?.status, v?.decision?.reason];
      })
      .toEqual(["needs_decision", "back_limit"]);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-60 · E-PB2-23 · thẻ Rà soát code (không back_to_steps) ⇒ Chưa đạt không có radiogroup (hành vi cũ)", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-23");
  const r = await seedPb2Run(room.id, "a");
  const u = await users(browser, "B");
  try {
    await u.B.goto(`/runs/${r.runId}`);
    const c = card(u.B, "Rà soát code");
    await failBtn(c).click();
    await expect(u.B.getByRole("radiogroup", { name: "Chưa đạt thì…" })).toHaveCount(0);
  } finally {
    await u.close();
  }
});

test("AC-PB2-08 · E-PB2-24 · seed (a') B (P1a) và T (P1b, ngoài phòng) cùng quay lại ⇒ một toast thành công, người kia toast 'vừa được xử lý…' và thẻ đóng", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-24");
  const r = await seedPb2Run(room.id, "a2");
  const u = await users(browser, "B", "T");
  try {
    await u.B.goto(`/runs/${r.runId}`);
    await u.T.goto(`/runs/${r.runId}?task=${r.tasks[2]}`);
    const cards = [card(u.B, "P1a"), card(u.T, "P1b")];
    for (const c of cards) {
      await failBtn(c).click();
      await c
        .getByRole("radiogroup", { name: "Chưa đạt thì…" })
        .getByRole("radio", { name: "Quay lại bước 1" })
        .check();
      await c.getByRole("textbox", { name: "Góp ý" }).fill("Quay về P0");
    }
    await Promise.all(cards.map((c) => c.getByRole("button", { name: "Gửi chưa đạt" }).click()));
    await expect(async () => {
      const n = async (t: string) =>
        (await u.B.getByText(t).count()) + (await u.T.getByText(t).count());
      expect([await n(WENT_BACK), await n(SUPERSEDED)]).toEqual([1, 1]);
    }).toPass({ timeout: 15_000 });
    const [cb, ct] = cards as [Locator, Locator];
    const loser = (await u.B.getByText(SUPERSEDED).count()) > 0 ? cb : ct;
    await expect(loser).toHaveCount(0);
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("HUB-FR-113 · E-PB2-25 · seed (b) trang Run: group 'Bước 2' có '×3 lần'; 'Lịch sử quay lại' 2 vòng; tab 'Bản 1'/'Bản 2' (Bản 2 chọn sẵn)", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-25");
  const r = await seedPb2Run(room.id, "b");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    await expect(u.A.getByRole("group", { name: "Bước 2" })).toContainText("×3 lần");
    const items = u.A.getByRole("list", { name: "Lịch sử quay lại" }).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("Vòng 2");
    await expect(items.nth(0)).toContainText("Tổng hợp");
    await expect(items.nth(0)).toContainText("quay lại bước 2");
    await expect(items.nth(1)).toContainText("Vòng 3");
    await expect(items.nth(1)).toContainText("Test hồi quy");
    await expect(items.nth(1)).toContainText("quay lại bước 1");
    await expect(u.A.getByRole("tab", { name: /^Bản 1/ }).first()).toBeVisible();
    const v2 = u.A.getByRole("tab", { name: /^Bản 2/ }).first();
    await expect(v2).toHaveAttribute("aria-selected", "true");
    await expect(v2).toContainText("mới nhất");
  } finally {
    await u.close();
  }
});

test("AC-PB2-07 · E-PB2-26 · seed (c) thẻ 'Cần người quyết': 'Đã quay lại tối đa 3 lần mà chưa đạt.' + 3 nút; 'Thêm 1 lần làm lại' ⇒ quay lại thực hiện, strip ×2", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-26");
  const r = await seedPb2Run(room.id, "c");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    await expect(u.A.getByText("Đã quay lại tối đa 3 lần mà chưa đạt.")).toBeVisible();
    for (const b of ["Thêm 1 lần làm lại", "Dùng bản hiện có", "Huỷ lượt chạy"])
      await expect(u.A.getByRole("button", { name: b })).toBeVisible();
    await u.A.getByRole("button", { name: "Thêm 1 lần làm lại" }).click();
    await expect
      .poll(async () => {
        const v = await runView("A", r.runId);
        return [v?.back_limit, v?.back_rounds];
      })
      .toEqual([4, 4]);
    await u.A.goto(`/rooms/${room.id}`);
    await expect(strip(u.A, DEF_PAR.name)).toContainText("×2", { timeout: 20_000 });
  } finally {
    await u.close();
  }
});

test("AC-PB2-11 · E-PB2-27 · H (ngoài phòng, có task) mở Run ⇒ KHÔNG có 'Lịch sử quay lại'", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-27");
  const r = await seedPb2Run(room.id, "b");
  await addAssignee(r.tasks[0] as string, "H");
  const u = await users(browser, "H");
  try {
    await u.H.goto(`/runs/${r.runId}?task=${r.tasks[0]}`);
    await expect(card(u.H, "Phân tích")).toBeVisible();
    await expect(u.H.getByRole("list", { name: "Lịch sử quay lại" })).toHaveCount(0);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-59 · E-PB2-28 · strip seed (b): '↩ Quay lại bước 1 (lần 2)'; seed (d) back_rounds=3 ⇒ 'Đã quay lại tối đa 3 lần'", async ({
  browser,
}) => {
  const room = await mkRoom("EPB2-28");
  await seedPb2Run(room.id, "b");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await expect(block(u.A, DEF_PAR.name)).toContainText("↩ Quay lại bước 1 (lần 2)");
    await settle();
    const room2 = await mkRoom("EPB2-28d");
    await seedPb2Run(room2.id, "d");
    await u.A.goto(`/rooms/${room2.id}`);
    await expect(block(u.A, DEF_PAR.name)).toContainText("Đã quay lại tối đa 3 lần");
  } finally {
    await u.close();
  }
});
