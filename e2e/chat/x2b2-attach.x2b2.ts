// HUB-FR-44 · HUB-FR-101 · X2b2-AC15 (+ AC01, AC02, AC06, AC10) · e2e E01–E08 (test-plan X2b2 §5; role + nhãn nguyên văn
// `plan-frontend.md` §3, §5; câu lỗi C1 `attach.err.*`). Hub THẬT + kho đính kèm local + Runtime giả (`_x2b2-stack.ts`).
// A = lan "Lan Tran" (hoadon) · B = thu "Thu Ha" (không hoadon). Chưa có UI ⇒ đỏ ở locator `button "Đính kèm tệp"` trong
// composer phòng (không ở dựng stack/seed). Chờ theo `waitForResponse`/locator, không `waitForTimeout`.
import { expect, type Page, test } from "@playwright/test";
import {
  apiDm,
  apiGroup,
  chatLogin,
  hub,
  NAMES,
  roomComposer,
  roomLog,
  token,
  twoUsers,
  USER_ID,
  uniq,
} from "./_x2a-support";
import { agentBlock, answer, settleRuns, working } from "./_x2b-support";

test.afterEach(() => settleRuns());

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.x2b2.config đặt)
const RT = process.env.X2B_RT_URL ?? "http://localhost:4059";
const B_NAME = NAMES.thu;
const PDF = (name: string, n = 4096) => {
  const b = Buffer.alloc(n, 0x41);
  b.write("%PDF-1.7\n", 0, "latin1");
  return { name, mimeType: "application/pdf", buffer: b };
};
const attachBtn = (p: Page) => p.getByRole("button", { name: "Đính kèm tệp" });
const chips = (p: Page) => p.getByRole("list", { name: "Tệp đính kèm" });
const inMsg = (p: Page) => roomLog(p).getByRole("list", { name: "Tệp trong tin" });
const sendBtn = (p: Page) => p.getByRole("button", { name: "Gửi", exact: true });
const note = (p: Page) => p.getByRole("note");

/** Đỏ ở `expect` (composer phòng chưa có nút đính kèm) thay vì treo ở `setInputFiles`. */
async function attach(p: Page, files: Parameters<Page["setInputFiles"]>[1]): Promise<void> {
  await expect(attachBtn(p)).toBeVisible();
  await p.locator('input[type="file"]').first().setInputFiles(files);
}
/** Gõ + Gửi ở composer `target`; chờ POST tin phòng → header run. */
async function send(p: Page, target: string, text: string) {
  await roomComposer(p, target).fill(text);
  const resp = p.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname),
  );
  await sendBtn(p).click();
  const r = await resp;
  return { status: r.status(), runId: r.headers()["x-run-id"] ?? null };
}
async function download(p: Page, name: string): Promise<string> {
  const dl = p.waitForEvent("download");
  await inMsg(p)
    .getByRole("button", { name: `Tải ${name}` })
    .last()
    .click();
  return (await dl).suggestedFilename();
}
/** Runtime giả: agent ghi `out/<name>` (`/rt/output`). */
async function rtOutput(runId: string, name: string, bytes: string): Promise<void> {
  const r = await fetch(`${RT}/rt/output`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId, name, bytes }),
  });
  expect(r.status, await r.clone().text()).toBe(200);
}
const dmRoom = async () => apiDm(await token("lan"), USER_ID.thu);
const groupRoom = async (name: string) => {
  const n = uniq(name);
  return { id: await apiGroup(await token("lan"), n, [USER_ID.thu]), name: n };
};

test("HUB-FR-44 · X2b2-AC15 · E01 · DM: bấm 'Đính kèm tệp' chọn hoadon.pdf ⇒ 1 chip, hết 'Đang tải lên…', note '<B> sẽ xem và tải được tệp này'", async ({
  browser,
}) => {
  const dm = await dmRoom();
  const u = await twoUsers(browser);
  try {
    await u.pa.goto(`/rooms/${dm}`);
    await attach(u.pa, PDF("hoadon.pdf"));
    await expect(chips(u.pa).getByRole("listitem")).toHaveCount(1);
    await expect(chips(u.pa).getByText("Đang tải lên…")).toHaveCount(0);
    await expect(
      note(u.pa).filter({ hasText: `${B_NAME} sẽ xem và tải được tệp này` }),
    ).toBeVisible();
  } finally {
    await u.close();
  }
});

test("HUB-FR-44 · X2b2-AC15 · E02 · ô trống có chip ⇒ 'Gửi' disabled + note 'Nhập nội dung tin để gửi kèm tệp.'", async ({
  browser,
}) => {
  const dm = await dmRoom();
  const u = await twoUsers(browser);
  try {
    await u.pa.goto(`/rooms/${dm}`);
    await attach(u.pa, PDF("hoadon.pdf"));
    await expect(chips(u.pa).getByRole("listitem")).toHaveCount(1);
    await expect(sendBtn(u.pa)).toBeDisabled();
    await expect(note(u.pa).filter({ hasText: "Nhập nội dung tin để gửi kèm tệp." })).toBeVisible();
  } finally {
    await u.close();
  }
});

