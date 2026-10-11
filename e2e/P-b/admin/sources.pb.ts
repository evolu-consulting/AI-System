// ADM-FR-68 · HUB-FR-120 · PB-R02/R05/R08/R21 · e2e P-b · trang "Nguồn" (admin-web `/sources`; test-plan §4.6 E-PB01…07, E-PB12;
// nhãn nguyên văn plan-frontend.md §6 + plan-frontend-i18n.md). Hub THẬT + Runtime giả (`source.resolve` — `_pb-runtime.ts`:
// key `bad-*` ⇒ SOURCE_UNRESOLVABLE, còn lại ok với SHA cố định 0123456…). Nguồn/quy trình dựng bằng API (`seedPb`).
import { expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, hub, platformLogin, SRC, seedPb, tok } from "../_pb-support";

test.beforeAll(() => seedPb());

const table = (p: Page) => p.getByRole("table", { name: "Nguồn" });
const rowOf = (p: Page, key: string) => table(p).getByRole("row").filter({ hasText: key });
const dialogOf = (p: Page, name: string | RegExp) => p.getByRole("dialog", { name });
const navLink = (p: Page) =>
  p.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", {
    name: "Nguồn",
    exact: true,
  });

async function openSources(p: Page): Promise<void> {
  await navLink(p).click();
  await expect(p.getByRole("heading", { name: "Nguồn tham chiếu" })).toBeVisible();
  await expect(table(p)).toBeVisible();
}
async function rowAction(p: Page, key: string, item: string): Promise<void> {
  await rowOf(p, key)
    .getByRole("button", { name: `Thao tác ${key}` })
    .click();
  await p.getByRole("menuitem", { name: item, exact: true }).click();
}
async function fillGit(d: Locator, key: string, url: string, desc: string): Promise<void> {
  await d.getByRole("textbox", { name: "Ký hiệu nguồn" }).fill(key);
  await d.getByRole("radio", { name: "Git công khai" }).click();
  await d.getByRole("textbox", { name: "Địa chỉ kho Git (https)" }).fill(url);
  await d.getByRole("textbox", { name: "Nhánh (branch)" }).fill("main");
  await d.getByRole("textbox", { name: "Mô tả" }).fill(desc);
}

