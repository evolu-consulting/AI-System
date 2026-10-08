// HUB-FR-101 · HUB-FR-103 · X2b-AC01/02/05/06/08/13/15/16 · e2e E-A1…E-A8 (test-plan-e2e.md; nhãn nguyên văn
// `plan-frontend-e2e.md` §1–§2). Hub THẬT + Runtime giả (stack `_x2b-stack.ts`). A = lan (hoadon, trello) · B = thu (trello)
// · C = an (hoadon). Chưa có UI ⇒ đỏ ở locator/expect (không ở dựng stack/seed).
import { expect, test } from "@playwright/test";
import {
  agentBlock,
  agentMenu,
  answer,
  badgeOf,
  flowBox,
  flowPane,
  hub,
  invokeUi,
  mkRoom,
  pendConfirm,
  roomBox,
  roomLog,
  rt,
  SECRET,
  sendFlow,
  sendRoom,
  setGrant,
  settleRuns,
  threeUsers,
  token,
  USER_ID,
  working,
} from "./_x2b-support";

test.afterEach(() => settleRuns());

test('HUB-FR-103 · X2b-AC13 · E-A1 · gõ "@" ⇒ listbox "Agent" đúng quyền (A 2, B 1); chọn ⇒ "@hoadon "; không panel/chip agent', async ({
  browser,
}) => {
  const room = await mkRoom("EA1");
  const u = await threeUsers(browser);
  try {
    await u.pa.goto(`/rooms/${room.id}`);
    await roomBox(u.pa).fill("@");
    await expect(agentMenu(u.pa)).toBeVisible();
    await expect(u.pa.getByText("Agent bạn dùng được")).toBeVisible();
    const opts = agentMenu(u.pa).getByRole("option");
    await expect(opts).toHaveCount(2);
    await expect(opts.filter({ hasText: "@hoadon" })).toHaveCount(1);
    await expect(opts.filter({ hasText: "@trello" })).toHaveCount(1);
    await opts.filter({ hasText: "@hoadon" }).click();
    await expect(roomBox(u.pa)).toHaveValue("@hoadon ");
    // AC13: không panel/chip liệt kê agent ngoài menu `@` (khung flow chưa mở ⇒ không `complementary`)
    await expect(u.pa.getByRole("complementary")).toHaveCount(0);

    await u.pb.goto(`/rooms/${room.id}`);
    await roomBox(u.pb).fill("@");
    await expect(agentMenu(u.pb).getByRole("option")).toHaveCount(1);
    await expect(agentMenu(u.pb).getByRole("option")).toContainText("@trello");
    await expect(u.pb.getByRole("complementary")).toHaveCount(0);
  } finally {
    await u.close();
  }
});

test('HUB-FR-103 · X2b-AC13 · E-A2 · thu hồi "trello" của B ⇒ B mở lại phòng, gõ "@" ⇒ không còn option', async ({
  browser,
}) => {
  const room = await mkRoom("EA2");
  const u = await threeUsers(browser);
  try {
    await u.pb.goto(`/rooms/${room.id}`);
    await roomBox(u.pb).fill("@");
    await expect(agentMenu(u.pb).getByRole("option")).toHaveCount(1);
    await setGrant("trello", USER_ID.thu, false);
    const tb = await token("thu");
    await expect
      .poll(async () => (await hub(tb, "GET", "/agents")).json?.items?.length, { timeout: 15_000 })
      .toBe(0);
    await u.pb.goto(`/rooms/${room.id}`);
    await roomBox(u.pb).fill("@");
    await expect(agentMenu(u.pb).getByRole("option")).toHaveCount(0);
    await expect(u.pb.getByText("Bạn chưa được cấp agent nào")).toBeVisible();
  } finally {
    await setGrant("trello", USER_ID.thu, true);
    await u.close();
  }
});

