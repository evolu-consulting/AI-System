// HUB-FR-124 · AC-H37 · HUB-FR-122 · PB-R05/R13 · e2e P-b · chat-web: form `!key` có `inputs`, chip nguồn ở AskCard, lý do
// `source_unresolvable` (test-plan §4.6 E-PB10, E-PB11, E-PB13; nhãn nguyên văn plan-frontend.md §5–§6 + i18n §5). Hub THẬT +
// Runtime giả: stage (`_pa-runtime.ts`: hold/ask/done) + `source.resolve` (`_pb-runtime.ts`, `bad-*` ⇒ SOURCE_UNRESOLVABLE).
import { expect, type Page, test } from "@playwright/test";
import { roomComposer } from "../../chat/_x2a-support";
import { rtLog, users } from "../../P-a/_pa-support";
import { FAKE_SHA } from "../_pb-runtime";
import { DEF, hub, latestRun, mkRoom, rtScript, SRC, seedPb, settle, tok } from "../_pb-support";

test.beforeAll(() => seedPb());
test.afterEach(() => settle());

const box = (p: Page) => roomComposer(p, "nhóm");
const form = (p: Page) =>
  p.getByRole("dialog", { name: `Thông tin cho quy trình ${DEF.run.name}` });
const flowPane = (p: Page) => p.getByRole("complementary", { name: "Flow đang mở" });
const send = (p: Page) => p.getByRole("button", { name: "Gửi", exact: true });
/** Phòng: chỉ đường "nút Quy trình → chọn dòng → Gửi" (arm) mới đi POST /process-runs; gõ tay `!key` là tin thường (T1/E-P3). */
async function pickAndSend(p: Page, key: string): Promise<void> {
  await p.getByRole("button", { name: "Quy trình", exact: true }).click();
  await p
    .getByRole("listbox", { name: "Quy trình" })
    .getByRole("option")
    .filter({ hasText: `!${key}` })
    .click();
  await expect(box(p)).toHaveValue(`!${key} `);
  await send(p).click();
}

test('HUB-FR-124 · AC-H37 · E-PB10 · "!pb-run …" ⇒ form "Thông tin cho quy trình …" (bộ chọn nguồn + nhánh điền sẵn, ô ghi chú); Huỷ giữ chữ ở composer; Bắt đầu ⇒ POST /process-runs mang inputs, run bắt đầu và ghim nguồn', async ({
  browser,
}) => {
  const room = await mkRoom("EPB10");
  await rtScript(DEF.run.key, 0, [{ kind: "hold" }]);
  const prevId = (await latestRun(DEF.run.key))?.id ?? null;
  const u = await users(browser, "A");
  const p = u.A;
  try {
    await p.goto(`/rooms/${room.id}`);
    await pickAndSend(p, DEF.run.key);
    const f = form(p);
    await expect(f).toBeVisible();
    await f.getByRole("button", { name: "Huỷ", exact: true }).click();
    await expect(f).toHaveCount(0);
    await expect(box(p)).toHaveValue(`!${DEF.run.key} `);
    expect((await latestRun(DEF.run.key))?.id ?? null, "Huỷ form không tạo run").toBe(prevId);

    await box(p).fill("");
    await pickAndSend(p, DEF.run.key);
    await expect(f).toBeVisible();
    // bộ chọn nguồn là <select> gốc (role combobox), mỗi dòng "key — mô tả"
    await f
      .getByRole("combobox", { name: `${DEF.run.inputLabel} · Nguồn` })
      .selectOption(SRC.app.key);
    const branch = f.getByRole("textbox", { name: `${DEF.run.inputLabel} · Nhánh (branch)` });
    await expect(branch).toHaveValue("main");
    await branch.fill("release");
    await f.getByRole("textbox", { name: DEF.run.textLabel }).fill("Kiểm module thanh toán");

    const req = p.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === "/process-runs",
    );
    await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
    const body = JSON.parse((await req).postData() ?? "{}");
    expect(body.process_key).toBe(DEF.run.key);
    expect(body.inputs).toEqual(
      expect.arrayContaining([
        { type: "source_ref", key: "repo", source_key: SRC.app.key, branch: "release" },
        { type: "text", key: "ghi-chu", text: "Kiểm module thanh toán" },
      ]),
    );
    await expect(f).toHaveCount(0);

    await expect
      .poll(async () => {
        const r = await latestRun(DEF.run.key);
        return r && r.id !== prevId ? r.id : null;
      })
      .not.toBeNull();
    const run = await latestRun(DEF.run.key);
    expect(JSON.stringify(run?.inputs)).toContain("release");
    // HUB-FR-122: Hub resolve + ghim trước khi chạy giai đoạn 0
    await expect
      .poll(async () => JSON.stringify((await latestRun(DEF.run.key))?.pinned ?? null), {
        timeout: 20_000,
      })
      .toContain(FAKE_SHA);
  } finally {
    await u.close();
  }
});

