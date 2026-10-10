// HUB-BR-26 · CHAT-AC-58 · e2e P-a PF1 · E-P7 (test-plan-e2e §2): run `needs_decision team_calls` (seedRun): A (trong thread) và
// Adm (`/runs/:id`) có 3 nút "Thêm 1 lần làm lại" / "Dùng bản hiện có" / "Huỷ lượt chạy"; B, X chỉ chữ "Đang chờ … hoặc quản trị
// viên quyết định"; "Thêm 1 lần làm lại" ⇒ chạy lại; "Huỷ lượt chạy" ⇒ "Đã huỷ"; 6 run đang chạy ⇒ alert giới hạn 5 + Gửi khoá.
import { expect, test } from "@playwright/test";
import {
  block,
  flowPane,
  mkRoom,
  roomBox,
  rtScript,
  seedRun,
  sendRoom,
  settle,
  users,
  waitingNote,
} from "../_pa-support";

test.afterEach(() => settle());

const OPTS = ["Thêm 1 lần làm lại", "Dùng bản hiện có", "Huỷ lượt chạy"] as const;

test('HUB-BR-26 · CHAT-AC-58 · E-P7 · needs_decision: A (thread) và Adm (/runs/:id) có 3 nút; B, X chỉ "Đang chờ … hoặc quản trị viên quyết định"; "Thêm 1 lần làm lại" ⇒ chạy lại; "Huỷ lượt chạy" ⇒ "Đã huỷ"', async ({
  browser,
}) => {
  const room = await mkRoom("EP7");
  const r1 = await seedRun(room.id, "needs_decision");
  const r2 = await seedRun(room.id, "needs_decision");
  const u = await users(browser, "A", "B", "X", "Adm");
  try {
    await rtScript(r1.runId, 0, [{ kind: "hold" }]);
    await u.A.goto(`/rooms/${room.id}?flow=${r1.flowId}`);
    const reg = flowPane(u.A).getByRole("region", { name: "Cần người quyết" });
    await expect(reg).toBeVisible();
    for (const o of OPTS) await expect(reg.getByRole("button", { name: o })).toBeVisible();

    await u.Adm.goto(`/runs/${r2.runId}`);
    const regAdm = u.Adm.getByRole("region", { name: "Cần người quyết" });
    for (const o of OPTS) await expect(regAdm.getByRole("button", { name: o })).toBeVisible();

    for (const p of [u.B, u.X]) {
      await p.goto(`/rooms/${room.id}?flow=${r1.flowId}`);
      await expect(flowPane(p)).toBeVisible();
      await expect(
        waitingNote(flowPane(p), /Đang chờ .* hoặc quản trị viên quyết định/),
      ).toBeVisible();
      await expect(flowPane(p).getByRole("button", { name: "Thêm 1 lần làm lại" })).toHaveCount(0);
    }

    await reg.getByRole("button", { name: "Thêm 1 lần làm lại" }).click();
    await expect(reg).toBeHidden();
    await expect(block(u.A).and(u.A.locator(`[data-run-id="${r1.runId}"]`))).toContainText(
      "Đang chạy",
    );

    await regAdm.getByRole("button", { name: "Huỷ lượt chạy" }).click();
    const dlg = u.Adm.getByRole("alertdialog", { name: "Huỷ lượt chạy này?" });
    await dlg.getByRole("button", { name: "Xác nhận huỷ" }).click();
    await expect(u.Adm.getByText("Đã huỷ").first()).toBeVisible();
  } finally {
    await u.close();
  }
});

test('CHAT-AC-58 · E-P7 · 6 run đang chạy (giới hạn 5/công ty) ⇒ alert "Công ty đang chạy tối đa 5 quy trình cùng lúc…" và nút Gửi khoá', async ({
  browser,
}) => {
  const room = await mkRoom("EP7b");
  for (let i = 0; i < 5; i++) await seedRun(room.id, "running");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await sendRoom(u.A, "!hoa-don-t HD-6");
    await expect(
      u.A.getByRole("alert").filter({
        hasText: /Công ty đang chạy tối đa 5 quy trình cùng lúc\. Thử lại sau \d+ giây\./,
      }),
    ).toBeVisible();
    await expect(u.A.getByRole("button", { name: "Gửi", exact: true })).toBeDisabled();
    await expect(roomBox(u.A)).toHaveValue("!hoa-don-t HD-6");
  } finally {
    await u.close();
  }
});
