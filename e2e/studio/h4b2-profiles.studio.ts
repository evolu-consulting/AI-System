// HUB-FR-67 · AC-H4b2-03 (thứ tự bước) · AC-H4b2-07 (dòng "lúc này chạy bằng" = `active_step` của server) · AC-H04
// (cảnh báo toàn subscription) · plan-frontend H4b2 §2–§5 · spec §3 B, §9 (dùng `active_step` server) · artboard
// `Models.dc.html` (Profiles) + mockup States · test-plan H4b2 §3 M20–M26. Đỏ trước code: `/studio/models` chưa có.
import { expect, type Page, test } from "@playwright/test";
import { choose, type Kho, openModels, PF, writes } from "./_h4b2";

const steps = (page: Page) => page.getByRole("list", { name: "Các bước" }).getByRole("listitem");
async function openProfile(
  page: Page,
  key: string,
  o: Parameters<typeof openModels>[1] = {},
): Promise<Kho> {
  const k = await openModels(page, o, "/models?tab=profiles");
  await page
    .getByRole("list", { name: "Danh sách profile" })
    .getByRole("link", { name: key })
    .click();
  await expect(steps(page).first()).toBeVisible();
  return k;
}
const live = (page: Page) =>
  page.getByRole("status").filter({ hasText: /Lúc này sẽ chạy bằng|Hiện không bước nào sẵn sàng/ });

test('HUB-FR-67 · M20 · tab Profiles: danh sách coder, smart, fake-1; mở coder ⇒ 3 bước đúng thứ tự (Provider, Model, "Chuyển bước kế khi") [artboard]', async ({
  page,
}) => {
  await openProfile(page, "coder");
  const list = page.getByRole("list", { name: "Danh sách profile" });
  for (const key of ["coder", "smart", "fake-1"])
    await expect(list.getByRole("link", { name: key })).toBeVisible();
  await expect(steps(page)).toHaveCount(3);
  const prov = steps(page).getByRole("combobox", { name: "Provider" });
  await expect(prov.nth(0)).toContainText("gemini-sub");
  await expect(prov.nth(1)).toContainText("claude-sub");
  await expect(prov.nth(2)).toContainText("anthropic-api");
  await expect(steps(page).nth(2).getByRole("textbox", { name: "Model" })).toHaveValue(
    "claude-sonnet",
  );
  const on = steps(page).nth(0).getByRole("group", { name: "Chuyển bước kế khi" });
  for (const c of ["lỗi", "hết quota", "quá giờ"])
    await expect(on.getByRole("checkbox", { name: c })).toBeChecked();
});

test('HUB-FR-67 · AC-H4b2-07 · M21 · dòng tóm tắt theo active_step server: coder (1) ⇒ "Lúc này sẽ chạy bằng bước 2 · claude-sub" [spec §9]', async ({
  page,
}) => {
  await openProfile(page, "coder");
  await expect(live(page)).toContainText("Lúc này sẽ chạy bằng bước 2 · claude-sub");
});

test('HUB-FR-67 · AC-H4b2-07 · M22 · active_step null (bước 0 bị chặn, on []) ⇒ "Hiện không bước nào sẵn sàng" — không tự tính sang bước 2 ở client [spec §9]', async ({
  page,
}) => {
  await openProfile(page, "smart");
  await expect(live(page)).toContainText("Hiện không bước nào sẵn sàng");
  await expect(live(page)).not.toContainText("Lúc này sẽ chạy bằng");
});

test('HUB-FR-67 · M23 · all_subscription ⇒ cảnh báo "Profile này chỉ có bước subscription."; profile có bước api ⇒ không cảnh báo [AC-H04 · UI §8]', async ({
  page,
}) => {
  await openProfile(page, "fake-1");
  await expect(page.getByText("Profile này chỉ có bước subscription.")).toBeVisible();
  await page
    .getByRole("list", { name: "Danh sách profile" })
    .getByRole("link", { name: "coder" })
    .click();
  await expect(steps(page)).toHaveCount(3);
  await expect(page.getByText("Profile này chỉ có bước subscription.")).toHaveCount(0);
});

test('HUB-FR-67 · AC-H4b2-03 · M24 · bước 2 bấm "Lên" ⇒ thứ tự đổi; "Lưu profile" ⇒ PUT {version 1, steps theo thứ tự mới} [D1 · a11y kéo-thả]', async ({
  page,
}) => {
  const k = await openProfile(page, "coder");
  const save = page.getByRole("button", { name: "Lưu profile" });
  await expect(save).toBeDisabled();
  await steps(page).nth(1).getByRole("button", { name: "Lên" }).click();
  const prov = steps(page).getByRole("combobox", { name: "Provider" });
  await expect(prov.nth(0)).toContainText("claude-sub");
  await expect(prov.nth(1)).toContainText("gemini-sub");
  await expect(save).toBeEnabled();
  const put = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/model-profiles/${PF.coder}`),
  );
  await save.click();
  await put;
  const b = writes(k)
    .filter((c) => c.method === "PUT")
    .at(-1)?.body as { version: number; steps: { provider_key: string }[] };
  expect(b.version).toBe(1);
  expect(b.steps.map((s) => s.provider_key)).toEqual(["claude-sub", "gemini-sub", "anthropic-api"]);
  expect(Object.keys(b)).not.toContain("key");
});

test('HUB-FR-67 · M25 · "+ Profile mới": Tên profile + 1 bước (Provider claude-sub, Model) ⇒ POST {key, steps}; thiếu model ⇒ "Nhập model", không gửi', async ({
  page,
}) => {
  const k = await openModels(page, {}, "/models?tab=profiles");
  await page.getByRole("button", { name: "+ Profile mới" }).click();
  await page.getByRole("textbox", { name: "Tên profile" }).fill("qc-new");
  if ((await steps(page).count()) === 0)
    await page.getByRole("button", { name: "+ Thêm bước" }).click();
  await choose(page, steps(page).nth(0).getByRole("combobox", { name: "Provider" }), "claude-sub");
  await page.getByRole("button", { name: "Lưu profile" }).click();
  await expect(page.getByText("Nhập model")).toBeVisible();
  expect(writes(k)).toEqual([]);
  await steps(page).nth(0).getByRole("textbox", { name: "Model" }).fill("claude-sonnet");
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && /\/studio\/api\/model-profiles$/.test(r.url()),
  );
  await page.getByRole("button", { name: "Lưu profile" }).click();
  expect((await post).postDataJSON()).toEqual({
    key: "qc-new",
    steps: [{ provider_key: "claude-sub", model: "claude-sonnet", on: [] }],
  });
});

test('HUB-FR-67 · M26 · PUT profile 409 VERSION_CONFLICT ⇒ "Có người vừa lưu bản mới hơn" [D10]', async ({
  page,
}) => {
  await openProfile(page, "coder", {
    once: {
      [`PUT /model-profiles/${PF.coder}`]: {
        status: 409,
        body: {
          error: {
            code: "VERSION_CONFLICT",
            message: "x",
            details: {
              current: { id: PF.coder, key: "coder", version: 2 },
              updated_at: "2026-10-13T08:30:00.000Z",
            },
          },
        },
      },
    },
  });
  await steps(page).nth(1).getByRole("button", { name: "Lên" }).click();
  await page.getByRole("button", { name: "Lưu profile" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Có người vừa lưu bản mới hơn" }),
  ).toBeVisible();
});