test("HUB-FR-44 · X2b2-AC15 · X2b2-AC01 · E03 · A gửi 'đây là hoá đơn' + tệp ⇒ A thấy 'Tải hoadon.pdf'; B (không tải lại) thấy chip và tải được", async ({
  browser,
}) => {
  const dm = await dmRoom();
  const u = await twoUsers(browser);
  try {
    await u.pa.goto(`/rooms/${dm}`);
    await u.pb.goto(`/rooms/${dm}`);
    await expect(roomComposer(u.pb, NAMES.lan)).toBeVisible();
    await attach(u.pa, PDF("hoadon.pdf"));
    await expect(chips(u.pa).getByText("Đang tải lên…")).toHaveCount(0);
    expect((await send(u.pa, B_NAME, "đây là hoá đơn")).status).toBe(201);
    await expect(inMsg(u.pa).getByRole("button", { name: "Tải hoadon.pdf" }).last()).toBeVisible();
    await expect(inMsg(u.pb).getByRole("button", { name: "Tải hoadon.pdf" }).last()).toBeVisible();
    expect(await download(u.pb, "hoadon.pdf")).toBe("hoadon.pdf");
  } finally {
    await u.close();
  }
});

test("HUB-FR-101 · X2b2-AC15 · X2b2-AC06 · E04 · nhóm: tệp rồi '@hoadon kiểm tra file' ⇒ 'đang xử lý'; B thấy trả lời agent", async ({
  browser,
}) => {
  const g = await groupRoom("Nhóm E04");
  const u = await twoUsers(browser);
  try {
    await u.pa.goto(`/rooms/${g.id}`);
    await u.pb.goto(`/rooms/${g.id}`);
    await attach(u.pa, PDF("hoadon.pdf"));
    await expect(chips(u.pa).getByText("Đang tải lên…")).toHaveCount(0);
    expect((await send(u.pa, "nhóm", "đây là hoá đơn")).status).toBe(201);
    const s = await send(u.pa, "nhóm", "@hoadon kiểm tra file");
    expect(s.runId, "POST tin có tag phải trả X-Run-Id").toBeTruthy();
    await expect(working(u.pa)).toBeVisible();
    await answer(s.runId as string, "Hoá đơn hợp lệ.");
    await expect(agentBlock(u.pb).filter({ hasText: "Hoá đơn hợp lệ." })).toBeVisible();
  } finally {
    await u.close();
  }
});

test("HUB-FR-101 · X2b2-AC15 · X2b2-AC10 · E05 · '@hoadon xem' + out/report.md ⇒ trả lời agent có 'Tải report.md'; B tải được", async ({
  browser,
}) => {
  const g = await groupRoom("Nhóm E05");
  const u = await twoUsers(browser);
  try {
    await u.pa.goto(`/rooms/${g.id}`);
    await u.pb.goto(`/rooms/${g.id}`);
    const s = await send(u.pa, "nhóm", "@hoadon xem");
    expect(s.runId, "POST tin có tag phải trả X-Run-Id").toBeTruthy();
    await rtOutput(s.runId as string, "report.md", "# Báo cáo\n\nHoá đơn hợp lệ.\n");
    await answer(s.runId as string, "Đã ghi báo cáo.");
    const block = agentBlock(u.pa).filter({ hasText: "Đã ghi báo cáo." });
    await expect(
      block
        .getByRole("list", { name: "Tệp trong tin" })
        .getByRole("button", { name: "Tải report.md" }),
    ).toBeVisible();
    await expect(agentBlock(u.pb).getByRole("button", { name: "Tải report.md" })).toBeVisible();
    expect(await download(u.pb, "report.md")).toBe("report.md");
  } finally {
    await u.close();
  }
});

test("HUB-FR-44 · X2b2-AC15 · E06 · nhóm: có chip ⇒ note 'Mọi thành viên của nhóm đều xem và tải được tệp này'", async ({
  page,
}) => {
  const g = await groupRoom("Nhóm E06");
  await chatLogin(page, "lan");
  await page.goto(`/rooms/${g.id}`);
  await expect(note(page)).toHaveCount(0);
  await attach(page, PDF("hoadon.pdf"));
  await expect(
    note(page).filter({ hasText: "Mọi thành viên của nhóm đều xem và tải được tệp này" }),
  ).toBeVisible();
});

test("HUB-FR-44 · X2b2-AC15 · E07 · .exe ⇒ 'Loại tệp không được hỗ trợ.'; 20 MB + 1 B ⇒ 'Tệp lớn hơn 20 MB.' (câu C1)", async ({
  page,
}) => {
  const g = await groupRoom("Nhóm E07");
  await chatLogin(page, "lan");
  await page.goto(`/rooms/${g.id}`);
  await attach(page, {
    name: "cai-dat.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0]),
  });
  await expect(page.getByText("Loại tệp không được hỗ trợ.")).toBeVisible();
  await attach(page, PDF("lon.pdf", 20 * 1_048_576 + 1));
  await expect(page.getByText("Tệp lớn hơn 20 MB.")).toBeVisible();
});

test("HUB-BR-22 · X2b2-AC02 · E08 · A bớt B khỏi nhóm ⇒ B thấy toast 'Bạn không còn trong nhóm \"<tên>\"' và về /c/new", async ({
  browser,
}) => {
  const g = await groupRoom("Nhóm E08");
  const u = await twoUsers(browser);
  try {
    await u.pa.goto(`/rooms/${g.id}`);
    await attach(u.pa, PDF("hoadon.pdf"));
    await expect(chips(u.pa).getByText("Đang tải lên…")).toHaveCount(0);
    expect((await send(u.pa, "nhóm", "tệp cho nhóm E08")).status).toBe(201);
    await u.pb.goto(`/rooms/${g.id}`);
    await expect(inMsg(u.pb).getByRole("button", { name: "Tải hoadon.pdf" }).last()).toBeVisible();
    const r = await hub(await token("lan"), "DELETE", `/rooms/${g.id}/members/${USER_ID.thu}`);
    expect(r.status).toBe(204);
    await expect(u.pb.getByText(`Bạn không còn trong nhóm "${g.name}"`)).toBeVisible();
    await expect(u.pb).toHaveURL(/\/c\/new$/);
  } finally {
    await u.close();
  }
});
