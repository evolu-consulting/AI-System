/// <reference lib="dom" />
// X1-AC07 · HUB-FR-44 · đính kèm trong chat-web (test-plan §2, plan-frontend §1.6). Upload/tải giả bằng `page.route`.
import { ATTACH_ALLOWED, type Attachment } from "@ai/contracts/chat";
import { expect, type Page, test } from "@playwright/test";
import { composer, login, nextSend, openConversation, resetMock } from "./_support";
import { errorBody, json, MESSAGES_GET, stripLength, UUID_A, UUID_B, UUID_C } from "./_x1-support";

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

const fileInput = (page: Page) => page.locator('input[type="file"]');
/** Đỏ ở `expect` (chưa có ô chọn tệp) thay vì treo ở `setInputFiles`. */
async function attach(
  page: Page,
  files: Parameters<ReturnType<typeof fileInput>["setInputFiles"]>[0],
): Promise<void> {
  await expect(fileInput(page)).toHaveCount(1);
  await fileInput(page).setInputFiles(files);
}
const list = (page: Page) => page.getByRole("list", { name: "Tệp đính kèm" });
const file = (name: string, size = 1024) => ({
  name,
  mimeType: "application/octet-stream",
  buffer: Buffer.alloc(size, 97),
});
const ids = [UUID_A, UUID_B, UUID_C];
/** `GET /conversations/:id/flows` (E10). */
const FLOWS_GET = /\/conversations\/[^/]+\/flows(\?|$)/;
const sendBtn = (page: Page) => page.getByRole("button", { name: "Gửi", exact: true });

type Up = { filename: string; contentType: string; raw: boolean; id: string };

/** Mock `POST /attachments`: 201 `AttachmentSchema` theo thứ tự id; ghi header/thân. `delayMs` giữ upload lại. */
async function routeUpload(
  page: Page,
  opts: { delayMs?: number; status?: number; code?: string } = {},
): Promise<Up[]> {
  const seen: Up[] = [];
  await page.route("**/attachments", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    const h = req.headers();
    const name = decodeURIComponent(h["x-filename"] ?? "");
    const buf = req.postDataBuffer();
    // Tranh chấp #1 (test-plan §7): id gán NGAY khi nhận request (trước `delay`) — upload song song (≤ 3, CR-040) không được nhận trùng id.
    const id = ids[seen.length] ?? UUID_C;
    seen.push({
      filename: name,
      contentType: h["content-type"] ?? "",
      raw: !(h["content-type"] ?? "").includes("json") && (buf?.length ?? 0) > 0,
      id,
    });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.status) {
      return route.fulfill({
        status: opts.status,
        headers: json,
        body: errorBody(opts.code ?? "INTERNAL_ERROR"),
      });
    }
    const ext = name.split(".").pop()?.toLowerCase() as keyof typeof ATTACH_ALLOWED;
    const att: Attachment = {
      id,
      filename: name,
      mime: ATTACH_ALLOWED[ext],
      size: buf?.length ?? 1,
      created_at: "2026-10-07T03:00:00.000Z",
    };
    await route.fulfill({ status: 201, headers: json, body: JSON.stringify(att) });
  });
  return seen;
}

