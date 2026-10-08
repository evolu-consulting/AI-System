// HUB-FR-101 · HUB-FR-103 · X2b-AC17 · AC05 · AC06 · e2e E-A9…E-A11: thread CHUNG của phòng (Q7 lần 2): mọi thành viên nhắn được;
// chỉ tag `@agent` mới chạy run, bằng quyền + quota NGƯỜI TAG; trả lời/xác nhận lượt nào chỉ người tag lượt đó (`answer_run_id`).
// A = lan (hoadon, trello) · B = thu (chỉ trello) · C = an (hoadon). Hub THẬT + Runtime giả. Nhãn: `plan-frontend-e2e.md`.
import { expect, type Page, test } from "@playwright/test";
import {
  agentBlock,
  answer,
  flowBox,
  flowPane,
  invokeUi,
  mkRoom,
  owner,
  pendConfirm,
  postRaw,
  rt,
  SECRET,
  sendFlow,
  settleRuns,
  threeUsers,
  token,
  USER_ID,
  working,
} from "./_x2b-support";

test.afterEach(() => settleRuns());

/** A gọi `@hoadon` trong phòng, Runtime trả xong; trả `flowId`. */
async function seedThread(pa: Page, roomId: string): Promise<string> {
  await pa.goto(`/rooms/${roomId}`);
  const { runId, flowId } = await invokeUi(pa, "@hoadon kiểm tra");
  await answer(runId, "HD-12 hợp lệ.");
  await expect(agentBlock(pa)).toContainText("HD-12 hợp lệ.");
  return flowId;
}
/** Mở thread từ khối agent đầu tiên. */
async function openThread(p: Page, roomId: string): Promise<void> {
  await p.goto(`/rooms/${roomId}`);
  await agentBlock(p).first().getByRole("button", { name: "Trả lời tiếp" }).click();
  await expect(flowPane(p)).toBeVisible();
}
/** Gửi trong thread và trả header run. */
async function sendTagInFlow(p: Page, text: string): Promise<string> {
  await flowBox(p).fill(text);
  const resp = p.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
  );
  await p.getByRole("button", { name: "Gửi trong flow" }).click();
  const id = (await resp).headers()["x-run-id"];
  expect(id, "tag trong thread phải trả X-Run-Id").toBeTruthy();
  return id as string;
}

test('X2b-AC17 · E-A9 · C tag "@hoadon" trong thread của A ⇒ C thấy "Dừng"; A thấy "hoadon đang xử lý…" rồi khối "An Nguyen hỏi" + "Chạy bằng quyền của An Nguyen"; usage tính C; A và C tag song song ⇒ 2 khối đang xử lý', async ({
  browser,
}) => {
  const room = await mkRoom("EA9");
  const u = await threeUsers(browser);
  const sql = owner();
  try {
    await seedThread(u.pa, room.id);
    await openThread(u.pa, room.id);
    await openThread(u.pc, room.id);
    const runC = await sendTagInFlow(u.pc, "@hoadon kiểm tra tiếp hoá đơn HD-13");
    await expect(flowPane(u.pc).getByRole("button", { name: "Dừng" })).toBeVisible();
    await expect(working(u.pa)).toBeVisible();
    await expect(u.pa.getByRole("button", { name: "Dừng" })).toHaveCount(0);
    await answer(runC, "HD-13 hợp lệ.");
    const block = flowPane(u.pa).getByRole("article", { name: "Trả lời của agent hoadon" }).last();
    await expect(block).toContainText("HD-13 hợp lệ.");
    await expect(block).toContainText("An Nguyen hỏi");
    await expect(block).toContainText("Chạy bằng quyền của An Nguyen");
    const [usage] = await sql<{ c: number; a: number }[]>`
      select coalesce(sum(input_tokens + output_tokens) filter (where user_id = ${USER_ID.an}), 0)::int as c,
             coalesce(sum(input_tokens + output_tokens) filter (where user_id = ${USER_ID.lan}), 0)::int as a
      from hub.usage_logs where run_id = ${runC}`;
    expect(usage?.c).toBeGreaterThan(0);
    expect(usage?.a).toBe(0);

    // song song: A (trong thread) và C cùng tag ⇒ 2 khối "đang xử lý" trong khung của A
    const runA2 = await sendTagInFlow(u.pa, "@hoadon việc của Lan");
    const runC2 = await sendTagInFlow(u.pc, "@hoadon việc của An");
    await expect(working(u.pa)).toHaveCount(2);
    await answer(runA2, "Xong việc của Lan.");
    await answer(runC2, "Xong việc của An.");
    await expect(working(u.pa)).toHaveCount(0);
  } finally {
    await sql.end();
    await u.close();
  }
});