test('ADM-FR-68 · E-PB01 · tenant_admin: nav "Nguồn" ⇒ bảng 6 cột; tạo git_remote ⇒ toast + dòng "Chưa kiểm tra"; không có cột/trường bí mật', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await openSources(p);
    for (const col of ["Ký hiệu", "Loại", "Mô tả", "Đích", "Dùng bởi", "Trạng thái"])
      await expect(table(p).getByRole("columnheader", { name: col, exact: true })).toBeVisible();
    await expect(
      table(p).getByRole("columnheader", { name: /mật khẩu|token|secret|bí mật/i }),
    ).toHaveCount(0);
    await expect(rowOf(p, SRC.app.key)).toContainText("Git công khai");

    await p.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
    const d = dialogOf(p, "Thêm nguồn");
    await expect(d).toBeVisible();
    await expect(d.getByRole("textbox", { name: /mật khẩu|token|secret|bí mật/i })).toHaveCount(0);
    await fillGit(d, "new-repo", "https://github.com/pb-test/new-repo.git", "Kho mới tạo bằng UI");
    await d.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(p.getByText("Đã tạo nguồn new-repo")).toBeVisible();
    const row = rowOf(p, "new-repo");
    await expect(row).toContainText("Kho mới tạo bằng UI");
    await expect(row).toContainText("Chưa kiểm tra");
    await expect(row).toContainText("github.com");
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-68 · PB-R02 · E-PB02 · host "bitbucket.org" ⇒ lỗi dưới ô địa chỉ (SOURCE_HOST_NOT_ALLOWED); URL có user:pass@ ⇒ lỗi client, không gọi API', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await openSources(p);
    const posts: string[] = [];
    p.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/admin/sources")
        posts.push(r.url());
    });
    await p.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
    const d = dialogOf(p, "Thêm nguồn");
    await fillGit(d, "bb-repo", "https://user:pass@github.com/pb-test/x.git", "Có mật khẩu");
    await d.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(
      d.getByText("Không đưa tên người dùng hoặc mật khẩu vào địa chỉ. Chỉ dùng kho công khai."),
    ).toBeVisible();
    expect(posts).toHaveLength(0);

    await d
      .getByRole("textbox", { name: "Địa chỉ kho Git (https)" })
      .fill("https://bitbucket.org/pb-test/x.git");
    await d.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(d.getByText("Máy chủ này chưa được cho phép.", { exact: false })).toBeVisible();
    await expect(rowOf(p, "bb-repo")).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-68 · PB-R21 · E-PB03 · tenant_admin: không có radio "Đường dẫn cục bộ"; dòng local_path chỉ ký hiệu + mô tả (không thấy đường dẫn, kể cả trong response); chỉ "Xem"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const bodies: Promise<string>[] = [];
  p.on("response", (r) => {
    if (new URL(r.url()).pathname.startsWith("/admin/sources"))
      bodies.push(r.text().catch(() => ""));
  });
  try {
    await adminLogin(p);
    await openSources(p);
    const row = rowOf(p, SRC.local.key);
    await expect(row).toContainText(SRC.local.description);
    await expect(row).toContainText("Đường dẫn cục bộ");
    await expect(row).toContainText("Ẩn (chỉ quản trị nền tảng)");
    await expect(row).not.toContainText("/srv/pb-roots");
    await expect(p.locator("body")).not.toContainText(SRC.local.path);

    await p.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
    const add = dialogOf(p, "Thêm nguồn");
    await expect(add.getByRole("radio", { name: "Git công khai" })).toBeVisible();
    await expect(add.getByRole("radio", { name: "Đường dẫn cục bộ" })).toHaveCount(0);
    await add.getByRole("button", { name: "Huỷ", exact: true }).click();
    await expect(add).toHaveCount(0);

    await row.getByRole("button", { name: `Thao tác ${SRC.local.key}` }).click();
    await expect(p.getByRole("menuitem", { name: "Xem", exact: true })).toBeVisible();
    await expect(p.getByRole("menuitem", { name: "Sửa", exact: true })).toHaveCount(0);
    await p.getByRole("menuitem", { name: "Xem", exact: true }).click();
    const v = dialogOf(p, `Xem nguồn ${SRC.local.key}`);
    await expect(v).toBeVisible();
    await expect(
      v.getByRole("alert").filter({
        hasText: "Đường dẫn này nằm trên máy chạy Runtime, không phải máy của bạn.",
      }),
    ).toBeVisible();
    await expect(v.getByRole("textbox", { name: "Đường dẫn trên máy Runtime" })).toHaveCount(0);
    await expect(v.getByRole("button", { name: "Lưu", exact: true })).toHaveCount(0);
    await expect(v.getByRole("button", { name: "Kiểm tra kết nối" })).toHaveCount(0);
    await expect(v).not.toContainText(SRC.local.path);

    const all = (await Promise.all(bodies)).join("\n");
    expect(all).toContain(SRC.local.key);
    expect(all, "response /admin/sources của tenant_admin không chứa path").not.toContain(
      SRC.local.path,
    );
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-68 · PB-R21 · E-PB04 · platform_admin: tạo local_path (có radio "Đường dẫn cục bộ" + cảnh báo "trên máy Runtime"), dòng thấy đường dẫn', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await platformLogin(p);
    await p.goto(`${ADMIN_URL}/sources?tenant=acme`);
    await expect(p.getByRole("heading", { name: "Nguồn tham chiếu" })).toBeVisible();
    await expect(table(p)).toBeVisible();
    await p.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
    const d = dialogOf(p, "Thêm nguồn");
    await expect(d.getByRole("combobox", { name: "Công ty" })).toBeVisible();
    // lần bấm đầu có thể rơi vào lúc drawer còn nạp danh sách công ty ⇒ thử lại tới khi radio được chọn
    const local = d.getByRole("radio", { name: "Đường dẫn cục bộ" });
    await expect(async () => {
      await local.click();
      await expect(local).toBeChecked({ timeout: 1_000 });
    }).toPass();
    await expect(
      d.getByRole("alert").filter({
        hasText: "Đường dẫn này nằm trên máy chạy Runtime, không phải máy của bạn.",
      }),
    ).toBeVisible();
    await d.getByRole("textbox", { name: "Ký hiệu nguồn" }).fill("local-new");
    await d
      .getByRole("textbox", { name: "Đường dẫn trên máy Runtime" })
      .fill("/srv/pb-roots/new-docs");
    await d.getByRole("combobox", { name: "Công ty" }).click();
    await p.getByRole("option", { name: "acme", exact: true }).click();
    await d.getByRole("textbox", { name: "Mô tả" }).fill("Tài liệu cục bộ mới");
    await d.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(p.getByText("Đã tạo nguồn local-new")).toBeVisible();
    const row = rowOf(p, "local-new");
    await expect(row).toContainText("Đường dẫn cục bộ");
    await expect(row).toContainText("/srv/pb-roots/new-docs");
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-68 · PB-R05 · E-PB05 · "Kiểm tra kết nối": thành công ⇒ status "Kết nối được: main → 0123456 …" + cột Trạng thái "Đã kiểm tra · 0123456"; thất bại ⇒ alert "Không đọc được nguồn này."', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await openSources(p);
    await rowAction(p, SRC.app.key, "Sửa");
    const d = dialogOf(p, `Sửa nguồn ${SRC.app.key}`);
    await expect(d).toBeVisible();
    await d.getByRole("button", { name: "Kiểm tra kết nối" }).click();
    await expect(
      d.getByRole("status").filter({ hasText: /Kết nối được: main → 0123456/ }),
    ).toBeVisible();
    await expect(d.getByRole("status")).toContainText("12 tệp");
    await d.getByRole("button", { name: "Huỷ", exact: true }).click();
    await expect(rowOf(p, SRC.app.key)).toContainText("Đã kiểm tra · 0123456");

    await rowAction(p, SRC.bad.key, "Sửa");
    const d2 = dialogOf(p, `Sửa nguồn ${SRC.bad.key}`);
    await d2.getByRole("button", { name: "Kiểm tra kết nối" }).click();
    await expect(
      d2.getByRole("alert").filter({ hasText: "Không đọc được nguồn này." }),
    ).toBeVisible();
    await d2.getByRole("button", { name: "Huỷ", exact: true }).click();
    await expect(rowOf(p, SRC.bad.key)).toContainText("Chưa kiểm tra");
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-68 · PB-R08 · E-PB06 · xoá nguồn đang dùng ⇒ "Không thể xoá nguồn used-repo" liệt kê "pb-used · giai đoạn s1"; nguồn không dùng ⇒ xác nhận ⇒ toast "Đã xoá nguồn …"', async ({
  browser,
}) => {
  const tmp = `tmp-del-${Date.now().toString(36).slice(-5)}`;
  const mk = await hub(await tok("Adm"), "POST", "/admin/sources", {
    key: tmp,
    kind: "git_remote",
    config: { kind: "git_remote", url: "https://github.com/pb-test/tmp.git", branch: "main" },
    description: "Nguồn tạm để xoá",
  });
  expect(mk.status, JSON.stringify(mk.json)).toBe(201);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await openSources(p);
    await rowAction(p, SRC.used.key, "Xoá");
    // BlockedDialog dùng chung là `alertdialog` (plan-frontend §6 ghi `dialog` — ghi nhận ở "Cần bổ sung")
    const blocked = p.getByRole("alertdialog", { name: `Không thể xoá nguồn ${SRC.used.key}` });
    await expect(blocked).toBeVisible();
    await expect(blocked.getByRole("link", { name: "pb-used · giai đoạn s1" })).toBeVisible();
    await p.keyboard.press("Escape");
    await expect(blocked).toHaveCount(0);
    await expect(rowOf(p, SRC.used.key)).toBeVisible();

    await rowAction(p, tmp, "Xoá");
    const confirm = p.getByRole("alertdialog", { name: `Xoá nguồn ${tmp}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Xoá", exact: true }).click();
    await expect(p.getByText(`Đã xoá nguồn ${tmp}`)).toBeVisible();
    await expect(rowOf(p, tmp)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-68 · E-PB07 · hai tab sửa cùng nguồn ⇒ tab đến sau Lưu ⇒ ConflictDialog "Có người vừa lưu"', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await openSources(p);
    await rowAction(p, "conflict-src", "Sửa");
    const d = dialogOf(p, "Sửa nguồn conflict-src");
    await expect(d).toBeVisible();
    await d.getByRole("textbox", { name: "Mô tả" }).fill("Sửa ở tab 1");

    const adm = await tok("Adm");
    const cur = (await hub(adm, "GET", "/admin/sources/conflict-src")).json;
    expect(cur?.version, "GET /admin/sources/conflict-src có version").toBeGreaterThanOrEqual(1);
    const put = await hub(adm, "PUT", "/admin/sources/conflict-src", {
      config: cur.config,
      description: "Sửa ở nơi khác",
      version: cur.version,
    });
    expect(put.status, JSON.stringify(put.json)).toBe(200);

    await d.getByRole("button", { name: "Lưu", exact: true }).click();
    const conflict = p.getByRole("alertdialog", { name: /Có người vừa lưu/ });
    await expect(conflict).toBeVisible();
    await conflict.getByRole("button", { name: "Tải bản mới" }).click();
    await expect(conflict).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-68 · E-PB12 · member (lan) không có nav "Nguồn"; vào /sources ⇒ bị chuyển /member hoặc màn "không có quyền", không thấy bảng', async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p, "A");
    await expect(navLink(p)).toHaveCount(0);
    await p.goto(`${ADMIN_URL}/sources`);
    await expect(async () => {
      const redirected = /\/member$/.test(new URL(p.url()).pathname);
      const forbidden = await p
        .getByText("Bạn không có quyền xem trang này.")
        .isVisible()
        .catch(() => false);
      expect(redirected || forbidden).toBe(true);
    }).toPass();
    await expect(p.getByRole("heading", { name: "Nguồn tham chiếu" })).toHaveCount(0);
    await expect(table(p)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
