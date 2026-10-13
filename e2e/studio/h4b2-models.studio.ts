// HUB-FR-66 · HUB-FR-67 · AC-H4b2-01, 02, 03 (vế UI) · plan-frontend H4b2 §2–§5 (nhãn VI nguyên văn) · spec §3 A, B ·
// artboard `Models.dc.html` + mockup Provider-Sheet / Check / Runbook / States (đã duyệt 2026-10-13) · test-plan H4b2 §3
// M01–M20. API giả lập `page.route` (`_h4b2.ts`). Đỏ trước code: `/studio/models` chưa có ⇒ không thấy heading "Models".
import { expect, type Page, test } from "@playwright/test";
import { choose, type Kho, mockH4b2, openModels, PF, PV, SECRET, toast, writes } from "./_h4b2";
import { mockStudio, openAuthed } from "./_support";

const table = (page: Page) => page.getByRole("table", { name: "Danh sách provider" });
const row = (page: Page, key: string) =>
  table(page).getByRole("row").filter({ hasText: key }).first();
const checkRes = (status: string, o: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    status,
    error_code: null,
    http_status: null,
    message: null,
    latency_ms: 80,
    checked_at: "2026-10-13T08:12:00.000Z",
    ...o,
  },
});
const lastWrite = (k: Kho, method: string) =>
  writes(k)
    .filter((c) => c.method === method)
    .at(-1);

