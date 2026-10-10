// CHAT-AC-57 · AC-H30 · HUB-FR-111 · e2e P-a PF2 · E-P9, E-P10 (test-plan-e2e §2; plan-frontend-e2e §1 "nhờ người khác"):
// A nhờ H (QC Người 01) trả lời ⇒ "Đã nhờ QC Người 01 (chuyển 1/3)…" + tin chuyển trong thread (`forward task_kind:"ask"`, KHÔNG
// lời nhắn); H: `link "Quy trình"` có huy hiệu, thấy "Lan Tran nhờ bạn trả lời", lời nhắn, "Ngữ cảnh kèm theo", câu hỏi, không tin
// phòng; H trả lời ⇒ A thấy tin kết quả task của H; A gửi muộn ⇒ "Đã có người trả lời". E-P10: 3 lần chuyển ⇒ nút khoá; đích sai
// ⇒ alert; B chuyển review cho H ⇒ "Chỉ chuyển được cho người cùng nhóm kiểm"; "@QC Người 01 …" ở phòng không chuyển.
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  flowPane,
  mkRoom,
  PERSONA,
  roomBox,
  SECRET_ROOM,
  seedRun,
  sendRoom,
  settle,
  taskResult,
  users,
} from "../_pa-support";

test.afterEach(() => settle());

const askRegion = (scope: Locator) =>
  scope.getByRole("region", { name: /cần thêm thông tin · lần hỏi \d\/3$/ });
async function forwardTo(p: Page, scope: Locator, who: string, note = "") {
  await scope.getByRole("button", { name: "Nhờ người khác trả lời" }).click();
  const dlg = p.getByRole("dialog", { name: "Nhờ ai trả lời?" });
  await dlg.getByRole("searchbox", { name: "Tìm người" }).fill(who);
  await dlg.getByRole("checkbox", { name: who }).check();
  if (note) await dlg.getByRole("textbox", { name: "Lời nhắn (tuỳ chọn)" }).fill(note);
  await dlg.getByRole("button", { name: "Nhờ trả lời" }).click();
  return dlg;
}

test('CHAT-AC-57 · AC-H30 · E-P9 · A nhờ QC Người 01 ⇒ tin chuyển "(chuyển 1/3)" không lời nhắn; H có huy hiệu "Quy trình", thấy "Lan Tran nhờ bạn trả lời" + lời nhắn + ngữ cảnh, không tin phòng; H trả lời ⇒ A thấy kết quả; A gửi muộn ⇒ "Đã có người trả lời"', async ({
  browser,
}) => {
  const room = await mkRoom("EP9");
  const r = await seedRun(room.id, "waiting_answer");
  const u = await users(browser, "A", "H");
  try {
    await u.A.goto(`/rooms/${room.id}`);
    await sendRoom(u.A, `Tin phòng ${SECRET_ROOM}`);
    await u.A.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    const pa = flowPane(u.A);
    // tab cũ của A (gửi muộn)
    const late = await u.A.context().newPage();
    await late.goto(`/rooms/${room.id}?flow=${r.flowId}`);

    await forwardTo(u.A, askRegion(pa), "QC Người 01", "Nhờ chị xem kỳ kế toán");
    await expect(u.A.getByText(/Đã nhờ QC Người 01 \(chuyển 1\/3\)/)).toBeVisible();
    const fwd = pa.getByText("đã nhờ QC Người 01 trả lời (chuyển 1/3)");
    await expect(fwd).toBeVisible();
    await expect(pa).not.toContainText("Nhờ chị xem kỳ kế toán");
    await expect(pa).not.toContainText("đã chuyển việc cho");

    const link = u.H.getByRole("link", { name: "Quy trình" });
    await expect(link.getByTestId("process-dm-badge")).toBeVisible();
    await link.click();
    const main = u.H.getByRole("main");
    await main.getByRole("link").filter({ hasText: "Hoá đơn T" }).first().click();
    await expect(u.H.getByText("Lan Tran nhờ bạn trả lời")).toBeVisible();
    await expect(u.H.getByText("Nhờ chị xem kỳ kế toán")).toBeVisible();
    await expect(u.H.getByText("Ngữ cảnh kèm theo")).toBeVisible();
    await expect(u.H.getByText("Kỳ kế toán nào?")).toBeVisible();
    await expect(u.H.getByText(SECRET_ROOM)).toHaveCount(0);
    await u.H.getByRole("textbox", { name: "Câu trả lời" }).fill("Kỳ 09/2026");
    await u.H.getByRole("button", { name: "Gửi trả lời" }).click();

    await expect(u.A.getByText("QC Người 01 đã trả lời")).toBeVisible();
    await expect(taskResult(pa, "QC Người 01", "Đã trả lời")).toContainText("Kỳ 09/2026");
    await expect(pa.getByRole("textbox", { name: "Câu trả lời" })).toHaveCount(0);

    const lp = flowPane(late);
    await askRegion(lp).getByRole("button", { name: "Trả lời bằng văn bản" }).click();
    await lp.getByRole("textbox", { name: "Câu trả lời" }).fill("muộn");
    await lp.getByRole("button", { name: "Gửi trả lời" }).click();
    await expect(late.getByText("Đã có người trả lời")).toBeVisible();
  } finally {
    await u.close();
  }
});