test('X2b-AC01 · X2b-AC16 · E-A3 · A "@hoadon kiểm tra": A thấy "Dừng"; B thấy "hoadon đang xử lý…" rồi khối "Lan Tran hỏi"; huy hiệu B +2, A không', async ({
  browser,
}) => {
  const room = await mkRoom("EA3");
  const u = await threeUsers(browser);
  try {
    await u.pa.goto(`/rooms/${room.id}`);
    await u.pb.goto(`/rooms/${room.id}`);
    const { runId } = await invokeUi(u.pa, "@hoadon kiểm tra");
    await expect(u.pa.getByRole("button", { name: "Dừng" })).toBeVisible();
    await expect(working(u.pb)).toBeVisible();
    await expect(u.pb.getByRole("button", { name: "Dừng" })).toHaveCount(0);
    await expect(u.pb.getByText("Chỉ Lan Tran dừng được")).toBeVisible();
    await answer(runId, "HD-12 hợp lệ.");
    for (const p of [u.pa, u.pb]) {
      await expect(agentBlock(p)).toContainText("HD-12 hợp lệ.");
      await expect(working(p)).toHaveCount(0);
    }
    await expect(agentBlock(u.pa)).toContainText("Bạn hỏi");
    await expect(agentBlock(u.pb)).toContainText("Lan Tran hỏi");
    await expect(agentBlock(u.pb)).toContainText("Chạy bằng quyền của Lan Tran");
    // huy hiệu: B rời phòng, lượt 2 của A ⇒ tin gọi + khối agent = +2; A đang ở trong phòng ⇒ không huy hiệu
    await u.pb.goto("/c/new");
    const second = await invokeUi(u.pa, "@hoadon kiểm tra lần hai");
    await answer(second.runId, "HD-13 hợp lệ.");
    await expect(badgeOf(u.pb, room.name)).toHaveText("2", { timeout: 10_000 });
    await expect(badgeOf(u.pa, room.name)).toHaveCount(0);
  } finally {
    await u.close();
  }
});

test('X2b-AC02 · E-A4 · B "@hoadon …" (không có quyền) ⇒ alert "Không tìm thấy agent @hoadon.", ô giữ chữ, A không thấy tin mới', async ({
  browser,
}) => {
  const room = await mkRoom("EA4");
  const u = await threeUsers(browser);
  try {
    await u.pa.goto(`/rooms/${room.id}`);
    await u.pb.goto(`/rooms/${room.id}`);
    const text = "@hoadon kiểm tra chui";
    const s = await sendRoom(u.pb, text);
    expect(s.runId).toBeNull();
    await expect(
      u.pb.getByRole("alert").filter({ hasText: "Không tìm thấy agent @hoadon." }),
    ).toBeVisible();
    await expect(roomBox(u.pb)).toHaveValue(text);
    await expect(roomLog(u.pb).getByRole("article").filter({ hasText: text })).toHaveCount(0);
    await expect(roomLog(u.pa).getByRole("article").filter({ hasText: text })).toHaveCount(0);
    await expect(u.pa.getByRole("status").filter({ hasText: "đang xử lý…" })).toHaveCount(0);
  } finally {
    await u.close();
  }
});

test('X2b-AC05 · E-A5 · need_input: A thấy chip, bấm ⇒ tin trong flow kèm answer_run_id; B thấy câu hỏi, không chip, "Đang chờ Lan Tran trả lời agent."', async ({
  browser,
}) => {
  const room = await mkRoom("EA5");
  const u = await threeUsers(browser);
  try {
    await u.pa.goto(`/rooms/${room.id}`);
    await u.pb.goto(`/rooms/${room.id}`);
    const { runId } = await invokeUi(u.pa, "@hoadon kiểm tra hoá đơn");
    await rt("answer", runId, {
      status: "need_input",
      question: "Số hoá đơn nào?",
      choices: ["HD-12", "HD-13"],
    });
    const ask = u.pa.getByRole("region", { name: /hoadon cần thêm thông tin/ });
    await expect(ask).toBeVisible();
    await expect(u.pb.getByText("Số hoá đơn nào?").first()).toBeVisible();
    await expect(u.pb.getByRole("region", { name: /cần thêm thông tin/ })).toHaveCount(0);
    await expect(u.pb.getByRole("button", { name: "HD-12", exact: true })).toHaveCount(0);
    await expect(u.pb.getByText("Đang chờ Lan Tran trả lời agent.")).toBeVisible();
    const req = u.pa.waitForRequest(
      (r) => r.method() === "POST" && /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
    );
    await ask.getByRole("button", { name: "HD-12", exact: true }).click();
    const body = (await req).postDataJSON() as { answer_run_id?: string; flow_id?: string };
    expect(body.answer_run_id).toBe(runId);
    expect(body.flow_id).toBeTruthy();
    await expect(flowPane(u.pa).getByText("HD-12").first()).toBeVisible();
  } finally {
    await u.close();
  }
});

