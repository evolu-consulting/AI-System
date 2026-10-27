// Luồng 15 · các lỗi người dùng đã báo, kiểm trên máy chủ thật (tenant demo, dữ liệu giả). Mỗi test ghi rõ lỗi gốc.
// Dữ liệu tạo ra: hợp đồng + bản v2 tải lên có tên tệp/tiêu đề gắn E2E-DEPLOY (kèm SP tạo từ dòng HĐ, tên dòng cũng gắn thẻ) — dọn trong
// afterAll qua API xoá HĐ (kèm SP mồ côi); góp ý E2E-DEPLOY đặt "Xong" ở admin-web. KHÔNG lưu luồng duyệt, KHÔNG gọi Trello (thẻ Trello
// kiểm bằng log server: `docker logs` admin-api tìm "trello"), KHÔNG gửi email. Chỉ tenant demo (DEMO_USER, mật khẩu DEMO_PW).
// Ca 2b (bật duyệt tạm thời) tạo HĐ khoá dùng cho ca 3–7; ca 2a (đường tắt duyệt) ở cuối file. Cài đặt duyệt demo được KHÔI PHỤC trong finally/afterAll.
// Chạy: powershell -File deploy/prod-sohoptac2/e2e-deployed.ps1 -Spec e2e/deployed/15-user-bugs.deployed.ts
import { type APIRequestContext, type Page, request as playwrightRequest } from "@playwright/test";
import {
  ADMIN,
  CHAT,
  CW,
  expect,
  login,
  password,
  settle,
  TAG,
  TENANT,
  test,
  USER,
} from "./_support";

const RUN = Date.now().toString(36);
const P = "/pack/contracts";
const UUID = /\/contracts\/([0-9a-f-]{36})/;
const SHT_TENANT = process.env.DEMO_SHT_TENANT ?? "";
const SHT_USER = process.env.DEMO_SHT_USER ?? "";

// Hợp đồng mua mẫu (Markdown): tên dòng mang thẻ E2E-DEPLOY ⇒ SP tạo từ dòng cũng mang thẻ và bị dọn theo HĐ.
const CONTRACT_MD = [
  `# Hợp đồng mua bán hàng hoá số ${TAG}-${RUN}/HĐMB`,
  "",
  "Ngày ký: 01/10/2026. Hiệu lực từ 01/10/2026 đến 30/09/2027.",
  "",
  `Bên bán (Bên A): Công ty TNHH ${TAG} Bên Bán. Mã số thuế: 0312345678. Địa chỉ: 12 Lê Lợi, Quận 1, TP.HCM.`,
  `Bên mua (Bên B): Công ty TNHH ${TAG} Bên Mua. Mã số thuế: 0398765432. Địa chỉ: 45 Nguyễn Huệ, Quận 1, TP.HCM.`,
  "",
  "## Điều 1. Hàng hoá và giá",
  "",
  "| STT | Tên hàng | Đơn vị | Số lượng | Đơn giá (đồng) | Thành tiền (đồng) |",
  "|---|---|---|---|---|---|",
  `| 1 | ${TAG} Giấy A4 Double A ${RUN} | ram | 100 | 85.000 | 8.500.000 |`,
  `| 2 | ${TAG} Bút bi Thiên Long ${RUN} | hộp | 50 | 60.000 | 3.000.000 |`,
  "",
  "Tổng giá trị hợp đồng: 11.500.000 đồng (đã gồm VAT 10%).",
  "",
  "## Điều 2. Thanh toán và giao hàng",
  "",
  "Bên B thanh toán 100% trong 15 ngày kể từ ngày nhận hàng. Bên A giao hàng trong 7 ngày kể từ ngày ký.",
].join("\n");

let page: Page;
let api: APIRequestContext;
let auth: Record<string, string> = {};
let cid = ""; // HĐ v1 tải lên bằng UI
let cidTitle = "";
let itemIds: string[] = [];
const toClean: string[] = []; // id HĐ cần xoá cuối cùng (mới nhất trước)