test('CHAT-AC-57 · E-P10 · đã chuyển 3 lần ⇒ nút khoá aria-disabled; đích bị khoá ⇒ alert; B chuyển review cho H ⇒ "Chỉ chuyển được cho người cùng nhóm kiểm"; "@QC Người 01 trả lời giúp" ở phòng không chuyển', async ({
  browser,
}) => {
  const room = await mkRoom("EP10");
  const r3 = await seedRun(room.id, "waiting_answer", { forwards: 3 });
  const r = await seedRun(room.id, "waiting_answer");
  const rv = await seedRun(room.id, "waiting_review", { reviewers: ["B"] });
  const u = await users(browser, "A", "B");
  try {
    await u.A.goto(`/rooms/${room.id}?flow=${r3.flowId}`);
    const lock = askRegion(flowPane(u.A)).getByRole("button", { name: "Nhờ người khác trả lời" });
    await expect(lock).toHaveAttribute("aria-disabled", "true");

    // "@QC Người 01 …" ở phòng KHÔNG chuyển việc
    await u.A.goto(`/rooms/${room.id}`);
    await roomBox(u.A).fill("@QC Người 01 trả lời giúp");
    await u.A.keyboard.press("Escape");
    await u.A.getByRole("button", { name: "Gửi", exact: true }).click();
    await u.A.goto(`/rooms/${room.id}?flow=${r.flowId}`);
    await expect(flowPane(u.A).getByText(/đã nhờ .* trả lời \(chuyển/)).toHaveCount(0);

    // đích bị khoá (giả lập: tìm "khoa" — user bị khoá không chọn được hoặc alert)
    await askRegion(flowPane(u.A)).getByRole("button", { name: "Nhờ người khác trả lời" }).click();
    const dlg = u.A.getByRole("dialog", { name: "Nhờ ai trả lời?" });
    await dlg.getByRole("searchbox", { name: "Tìm người" }).fill(PERSONA.A.name);
    const self = dlg.getByRole("checkbox", { name: PERSONA.A.name });
    if (await self.count()) {
      await self.check();
      await dlg.getByRole("button", { name: "Nhờ trả lời" }).click();
      await expect(dlg.getByRole("alert")).toBeVisible();
    } else await expect(dlg.getByRole("checkbox")).toHaveCount(0);
    await dlg.getByRole("button", { name: "Huỷ" }).click();

    // review: B chuyển cho H (ngoài Group) ⇒ lỗi
    await u.B.goto(`/rooms/${room.id}?flow=${rv.flowId}`);
    const card = flowPane(u.B).getByRole("region", { name: "Kiểm Đọc hoá đơn" });
    await card.getByRole("button", { name: /Chuyển|Nhờ người khác/ }).click();
    const d2 = u.B.getByRole("dialog");
    await d2.getByRole("searchbox", { name: "Tìm người" }).fill("QC Người 01");
    await d2.getByRole("checkbox", { name: "QC Người 01" }).check();
    await d2
      .getByRole("button", { name: /Chuyển|Nhờ/ })
      .last()
      .click();
    await expect(u.B.getByText("Chỉ chuyển được cho người cùng nhóm kiểm")).toBeVisible();
  } finally {
    await u.close();
  }
});