test('X2b-AC06 · E-A6 · side_effect: A thấy "Đồng ý"/"Huỷ"; B chỉ thấy "Đang chờ Lan Tran xác nhận…", DOM B không có mô tả hành động', async ({
  browser,
}) => {
  const room = await mkRoom("EA6");
  const u = await threeUsers(browser);
  try {
    await u.pa.goto(`/rooms/${room.id}`);
    await u.pb.goto(`/rooms/${room.id}`);
    const { runId } = await invokeUi(u.pa, "@hoadon tạo thẻ thanh toán");
    await rt("claim", runId);
    await pendConfirm(runId, USER_ID.lan);
    await answer(runId, `Xác nhận tạo thẻ ${SECRET} trên bảng Kế toán?`);
    const ask = u.pa.getByRole("region", { name: /hoadon cần bạn xác nhận/ });
    await expect(ask.getByRole("button", { name: "Đồng ý" })).toBeVisible();
    await expect(ask.getByRole("button", { name: "Huỷ" })).toBeVisible();
    const wait = u.pb.getByRole("article", { name: "Agent hoadon đang chờ xác nhận" });
    await expect(wait).toContainText("Đang chờ Lan Tran xác nhận — chỉ người hỏi mới bấm được.");
    await expect(u.pb.getByRole("button", { name: "Đồng ý" })).toHaveCount(0);
    expect(await u.pb.content()).not.toContain(SECRET);
  } finally {
    await u.close();
  }
});

test('X2b-AC15 · E-A7 · "Trả lời tiếp" ⇒ ?flow=, complementary "Flow đang mở", gửi trong flow; 390px ⇒ dialog', async ({
  browser,
}) => {
  const room = await mkRoom("EA7");
  const u = await threeUsers(browser);
  try {
    await u.pa.goto(`/rooms/${room.id}`);
    const { runId } = await invokeUi(u.pa, "@hoadon kiểm tra");
    await answer(runId, "HD-12 hợp lệ.");
    await expect(agentBlock(u.pa)).toContainText("HD-12 hợp lệ.");
    await agentBlock(u.pa).getByRole("button", { name: "Trả lời tiếp" }).click();
    await expect(u.pa).toHaveURL(/[?&]flow=[0-9a-f-]{36}/);
    await expect(flowPane(u.pa)).toBeVisible();
    await sendFlow(u.pa, "Còn hoá đơn HD-13 thì sao?");
    await expect(flowPane(u.pa).getByText("Còn hoá đơn HD-13 thì sao?")).toBeVisible();
    await u.pa.setViewportSize({ width: 390, height: 800 });
    await u.pa.reload();
    await expect(u.pa.getByRole("dialog", { name: "Flow đang mở" })).toBeVisible();
    await expect(u.pa.getByRole("button", { name: "Đóng khung flow" })).toBeVisible();
    await expect(flowBox(u.pa)).toBeVisible();
  } finally {
    await u.close();
  }
});

test('X2b-AC08 · E-A8 · A đầy max_concurrent_runs ⇒ alert đếm ngược trong ô A; B "@trello" chạy bình thường, B không thấy lỗi của A', async ({
  browser,
}) => {
  const room = await mkRoom("EA8");
  const u = await threeUsers(browser);
  try {
    await u.pa.goto(`/rooms/${room.id}`);
    await u.pb.goto(`/rooms/${room.id}`);
    await invokeUi(u.pa, "@hoadon việc một");
    await invokeUi(u.pa, "@hoadon việc hai");
    const third = "@hoadon việc ba";
    const s = await sendRoom(u.pa, third);
    expect(s.runId).toBeNull();
    const alert = u.pa.getByRole("alert").filter({ hasText: /quá nhiều câu trả lời đang chạy/ });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/Thử lại sau \d+ giây/);
    await expect(roomBox(u.pa)).toHaveValue(third);
    const b = await invokeUi(u.pb, "@trello tạo thẻ mới");
    expect(b.runId).toBeTruthy();
    await expect(u.pb.getByRole("alert").filter({ hasText: /quá nhiều/ })).toHaveCount(0);
  } finally {
    await u.close();
  }
});