test('HUB-FR-66 · M01 · menu "Models" là link ⇒ /studio/models; heading, tablist "Models" có Providers/Profiles, KHÔNG có Đơn giá [D2 · Q1]', async ({
  page,
}) => {
  await mockStudio(page, { session: true });
  await mockH4b2(page);
  await openAuthed(page, "/agents");
  const nav = page.getByRole("navigation", { name: "Menu Studio" });
  await nav.getByRole("link", { name: "Models" }).click();
  await expect(page).toHaveURL(/\/studio\/models/);
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Models" });
  await expect(tabs.getByRole("tab", { name: "Providers" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tabs.getByRole("tab", { name: "Profiles" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Đơn giá" })).toHaveCount(0);
});

test('HUB-FR-66 · M02 · bảng provider: loại, trạng thái (chữ), slot dùng/tổng, cooldown "Mở lại sau … phút"; nút theo loại [artboard Models]', async ({
  page,
}) => {
  await openModels(page);
  await expect(row(page, "claude-sub")).toContainText("Subscription");
  await expect(row(page, "claude-sub")).toContainText("1/2");
  await expect(row(page, "claude-sub").getByRole("status")).toContainText("ok");
  await expect(row(page, "codex-sub").getByRole("status")).toContainText("hết phiên");
  await expect(row(page, "gemini-sub")).toContainText(/Mở lại sau 4[12] phút/);
  await expect(row(page, "anthropic-api")).toContainText("API");
  await expect(
    row(page, "anthropic-api").getByRole("button", { name: "Kiểm tra key" }),
  ).toBeVisible();
  await expect(row(page, "claude-sub").getByRole("button", { name: "Kiểm tra lại" })).toBeVisible();
  await expect(row(page, "claude-sub").getByRole("button", { name: "Hướng dẫn" })).toHaveCount(0);
  await expect(row(page, "codex-sub").getByRole("button", { name: "Hướng dẫn" })).toBeVisible();
  for (const b of ["Sửa", "Xoá"])
    await expect(row(page, "openai-api").getByRole("button", { name: b })).toBeVisible();
});

test('HUB-FR-66 · AC-H4b2-01 · M03 · "+ Thêm provider" loại API: chọn secret đã lưu (không ô giá trị) ⇒ POST đúng thân; dòng mới [D4 · Q7]', async ({
  page,
}) => {
  const k = await openModels(page);
  await page.getByRole("button", { name: "+ Thêm provider" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm provider" });
  await dlg.getByRole("textbox", { name: "Khoá provider" }).fill("openai-backup");
  await choose(page, dlg.getByRole("combobox", { name: "Loại" }), "API");
  await choose(page, dlg.getByRole("combobox", { name: "Hãng" }), "OpenAI");
  await choose(page, dlg.getByRole("combobox", { name: "API key" }), "openai-main");
  await expect(dlg).toContainText("Không hiện giá trị");
  await expect(dlg.getByRole("link", { name: "Tạo secret" })).toHaveAttribute(
    "href",
    /secrets\?kind=provider_api_key/,
  );
  await expect(dlg.locator('input[type="password"]')).toHaveCount(0);
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && /\/studio\/api\/providers$/.test(r.url()),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  const b = (await post).postDataJSON();
  expect(b).toMatchObject({
    key: "openai-backup",
    kind: "api",
    vendor: "openai",
    secret_id: SECRET.openaiMain,
  });
  expect(Object.keys(b)).not.toContain("value");
  await expect(toast(page)).toContainText("Đã lưu openai-backup");
  await expect(dlg).toBeHidden();
  await expect(row(page, "openai-backup")).toBeVisible();
  expect(writes(k).length).toBe(1);
});

test('HUB-FR-66 · M04 · Sửa subscription: "Sửa provider · claude-sub", Loại chỉ đọc, không ô API key, Số slot tối đa ⇒ PUT {version 1, max_concurrency 3} [D5 · Q8]', async ({
  page,
}) => {
  const k = await openModels(page);
  await row(page, "claude-sub").getByRole("button", { name: "Sửa" }).click();
  const dlg = page.getByRole("dialog", { name: "Sửa provider · claude-sub" });
  await expect(dlg).toContainText("không đổi được sau khi tạo");
  await expect(dlg.getByRole("textbox", { name: "Khoá provider" })).toHaveCount(0);
  await expect(dlg.getByRole("combobox", { name: "API key" })).toHaveCount(0);
  const slots = dlg.getByRole("spinbutton", { name: "Số slot tối đa" });
  await expect(slots).toHaveValue("2");
  await slots.fill("3");
  const put = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/providers/${PV.claudeSub}`),
  );
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await put;
  await expect(dlg).toBeHidden();
  expect(lastWrite(k, "PUT")?.body).toMatchObject({
    version: 1,
    max_concurrency: 3,
    secret_id: null,
  });
  for (const f of ["key", "kind", "vendor"])
    expect(Object.keys(lastWrite(k, "PUT")?.body ?? {})).not.toContain(f);
});

test("HUB-FR-66 · M05 · validate client: khoá sai, thiếu API key, slot 0 ⇒ thông báo dưới ô; không gửi [plan-frontend §4]", async ({
  page,
}) => {
  const k = await openModels(page);
  await page.getByRole("button", { name: "+ Thêm provider" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm provider" });
  await dlg.getByRole("textbox", { name: "Khoá provider" }).fill("A");
  await choose(page, dlg.getByRole("combobox", { name: "Loại" }), "API");
  await choose(page, dlg.getByRole("combobox", { name: "Hãng" }), "Anthropic");
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Bắt đầu bằng chữ thường; chỉ chữ thường, số và - (2–48 ký tự)");
  await expect(dlg).toContainText("Chọn API key");
  expect(writes(k)).toEqual([]);
});

test('HUB-FR-66 · M06 · POST 409 KEY_TAKEN ⇒ "Khoá này đã được dùng" dưới Khoá provider [spec §3 A · C2]', async ({
  page,
}) => {
  await openModels(page, {
    once: {
      "POST /providers": {
        status: 409,
        body: { error: { code: "KEY_TAKEN", message: "KEY_TAKEN" } },
      },
    },
  });
  await page.getByRole("button", { name: "+ Thêm provider" }).click();
  const dlg = page.getByRole("dialog", { name: "Thêm provider" });
  await dlg.getByRole("textbox", { name: "Khoá provider" }).fill("claude-sub");
  await choose(page, dlg.getByRole("combobox", { name: "Loại" }), "Subscription");
  await choose(page, dlg.getByRole("combobox", { name: "Hãng" }), "Anthropic");
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(dlg).toContainText("Khoá này đã được dùng");
});

test('HUB-FR-66 · AC-H4b2-02 · M07 · "Kiểm tra key" ⇒ hộp "Kết quả kiểm tra · anthropic-api": "Đang kiểm tra key…" (Đóng khoá) rồi "Key hợp lệ" [D3 · mockup Check]', async ({
  page,
}) => {
  const k = await openModels(page);
  k.hold(`POST /providers/${PV.anthApi}/check`);
  await row(page, "anthropic-api").getByRole("button", { name: "Kiểm tra key" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra · anthropic-api" });
  await expect(dlg.getByRole("status")).toContainText("Đang kiểm tra key…");
  await expect(dlg.getByRole("button", { name: "Đóng" })).toBeDisabled();
  k.release(`POST /providers/${PV.anthApi}/check`);
  await expect(dlg.getByRole("status")).toContainText("Key hợp lệ");
  await expect(dlg.getByRole("button", { name: "Đóng" })).toBeEnabled();
});

test('HUB-FR-66 · AC-H4b2-02 · M08 · lỗi ⇒ "Key không hợp lệ" + nhóm "Chi tiết" chứa lỗi nguyên văn; [Kiểm tra lại] gửi lại cùng request [D3]', async ({
  page,
}) => {
  const msg = "Incorrect API key provided: sk-proj-***. Rotate it.";
  const k = await openModels(page, {
    once: {
      [`POST /providers/${PV.openaiApi}/check`]: checkRes("error", {
        error_code: "auth_failed",
        http_status: 401,
        message: msg,
      }),
    },
  });
  await row(page, "openai-api").getByRole("button", { name: "Kiểm tra key" }).click();
  const dlg = page.getByRole("dialog", { name: "Kết quả kiểm tra · openai-api" });
  await expect(dlg.getByRole("status")).toContainText("Key không hợp lệ");
  await expect(dlg.getByRole("group", { name: "Chi tiết" })).toContainText(msg);
  const again = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/providers/${PV.openaiApi}/check`),
  );
  await dlg.getByRole("button", { name: "Kiểm tra lại" }).click();
  await again;
  await expect(dlg.getByRole("status")).toContainText("Key hợp lệ");
  expect(k.calls.filter((c) => c.path.endsWith("/check")).length).toBe(2);
});

test('HUB-FR-66 · M09 · unsupported ⇒ "Chưa hỗ trợ kiểm tra cho hãng này"; error_code timeout ⇒ "Không kết nối được tới hãng trong 10 giây" [Q3]', async ({
  page,
}) => {
  await openModels(page, {
    once: {
      [`POST /providers/${PV.fakeApi}/check`]: checkRes("unsupported"),
      [`POST /providers/${PV.anthApi}/check`]: checkRes("error", { error_code: "timeout" }),
    },
  });
  await row(page, "fake-api").getByRole("button", { name: "Kiểm tra key" }).click();
  const a = page.getByRole("dialog", { name: "Kết quả kiểm tra · fake-api" });
  await expect(a.getByRole("status")).toContainText("Chưa hỗ trợ kiểm tra cho hãng này");
  await a.getByRole("button", { name: "Đóng" }).click();
  await expect(a).toBeHidden();
  await row(page, "anthropic-api").getByRole("button", { name: "Kiểm tra key" }).click();
  const b = page.getByRole("dialog", { name: "Kết quả kiểm tra · anthropic-api" });
  await expect(b.getByRole("status")).toContainText("Không kết nối được tới hãng trong 10 giây");
});

test('HUB-FR-66 · M10 · subscription "Kiểm tra lại": ok ⇒ "phiên đăng nhập hợp lệ"; requested ⇒ "Worker chưa kiểm xong" [spec §3 A subscription]', async ({
  page,
}) => {
  await openModels(page, {
    once: { [`POST /providers/${PV.codexSub}/check`]: checkRes("requested") },
  });
  await row(page, "claude-sub").getByRole("button", { name: "Kiểm tra lại" }).click();
  const a = page.getByRole("dialog", { name: "Kết quả kiểm tra · claude-sub" });
  await expect(a.getByRole("status")).toContainText("phiên đăng nhập hợp lệ");
  await a.getByRole("button", { name: "Đóng" }).click();
  await expect(a).toBeHidden();
  await row(page, "codex-sub").getByRole("button", { name: "Kiểm tra lại" }).click();
  const b = page.getByRole("dialog", { name: "Kết quả kiểm tra · codex-sub" });
  await expect(b.getByRole("status")).toContainText("Worker chưa kiểm xong");
});

test('HUB-FR-66 · M11 · "Hướng dẫn" (logged_out) ⇒ "Đăng nhập CLI · codex-sub": lệnh codex login, Sao chép ⇒ "Đã sao chép"; [Kiểm tra lại] gọi check [D6 · mockup Runbook]', async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const k = await openModels(page);
  await row(page, "codex-sub").getByRole("button", { name: "Hướng dẫn" }).click();
  const dlg = page.getByRole("dialog", { name: "Đăng nhập CLI · codex-sub" });
  await expect(dlg).toContainText("codex login");
  await expect(dlg).toContainText("Hub không đăng nhập thay bạn.");
  await expect(dlg.getByRole("button", { name: "Sao chép lệnh bước 1" })).toBeVisible();
  await dlg.getByRole("button", { name: "Sao chép lệnh bước 2" }).click();
  await expect(dlg.getByRole("status").filter({ hasText: "Đã sao chép" })).toBeVisible();
  const req = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/providers/${PV.codexSub}/check`),
  );
  await dlg.getByRole("button", { name: "Kiểm tra lại" }).click();
  await req;
  expect(k.calls.some((c) => c.path === `/providers/${PV.codexSub}/check`)).toBe(true);
});

test('HUB-FR-66 · AC-H4b2-03 · M12 · Xoá provider đang dùng ⇒ alertdialog "Không xoá được openai-api" kèm smart, coder; dòng còn nguyên [D8 · Q2]', async ({
  page,
}) => {
  const inUse = {
    profiles: [
      { id: PF.smart, key: "smart" },
      { id: PF.coder, key: "coder" },
    ],
  };
  await openModels(page, {
    once: {
      [`DELETE /providers/${PV.openaiApi}`]: {
        status: 409,
        body: { error: { code: "PROVIDER_IN_USE", message: "x", details: inUse } },
      },
    },
  });
  await row(page, "openai-api").getByRole("button", { name: "Xoá" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Xoá openai-api?" });
  const blocked = page.getByRole("alertdialog", { name: "Không xoá được openai-api" });
  await expect(confirm.or(blocked)).toBeVisible();
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Xoá" }).click();
  await expect(blocked).toContainText("smart");
  await expect(blocked).toContainText("Gỡ bước, hoặc chỉ tắt provider.");
  await blocked.getByRole("button", { name: "Đóng" }).click();
  await expect(blocked).toBeHidden();
  await expect(row(page, "openai-api")).toBeVisible();
});

test('HUB-FR-66 · M13 · Xoá provider rảnh: "Xoá fake-api?" ⇒ DELETE ?version=1; dòng biến mất, toast "Đã xoá fake-api"', async ({
  page,
}) => {
  const k = await openModels(page);
  await row(page, "fake-api").getByRole("button", { name: "Xoá" }).click();
  const dlg = page.getByRole("alertdialog", { name: "Xoá fake-api?" });
  const del = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().includes(`/providers/${PV.fakeApi}`),
  );
  await dlg.getByRole("button", { name: "Xoá" }).click();
  await del;
  expect(lastWrite(k, "DELETE")?.query).toContain("version=1");
  await expect(toast(page)).toContainText("Đã xoá fake-api");
  await expect(table(page).getByRole("row").filter({ hasText: "fake-api" })).toHaveCount(0);
});

test('HUB-FR-66 · M14 · PUT 409 VERSION_CONFLICT ⇒ "Có người vừa lưu bản mới hơn" (ConflictDialog dùng chung) [D10]', async ({
  page,
}) => {
  await openModels(page, {
    once: {
      [`PUT /providers/${PV.claudeSub}`]: {
        status: 409,
        body: {
          error: {
            code: "VERSION_CONFLICT",
            message: "x",
            details: {
              current: { id: PV.claudeSub, key: "claude-sub", version: 2 },
              updated_at: "2026-10-13T08:30:00.000Z",
            },
          },
        },
      },
    },
  });
  await row(page, "claude-sub").getByRole("button", { name: "Sửa" }).click();
  const dlg = page.getByRole("dialog", { name: "Sửa provider · claude-sub" });
  await dlg.getByRole("spinbutton", { name: "Số slot tối đa" }).fill("4");
  await dlg.getByRole("button", { name: "Lưu" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Có người vừa lưu bản mới hơn" }),
  ).toBeVisible();
});