test("X1-AC07 · chọn a.txt + b.pdf: upload thân thô, X-Filename mã hoá, Content-Type theo đuôi; list 'Tệp đính kèm' 2 listitem; 'Xoá a.txt'", async ({
  page,
}) => {
  const seen = await routeUpload(page);
  await expect(page.getByRole("button", { name: "Đính kèm tệp" })).toBeVisible();
  await attach(page, [file("a.txt"), file("b báo cáo.pdf")]);
  await expect(list(page).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Xoá a.txt" })).toBeVisible();
  expect(seen).toHaveLength(2);
  const a = seen.find((s) => s.filename === "a.txt");
  expect(a?.contentType).toBe("text/plain");
  expect(a?.raw).toBe(true);
  expect(seen.find((s) => s.filename === "b báo cáo.pdf")?.contentType).toBe("application/pdf");
});

test("X1-AC07 · Gửi disabled khi còn đang tải; sau đó body gửi có attachment_ids đúng thứ tự chọn", async ({
  page,
}) => {
  const seen = await routeUpload(page, { delayMs: 1500 });
  await attach(page, [file("a.txt"), file("b.pdf")]);
  await composer(page).fill("xem tệp");
  await expect(sendBtn(page)).toBeDisabled();
  await expect(sendBtn(page)).toBeEnabled({ timeout: 10_000 });
  const sent = nextSend(page);
  await composer(page).press("Enter");
  const body = (await sent) as { attachment_ids?: string[] };
  // Thứ tự chọn (a rồi b), không phụ thuộc thứ tự request tới mock.
  const idOf = (n: string) => seen.find((s) => s.filename === n)?.id;
  expect(new Set([idOf("a.txt"), idOf("b.pdf")]).size).toBe(2);
  expect(body.attachment_ids).toEqual([idOf("a.txt"), idOf("b.pdf")]);
});

test("X1-AC07 · x.exe: chip lỗi 'Loại tệp không được hỗ trợ.', không gọi upload", async ({
  page,
}) => {
  const seen = await routeUpload(page);
  await attach(page, [file("x.exe")]);
  await expect(page.getByText("Loại tệp không được hỗ trợ.")).toBeVisible();
  expect(seen).toHaveLength(0);
});

test("X1-AC07 · tệp rỗng 'Tệp rỗng.' và tên 201 ký tự 'Tên tệp quá dài.' bị chặn sớm", async ({
  page,
}) => {
  const seen = await routeUpload(page);
  await attach(page, [file("rong.txt", 0), file(`${"n".repeat(197)}.txt`)]);
  await expect(page.getByText("Tệp rỗng.")).toBeVisible();
  await expect(page.getByText("Tên tệp quá dài.")).toBeVisible();
  expect(seen).toHaveLength(0);
});

test("X1-AC07 · chọn 11 tệp: toast 'Tối đa 10 tệp mỗi tin.'", async ({ page }) => {
  await routeUpload(page);
  await attach(
    page,
    Array.from({ length: 11 }, (_, i) => file(`f${i}.txt`, 16)),
  );
  await expect(page.getByText("Tối đa 10 tệp mỗi tin.")).toBeVisible();
  await expect(list(page).getByRole("listitem")).toHaveCount(10);
});

test("X1-AC07 · 413 ATTACHMENT_TOO_LARGE ⇒ 'Tệp lớn hơn 20 MB.'", async ({ page }) => {
  await routeUpload(page, { status: 413, code: "ATTACHMENT_TOO_LARGE" });
  await attach(page, [file("a.txt")]);
  await expect(page.getByText("Tệp lớn hơn 20 MB.")).toBeVisible();
});

test("X1-AC07 · 409 ATTACHMENT_QUOTA_EXCEEDED ⇒ 'Đã hết dung lượng lưu tệp của công ty. Liên hệ quản trị.'", async ({
  page,
}) => {
  await routeUpload(page, { status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
  await attach(page, [file("a.txt")]);
  await expect(
    page.getByText("Đã hết dung lượng lưu tệp của công ty. Liên hệ quản trị."),
  ).toBeVisible();
});

test("X1-AC07 · lịch sử: list 'Tệp trong tin' có 'Tải a.txt' (fetch kèm Authorization); tệp đã xoá aria-disabled", async ({
  page,
}) => {
  const atts = [
    { id: UUID_A, filename: "a.txt", mime: "text/plain", size: 1024, available: true },
    { id: UUID_B, filename: "cu.pdf", mime: "application/pdf", size: 2048, available: false },
  ];
  // Tranh chấp #2 (test-plan §7): luồng chính hiển thị từ E10 `flows[].preview` (FlowBlock); E11 chỉ khi mở khung flow.
  // Vá cả hai để tin user đầu có `attachments` dù UI đọc nguồn nào.
  await page.route(FLOWS_GET, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as {
      items: { preview: { question: { attachments?: unknown[] } } }[];
    };
    const f = body.items[0];
    if (f) f.preview.question.attachments = atts;
    await route.fulfill({ status: res.status(), headers: stripLength(res.headers()), json: body });
  });
  await page.route(MESSAGES_GET, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = (await res.json()) as { items: { role: string; attachments?: unknown[] }[] };
    const first = body.items.find((m) => m.role === "user");
    if (first) first.attachments = atts;
    await route.fulfill({ status: res.status(), headers: stripLength(res.headers()), json: body });
  });
  let auth: string | undefined;
  await page.route(`**/attachments/${UUID_A}/content`, async (route) => {
    auth = route.request().headers().authorization;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "nội dung",
    });
  });
  await openConversation(page, "Soạn email báo giá Minh Phát");
  const inMsg = page.getByRole("list", { name: "Tệp trong tin" }).first();
  await expect(inMsg).toBeVisible();
  const dl = page.waitForEvent("download");
  await inMsg.getByRole("button", { name: "Tải a.txt" }).click();
  await dl;
  expect(auth).toMatch(/^Bearer .+/);
  await expect(inMsg.getByRole("button", { name: "Tải cu.pdf" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("X1-AC07 · English: nhãn đính kèm và lỗi bằng tiếng Anh", async ({ page }) => {
  await routeUpload(page);
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page
    .getByRole("dialog", { name: "Cài đặt" })
    .getByRole("radio", { name: "English" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Attach files" })).toBeVisible();
  await attach(page, [file("x.exe")]);
  await expect(page.getByText("File type not supported.")).toBeVisible();
  await attach(
    page,
    Array.from({ length: 11 }, (_, i) => file(`f${i}.txt`, 16)),
  );
  await expect(page.getByText("Up to 10 files per message.")).toBeVisible();
});