test('X2b-AC17 · E-A10 · B (không có hoadon): nhắn thường trong thread OK (A, C thấy, không run); "@hoadon" ⇒ alert "Không tìm thấy agent @hoadon.", giữ chữ; flow_id lạ / của phòng khác ⇒ 404 NOT_FOUND', async ({
  browser,
}) => {
  const room = await mkRoom("EA10");
  const other = await mkRoom("EA10 phòng khác");
  const u = await threeUsers(browser);
  const sql = owner();
  try {
    await seedThread(u.pa, room.id);
    await openThread(u.pa, room.id);
    await openThread(u.pc, room.id);
    await openThread(u.pb, room.id);
    await expect(flowBox(u.pb)).toBeVisible();
    const [{ n: before }] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs`;
    await sendFlow(u.pb, "Mình xem rồi, ok nhé");
    for (const p of [u.pa, u.pb, u.pc])
      await expect(flowPane(p).getByText("Mình xem rồi, ok nhé")).toBeVisible();
    await expect(flowPane(u.pa).getByText("Thu Ha").first()).toBeVisible();
    await expect(working(u.pb)).toHaveCount(0);
    const [{ n: after }] = await sql<{ n: number }[]>`select count(*)::int as n from hub.runs`;
    expect(after).toBe(before);

    const tagged = "@hoadon kiểm tra giúp";
    await sendFlow(u.pb, tagged);
    await expect(
      u.pb.getByRole("alert").filter({ hasText: "Không tìm thấy agent @hoadon." }),
    ).toBeVisible();
    await expect(flowBox(u.pb)).toHaveValue(tagged);
    await expect(flowPane(u.pa).getByText(tagged)).toHaveCount(0);

    const tb = await token("thu");
    const lonely = await postRaw(tb, room.id, {
      content: "tin giả",
      flow_id: "a2e10000-0000-4000-8000-00000000dead",
    });
    expect(lonely.status).toBe(404);
    expect(lonely.json?.error?.code).toBe("NOT_FOUND");
    const { flowId: otherFlow } = await (async () => {
      const ta = await token("lan");
      const r = await postRaw(ta, other.id, { content: "@hoadon phòng khác" });
      return { flowId: r.headers.get("x-flow-id") ?? "" };
    })();
    expect(otherFlow).toBeTruthy();
    const cross = await postRaw(tb, room.id, { content: "tin chéo", flow_id: otherFlow });
    expect(cross.status).toBe(404);
    expect(cross.json?.error?.code).toBe("NOT_FOUND");
  } finally {
    await sql.end();
    await u.close();
  }
});

test('X2b-AC17 · X2b-AC06 · E-A11 · side_effect của lượt C: C thấy "Đồng ý"/"Huỷ" (gửi answer_run_id); A, B chỉ thấy "Đang chờ An Nguyen xác nhận…", DOM không có tham số, vẫn nhắn thường; A gửi answer_run_id của C ⇒ 403 NOT_RUN_CALLER', async ({
  browser,
}) => {
  const room = await mkRoom("EA11");
  const u = await threeUsers(browser);
  try {
    const flowId = await seedThread(u.pa, room.id);
    await openThread(u.pa, room.id);
    await openThread(u.pb, room.id);
    await openThread(u.pc, room.id);
    const runC = await sendTagInFlow(u.pc, "@hoadon tạo thẻ thanh toán");
    await rt("claim", runC);
    await pendConfirm(runC, USER_ID.an);
    await answer(runC, `Xác nhận tạo thẻ ${SECRET} trên bảng Kế toán?`);

    const confirm = flowPane(u.pc).getByRole("region", { name: /hoadon cần bạn xác nhận/ });
    await expect(confirm.getByRole("button", { name: "Đồng ý" })).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Huỷ" })).toBeVisible();
    for (const p of [u.pa, u.pb]) {
      const wait = flowPane(p).getByRole("article", { name: "Agent hoadon đang chờ xác nhận" });
      await expect(wait).toContainText("Đang chờ An Nguyen xác nhận — chỉ người hỏi mới bấm được.");
      await expect(p.getByRole("button", { name: "Đồng ý" })).toHaveCount(0);
      expect(await p.content()).not.toContain(SECRET);
    }

    // A vẫn nhắn thường trong thread
    await sendFlow(u.pa, "Mình đợi An xác nhận nhé");
    await expect(flowPane(u.pc).getByText("Mình đợi An xác nhận nhé")).toBeVisible();

    // A forge answer_run_id của lượt C ⇒ 403 NOT_RUN_CALLER
    const forged = await postRaw(await token("lan"), room.id, {
      content: "Đồng ý",
      flow_id: flowId,
      answer_run_id: runC,
    });
    expect(forged.status).toBe(403);
    expect(forged.json?.error?.code).toBe("NOT_RUN_CALLER");

    // C bấm "Đồng ý" ⇒ request mang {flow_id, answer_run_id}
    const req = u.pc.waitForRequest(
      (r) => r.method() === "POST" && /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
    );
    await confirm.getByRole("button", { name: "Đồng ý" }).click();
    const body = (await req).postDataJSON() as { answer_run_id?: string; flow_id?: string };
    expect(body.answer_run_id).toBe(runC);
    expect(body.flow_id).toBeTruthy();
  } finally {
    await u.close();
  }
});