type Detail = {
  status: string;
  locked: boolean;
  version: number;
  title: string;
  items: { id: string; name: string; product_id: string | null }[];
};

async function getDetail(id: string): Promise<Detail> {
  const r = await api.get(`${P}/contracts/${id}`, { headers: auth });
  expect(r.status()).toBe(200);
  return (await r.json()) as Detail;
}

/** Chờ AI đọc xong: HĐ rời `extracting`. */
async function waitRead(id: string): Promise<string> {
  let st = "extracting";
  await expect
    .poll(async () => (st = (await getDetail(id)).status), { timeout: 300_000, intervals: [3000] })
    .not.toBe("extracting");
  return st;
}

/** Xoá HĐ qua API (kèm SP mồ côi do HĐ này sinh ra). Lỗi ⇒ nuốt (dọn là cố gắng tốt nhất). */
async function removeContract(id: string): Promise<void> {
  try {
    const pv = await api.get(`${P}/contracts/${id}/delete-preview`, { headers: auth });
    if (pv.status() !== 200) return;
    const orphans = ((await pv.json()) as { orphan_products?: { id: string; name: string }[] })
      .orphan_products;
    const ids = (orphans ?? []).filter((p) => p.name.includes(TAG)).map((p) => p.id);
    await api.delete(`${P}/contracts/${id}`, { headers: auth, data: { remove_products: ids } });
  } catch {
    // dọn là cố gắng tốt nhất
  }
}

async function sweepContracts(): Promise<void> {
  try {
    const r = await api.get(`${P}/contracts?q=${encodeURIComponent(TAG)}`, { headers: auth });
    const items = ((await r.json()) as { items?: { id: string; title: string }[] }).items ?? [];
    for (const c of items) if (c.title.includes(TAG)) await removeContract(c.id);
  } catch {
    // dọn là cố gắng tốt nhất
  }
}

let origCompany: Record<string, unknown> | null = null; // cài đặt công ty demo trước khi đổi (để khôi phục)
type CompanyGet = {
  company: Record<string, unknown>;
  approval_enabled: boolean;
  allow_negative_stock: boolean;
};

/** Bật/tắt duyệt của tenant demo qua PUT /company (cùng API màn Cài đặt). Lần đầu nhớ giá trị cũ để `restoreApproval`. */
async function setApproval(on: boolean): Promise<void> {
  const g = await api.get(`${P}/company`, { headers: auth });
  expect(g.status()).toBe(200);
  const j = (await g.json()) as CompanyGet;
  origCompany ??= {
    ...j.company,
    approval_enabled: j.approval_enabled,
    allow_negative_stock: j.allow_negative_stock,
  };
  const r = await api.put(`${P}/company`, {
    headers: auth,
    data: { ...origCompany, approval_enabled: on },
  });
  expect(r.status()).toBe(200);
}

/** Khôi phục cài đặt demo về đúng giá trị đọc được trước khi đổi (idempotent). */
async function restoreApproval(): Promise<void> {
  if (!origCompany) return;
  const r = await api.put(`${P}/company`, { headers: auth, data: origCompany });
  expect(r.status(), "khôi phục cài đặt duyệt của tenant demo").toBe(200);
  origCompany = null;
}
/** Tải HĐ mẫu lên bằng giao diện (như người dùng), chờ AI đọc xong (needs_review); đăng ký dọn. */
async function uploadContract(name: string): Promise<string> {
  await page.goto(`${CW}/contracts`);
  await settle(page);
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from(CONTRACT_MD, "utf8"),
  });
  await page.getByTestId("upload-confirm").click(); // CR-101 DOC-ui-gaps: hộp chọn loại chứng từ (mặc định HĐ kinh tế)
  await page.waitForURL(UUID, { timeout: 60_000 });
  const id = UUID.exec(page.url())?.[1] ?? "";
  expect(id).not.toBe("");
  toClean.push(id);
  expect(await waitRead(id)).toBe("needs_review");
  return id;
}
test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
  page = await ctx.newPage();
  await login(page, CW);
  await settle(page);
  api = await playwrightRequest.newContext({ baseURL: CW });
  const lr = await api.post("/auth/login", {
    data: { tenant_key: TENANT, username: USER, password: password() },
    headers: { "X-App": "contracts" },
  });
  const token = ((await lr.json()) as { access_token?: string }).access_token;
  if (!token) throw new Error("đăng nhập API demo thất bại");
  auth = { Authorization: `Bearer ${token}` };
});