test("HUB-FR-124 · AC-H37 · PB-R13 · E-PB11 · bỏ trống trường bắt buộc vẫn bắt đầu; agent hỏi ⇒ AskCard có chip nguồn đã đăng ký (title = mô tả); bấm chip ⇒ trả lời", async ({
  browser,
}) => {
  const room = await mkRoom("EPB11");
  const prevId = (await latestRun(DEF.run.key))?.id ?? null;
  await rtScript(DEF.run.key, 0, [
    { kind: "ask", question: "Dùng kho nào?", choices: [SRC.app.key, "09/2026"] },
    { kind: "hold" },
  ]);
  const u = await users(browser, "A");
  const p = u.A;
  try {
    await p.goto(`/rooms/${room.id}`);
    await pickAndSend(p, DEF.run.key);
    const f = form(p);
    await expect(f).toBeVisible();
    // không chọn nguồn (trường bắt buộc để trống) — form nhẹ tay vẫn cho bắt đầu
    await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
    await expect(f).toHaveCount(0);
    await expect
      .poll(async () => {
        const r = await latestRun(DEF.run.key);
        return r && r.id !== prevId ? r.id : null;
      })
      .not.toBeNull();
    const run = await latestRun(DEF.run.key);

    await p.goto(`/rooms/${room.id}?flow=${run?.flow_id}`);
    const ask = flowPane(p).getByRole("region", { name: /cần thêm thông tin · lần hỏi 1\/3$/ });
    await expect(ask).toContainText("Dùng kho nào?");
    const chip = ask.getByRole("button", { name: SRC.app.key, exact: true });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("title", new RegExp(SRC.app.description));
    await chip.click();
    await expect(flowPane(p).getByRole("article", { name: /Bạn · Đã trả lời · /i })).toContainText(
      SRC.app.key,
    );
    await expect(ask).toHaveCount(0);
  } finally {
    await u.close();
  }
});

test('HUB-FR-122 · PB-R05 · E-PB13 · nguồn không đọc được lúc bắt đầu ⇒ run "Cần người quyết" với lý do "Không đọc được nguồn tham chiếu" + nút làm lại/huỷ; giai đoạn 0 chưa chạy agent', async ({
  browser,
}) => {
  const room = await mkRoom("EPB13");
  const start = await hub(await tok("A"), "POST", "/process-runs", {
    process_key: DEF.bad.key,
    input: "Kiểm kho hỏng",
    origin: { kind: "room", room_id: room.id },
  });
  expect(start.status, JSON.stringify(start.json)).toBe(201);
  await expect.poll(async () => (await latestRun(DEF.bad.key))?.flow_id ?? null).not.toBeNull();
  const run = await latestRun(DEF.bad.key);
  const u = await users(browser, "A");
  const p = u.A;
  try {
    await p.goto(`/rooms/${room.id}?flow=${run?.flow_id}`);
    const reg = flowPane(p).getByRole("region", { name: "Cần người quyết" });
    await expect(reg).toBeVisible({ timeout: 20_000 });
    expect((await latestRun(DEF.bad.key))?.decision?.reason).toBe("source_unresolvable");
    await expect(flowPane(p)).toContainText("Không đọc được nguồn tham chiếu");
    await expect(flowPane(p)).toContainText(
      "Một nguồn (kho Git, đường dẫn hoặc tài liệu) không đọc được lúc bắt đầu.",
    );
    await expect(reg.getByRole("button", { name: "Thêm 1 lần làm lại" })).toBeVisible();
    await expect(reg.getByRole("button", { name: "Huỷ lượt chạy" })).toBeVisible();
    expect((await latestRun(DEF.bad.key))?.status).toBe("needs_decision");
    const ran = (await rtLog()).filter((e) => e.process_run_id === run?.id);
    expect(ran, "giai đoạn 0 không được chạy agent khi nguồn không đọc được").toHaveLength(0);

    await reg.getByRole("button", { name: "Huỷ lượt chạy" }).click();
    await p
      .getByRole("alertdialog", { name: "Huỷ lượt chạy này?" })
      .getByRole("button", { name: "Xác nhận huỷ" })
      .click();
    await expect(flowPane(p).getByText("Đã huỷ").first()).toBeVisible();
  } finally {
    await u.close();
  }
});