test.afterAll(async () => {
  await restoreApproval().catch((e) => console.error("KHÔI PHỤC CÀI ĐẶT DEMO THẤT BẠI", e));
  for (const id of [...toClean].reverse()) await removeContract(id);
  await sweepContracts();
  await page.context().close();
  await api.dispose();
});

test.describe("15 lỗi người dùng báo", () => {
  test("[lỗi: Huỷ không làm gì] tải HĐ mới lên, chờ AI đọc xong, bấm «Huỷ» ⇒ về danh sách", async () => {
    test.setTimeout(420_000);
    await page.goto(`${CW}/contracts`);
    await settle(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: `${TAG}-hop-dong-${RUN}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(CONTRACT_MD, "utf8"),
    });
    await page.getByTestId("upload-confirm").click(); // CR-101 DOC-ui-gaps: hộp chọn loại chứng từ
    await page.waitForURL(UUID, { timeout: 60_000 });
    cid = UUID.exec(page.url())?.[1] ?? "";
    expect(cid).not.toBe("");
    toClean.push(cid);
    expect(await waitRead(cid)).toBe("needs_review");
    cidTitle = (await getDetail(cid)).title;
    await page.reload();
    await settle(page);
    await expect(page.getByTestId("banner-pending")).toBeVisible({ timeout: 60_000 });
    // Chưa sửa gì ⇒ Huỷ về danh sách (lỗi gốc: bấm không có phản ứng).
    await page.getByRole("button", { name: "Huỷ", exact: true }).click();
    await expect(page).toHaveURL(/\/contracts$/);
  });

  test("[lỗi: SP trống sau xác nhận] 2b · đường bật duyệt: Xác nhận và lưu của thẻ duyệt ⇒ hộp «Gắn sản phẩm» ⇒ Xác nhận ⇒ HĐ khoá + có SP", async () => {
    test.setTimeout(480_000);
    await setApproval(true); // bật duyệt cho tenant demo; luôn khôi phục ở finally (và afterAll)
    try {
      const id2 = await uploadContract(`${TAG}-bat-duyet-${RUN}.md`);
      await page.goto(`${CW}/contracts/${id2}`);
      await settle(page);
      const ap = (await (
        await api.get(`${P}/contracts/${id2}/approval`, { headers: auth })
      ).json()) as {
        steps?: unknown[];
        can_act?: boolean;
      };
      const engine = Array.isArray(ap.steps);
      if (engine) {
        await expect(
          page.locator("[data-approval=timeline]"),
          "thẻ engine có dòng thời gian",
        ).toBeVisible();
        await expect(page.getByTestId("approval-step-0")).toBeVisible();
      }
      expect(ap.can_act, "tài khoản demo phải duyệt được bước 1 (người gửi được Đạt bước 1)").toBe(
        true,
      );
      const dlg = page.getByTestId("product-link-dialog");
      const btn = page.getByRole("button", { name: "Xác nhận và lưu", exact: true });
      const pass = page.locator("[data-approval=pass], [data-approval=approve]").first();
      // Bước soạn: Xác nhận và lưu; (engine) các bước duyệt kế: Đạt; bước cuối mở hộp Gắn SP.
      for (let i = 0; i < 4 && !(await getDetail(id2)).locked; i++) {
        const b = btn.or(pass).first();
        await expect(b).toBeVisible({ timeout: 30_000 });
        await b.click();
        if (
          await dlg.waitFor({ timeout: 8000 }).then(
            () => true,
            () => false,
          )
        ) {
          await expect(dlg).toContainText("Gắn sản phẩm");
          await page.getByTestId("product-link-confirm").click();
          await expect(dlg).toHaveCount(0, { timeout: 30_000 });
          break;
        }
        await settle(page);
      }
      await page.reload();
      await settle(page);
      await expect(page.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
      const d = await getDetail(id2);
      expect(d.locked).toBe(true);
      expect(d.items.length).toBeGreaterThan(0);
      expect(d.items.filter((i) => i.product_id === null)).toEqual([]);
      cid = id2;
      cidTitle = d.title;
      itemIds = d.items.map((i) => i.id);
    } finally {
      await restoreApproval();
    }
  });
  test("[lỗ hổng: gắn SP sau khoá] gắn sản phẩm trên HĐ đã khoá qua API ⇒ 409", async () => {
    test.skip(itemIds.length === 0, "HĐ chưa được xác nhận/khoá ở test trước");
    const d = await getDetail(cid);
    const pid = d.items[0]?.product_id;
    expect(pid).toBeTruthy();
    const put = await api.put(`${P}/contracts/${cid}/items/${itemIds[0]}/product`, {
      headers: auth,
      data: { product_id: pid },
    });
    expect(put.status()).toBe(409);
    const post = await api.post(`${P}/contracts/${cid}/product-links`, {
      headers: auth,
      data: { links: [{ item_id: itemIds[0], product_id: pid }] },
    });
    expect(post.status()).toBe(409);
  });

  test("[lỗi: «lưu rồi thì không cho chỉnh»] HĐ đã khoá: trường không sửa được, không còn Lưu nháp / Lưu thay đổi", async () => {
    test.skip(itemIds.length === 0, "HĐ chưa được xác nhận/khoá ở test trước");
    await page.goto(`${CW}/contracts/${cid}`);
    await settle(page);
    await expect(page.getByTestId("banner-locked")).toBeVisible();
    await expect(page.locator("input[name=number]")).toBeDisabled();
    await expect(page.getByLabel("Tên hợp đồng")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Lưu nháp" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lưu thay đổi" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Xác nhận và lưu" })).toHaveCount(0);
  });

  test("[lỗi: chi tiết còn nút Xoá / Văn bản gốc / Nguồn hàng & lãi / Đọc lại] trang chi tiết đã bỏ các khối đó; danh sách có thùng rác xoá HĐ", async () => {
    test.skip(itemIds.length === 0, "HĐ chưa được xác nhận/khoá ở test trước");
    await page.goto(`${CW}/contracts/${cid}`);
    await settle(page);
    await expect(page.getByTestId("delete-contract")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Xoá hợp đồng$/ })).toHaveCount(0);
    const body = await page.locator("main").innerText();
    for (const gone of ["Văn bản gốc", "Nguồn hàng & lãi", "Đọc lại"])
      expect(body, `trang chi tiết không còn «${gone}»`).not.toContain(gone);
    await expect(page.getByRole("button", { name: "Đọc lại" })).toHaveCount(0);
    // Danh sách: hàng HĐ test có biểu tượng thùng rác (không còn nút Xoá ở chi tiết).
    await page.goto(`${CW}/contracts`);
    await settle(page);
    await page.getByPlaceholder(/Tìm/).first().fill(TAG);
    const row = page
      .locator("table tbody tr")
      .filter({ has: page.locator(`a[href="/contracts/${cid}"]`) });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("row-delete")).toBeVisible();
    await expect(row.getByTestId("row-delete")).toBeEnabled();
  });

  test("[luật K2: chuỗi nhiều phiên bản] HĐ có bản cập nhật: thùng rác khoá + tooltip, API DELETE ⇒ 409 CONTRACT_HAS_VERSIONS", async () => {
    test.setTimeout(480_000);
    test.skip(itemIds.length === 0, "HĐ chưa được xác nhận/khoá ở test trước");
    const up = await api.post(`${P}/contracts/${cid}/versions`, {
      headers: auth,
      multipart: {
        title: `${cidTitle} v2`,
        file: {
          name: `${TAG}-hop-dong-${RUN}-v2.md`,
          mimeType: "text/markdown",
          buffer: Buffer.from(`${CONTRACT_MD}\n\nPhụ lục cập nhật bản 2.`, "utf8"),
        },
      },
    });
    expect(up.status()).toBe(201);
    const v2 = ((await up.json()) as { id: string }).id;
    toClean.push(v2); // dọn: bản nháp v2 xoá trước, rồi v1 (nếu server không xoá được chuỗi, HĐ vẫn mang tiêu đề/tên E2E-DEPLOY để nhận ra)
    await waitRead(v2);
    // API: HĐ v1 (đã xác nhận, thuộc chuỗi nhiều bản) không xoá được.
    const del = await api.delete(`${P}/contracts/${cid}`, { headers: auth, data: {} });
    expect(del.status()).toBe(409);
    expect(JSON.stringify(await del.json())).toContain("CONTRACT_HAS_VERSIONS");
    // UI: hàng nào của chuỗi hiện trong danh sách và có nhiều phiên bản ⇒ thùng rác bị khoá kèm tooltip.
    await page.goto(`${CW}/contracts`);
    await settle(page);
    await page.getByPlaceholder(/Tìm/).first().fill(TAG);
    const rows = page
      .locator("table tbody tr")
      .filter({ has: page.locator(`a[href="/contracts/${cid}"], a[href="/contracts/${v2}"]`) });
    await expect(rows.first()).toBeVisible();
    const trash = rows.first().getByTestId("row-delete");
    await expect(trash).toBeDisabled();
    await expect(trash).toHaveAttribute("title", /nhiều phiên bản/);
  });

  test("[xoá HĐ một phiên bản] HĐ mới tải lên (một bản) xoá được bằng thùng rác ở danh sách", async () => {
    test.setTimeout(420_000);
    const up = await api.post(`${P}/contracts`, {
      headers: auth,
      multipart: {
        file: {
          name: `${TAG}-xoa-mot-ban-${RUN}.md`,
          mimeType: "text/markdown",
          buffer: Buffer.from(CONTRACT_MD, "utf8"),
        },
      },
    });
    expect(up.status()).toBe(201);
    const one = ((await up.json()) as { id: string }).id;
    toClean.push(one);
    await waitRead(one);
    await page.goto(`${CW}/contracts`);
    await settle(page);
    await page.getByPlaceholder(/Tìm/).first().fill(TAG);
    const row = page
      .locator("table tbody tr")
      .filter({ has: page.locator(`a[href="/contracts/${one}"]`) });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("row-delete")).toBeEnabled();
    await row.getByTestId("row-delete").click();
    await page.getByTestId("delete-confirm").click();
    await expect(page.locator(`a[href="/contracts/${one}"]`)).toHaveCount(0, { timeout: 30_000 });
    expect((await api.get(`${P}/contracts/${one}`, { headers: auth })).status()).toBe(404);
  });

  test.skip("[lỗi: 409 nghiệp vụ hiện «Dữ liệu vừa được cập nhật»] giao hàng vượt tồn kho hiện đúng thông điệp", () => {
    // Bỏ: dựng ca này cần HĐ bán đã xác nhận + mốc giao hàng vượt tồn kho (nhập kho/lô riêng, nhiều bước ghi vào tenant demo) — không dựng
    // "dễ" qua UI/API công khai; luật ánh xạ lỗi 409 → thông điệp đã có unit/e2e giả backend ở contracts-web.
  });
});

test.describe("15 lỗi người dùng báo (không cần HĐ tải lên)", () => {
  test("[lỗi: giá nhà cung cấp/lãi không hiện] tab «Nhà cung cấp & giá» của Sản phẩm & Giá hiện so sánh giá NCC và «Giá bán & lãi»", async () => {
    await page.goto(`${CW}/products`);
    await settle(page);
    const hrefs = (
      await page
        .locator("main a[href*='sp=']")
        .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
    ).slice(0, 12);
    expect(hrefs.length).toBeGreaterThan(0);
    let withPricing = 0;
    for (const h of hrefs) {
      await page.goto(`${CW}${h}${h.includes("?") ? "&" : "?"}ht=suppliers`);
      await settle(page);
      await expect(page.getByText(/So sánh giá nhà cung cấp/).first()).toBeVisible();
      if ((await page.getByTestId("psup-pricing").count()) > 0) {
        withPricing++;
        await expect(page.getByTestId("psup-pricing")).toContainText("Giá bán & lãi");
        await expect(page.getByText("Lãi / đơn vị")).toBeVisible();
        break;
      }
    }
    expect(withPricing, "ít nhất một SP demo hiện khối «Giá bán & lãi»").toBeGreaterThan(0);
  });

  test("[góp ý] gửi góp ý «E2E-DEPLOY…» ⇒ thành công (thẻ Trello kiểm bằng log server, test không gọi Trello)", async ({
    page: p,
  }) => {
    const msg = `${TAG} góp ý lỗi người dùng ${RUN}`;
    await p.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await login(p, CW);
    await settle(p);
    try {
      await p.getByRole("button", { name: "Góp ý về app" }).click();
      const panel = p
        .getByRole("complementary", { name: "Góp ý về app" })
        .or(p.getByRole("dialog"));
      await panel.getByLabel("Loại").selectOption("bug");
      await panel.getByLabel("Nội dung").fill(msg);
      await panel.locator("form").getByRole("button", { name: "Gửi góp ý" }).click();
      await expect(panel.getByText(/Cảm ơn/)).toBeVisible();
    } finally {
      await closeFeedback(p).catch(() => {});
    }
  });

  test("[lỗi: Cài đặt › Quy trình duyệt hiện «Nhóm xxxxxxxx»] tab hiện tên phòng (chỉ khi bật CONTRACTS_APPROVAL_ENGINE; không lưu luồng)", async () => {
    const r = await api.get(`${P}/approval-flow`, { headers: auth });
    const flow = r.status() === 200 ? ((await r.json()) as { steps?: unknown[] }) : null;
    test.skip(
      !flow?.steps,
      "CONTRACTS_APPROVAL_ENGINE chưa bật trên máy chủ (GET /approval-flow không trả luồng)",
    );
    const gr = await api.get(`${P}/groups`, { headers: auth });
    const groups = (gr.status() === 200 ? await gr.json() : []) as { id: string; name: string }[];
    await page.goto(`${CW}/overview`);
    await settle(page);
    await page.getByRole("button", { name: "Tài khoản" }).first().click();
    await page.getByRole("menuitem", { name: "Cài đặt", exact: true }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: /^Quy trình duyệt/ }).click();
    await expect(dlg.getByRole("heading", { name: "Quy trình duyệt hợp đồng" })).toBeVisible();
    await settle(page);
    const text = await dlg.innerText();
    expect(text, "không hiện mã nhóm cụt").not.toMatch(/Nhóm [0-9a-f]{8}/i);
    const used = JSON.stringify(flow?.steps ?? []);
    for (const g of groups) {
      if (used.includes(g.id))
        expect(text, `tên phòng «${g.name}» phải hiện thay vì mã`).toContain(g.name);
    }
    // Không bấm Lưu: đóng hộp, không đổi cấu hình demo.
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
  });
});

test.describe("15 app-perm · người dùng chỉ có Sổ Hợp Tác", () => {
  test.skip(
    !SHT_TENANT || !SHT_USER,
    "DEMO_SHT_TENANT / DEMO_SHT_USER chưa đặt (xem 14-app-perm-demo)",
  );

  test("[lỗi: user chỉ có Sổ Hợp Tác vẫn thấy Chat AI] bộ chọn app không có Chat AI", async ({
    page: p,
  }) => {
    await p.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
    await p.goto(`${CHAT}/login`);
    const pw = p.locator("input[type=password]").first();
    await pw.waitFor({ timeout: 45_000 });
    const tenant = p.getByRole("textbox", { name: /Mã công ty|Company code/ });
    if (await tenant.count()) await tenant.fill(SHT_TENANT);
    await p.getByRole("textbox", { name: /^(Tên đăng nhập|Username|Email)$/ }).fill(SHT_USER);
    await pw.fill(password());
    await p.getByRole("button", { name: /^(Đăng nhập|Sign in)$/ }).click();
    await p.waitForURL((u) => u.href.startsWith(CW) && !u.pathname.startsWith("/login"), {
      timeout: 45_000,
    });
    await settle(p);
    await p.getByRole("button", { name: /Ứng dụng|Apps/ }).click();
    await expect(p.getByRole("menuitem", { name: /Sổ Hợp Tác|Cooperation Ledger/ })).toBeVisible();
    await expect(p.getByRole("menuitem", { name: /Chat AI|AI Chat/ })).toHaveCount(0);
  });
});

test.describe("15 lỗi người dùng báo · đường tắt duyệt", () => {
  test("[lỗi: SP trống sau xác nhận + hộp «Gắn sản phẩm» không tắt khi bấm liên tục] 2a · đường tắt duyệt: Xác nhận và lưu ⇒ hộp ⇒ Xác nhận (bấm nhanh 2 lần) ⇒ hộp đóng; F5 ⇒ đã khoá, dòng có SP", async () => {
    test.setTimeout(300_000);
    await setApproval(false); // tắt duyệt cho tenant demo; luôn khôi phục ở finally (và afterAll)
    try {
      // HĐ phải tải lên SAU khi tắt duyệt (HĐ tải lúc bật duyệt đã có lượt engine, không đi đường tắt được).
      const idA = await uploadContract(`${TAG}-tat-duyet-${RUN}.md`);
      cid = idA;
      cidTitle = (await getDetail(idA)).title;
      await page.goto(`${CW}/contracts/${cid}`);
      await settle(page);
      // Nút của trang (testid confirm-save, khi không có lượt duyệt) hoặc của thẻ duyệt cấp 1 (lượt máy cũ vẫn mở khi tenant tắt duyệt).
      const confirm = page
        .getByTestId("confirm-save")
        .or(page.getByRole("button", { name: "Xác nhận và lưu", exact: true }))
        .first();
      await expect(confirm, "có nút «Xác nhận và lưu»").toBeVisible({ timeout: 30_000 });
      await confirm.click();
      const dlg = page.getByTestId("product-link-dialog");
      await expect(dlg).toContainText("Gắn sản phẩm");
      const ok = page.getByTestId("product-link-confirm");
      await ok.click();
      // bấm nhanh lần 2: có thể đã không còn nút (hộp đã đóng) — không được lỗi/treo
      await ok.click({ timeout: 1500 }).catch(() => {});
      await expect(dlg).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId("banner-locked")).toBeVisible({ timeout: 30_000 });
      await page.reload();
      await settle(page);
      await expect(page.getByTestId("banner-locked")).toBeVisible();
      await expect(page.getByText("Chưa gắn sản phẩm")).toHaveCount(0);
      const d = await getDetail(cid);
      expect(d.locked).toBe(true);
      expect(d.items.length).toBeGreaterThan(0);
      itemIds = d.items.map((i) => i.id);
      expect(d.items.filter((i) => i.product_id === null)).toEqual([]);
    } finally {
      await restoreApproval();
    }
  });
});

/** Đặt Xong mọi góp ý E2E-DEPLOY còn mở ở admin-web (như 10-feedback-original). */
async function closeFeedback(pg: Page): Promise<void> {
  await login(pg, ADMIN);
  await pg.goto(`${ADMIN}/feedback`);
  await settle(pg);
  const rows = pg.getByRole("row", { name: new RegExp(TAG) });
  for (let i = 0; i < 20 && (await rows.count()) > 0; i++) {
    const row = rows.first();
    if (/Xong/.test(await row.innerText())) break;
    await row.click();
    await pg.getByRole("dialog").getByLabel("Trạng thái").selectOption("done");
    await pg.getByRole("dialog").getByRole("button", { name: "Lưu" }).click();
    await settle(pg);
    await pg.keyboard.press("Escape").catch(() => {});
  }
}
