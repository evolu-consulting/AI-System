// CR-159 · BÀI KIỂM HÀNH TRÌNH THẬT (bản test / prod): mỗi bước do ĐÚNG vai làm, khác người tạo (N2). Hai công ty tạm smoke-a / smoke-b đã được
// deploy/smoke/smoke-journey.ps1 tạo sẵn (giám đốc `gd` · trưởng phòng `tp` · nhân viên `nv`; quy trình «Duyệt hợp đồng gửi đi» / «Nhận hợp đồng từ đối tác»).
// Chỉ thao tác như người dùng thật (UI). Mỗi bước ghi Đạt / Không đạt / Bỏ qua + ảnh vào $SMOKE_OUT; bước lỗi KHÔNG ném (bước độc lập vẫn chạy).
// Bước «AI đọc hợp đồng» báo RIÊNG (lỗi AI không làm hỏng cả bài). Bước tin nhắn chỉ chạy khi CR-169 đã có trên môi trường (SMOKE_CR169=1).

import { expect, type Locator, type Page, test } from "@playwright/test";
import { pickOption } from "../_kit/ui";
import { type Co, E, login, NAME, pdfOf, type Role, Steps, TAX } from "./_kit";

const RUN = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
const UUID = /\/contracts\/c\/([0-9a-f-]{36})/;
const TITLE = `Hợp đồng mua bán Smoke ${RUN}`;
const stepOf = (p: Page, name: string): Locator =>
  p.getByTestId(/^approval-step-\d+$/).filter({ hasText: name });

async function reloadUntil(p: Page, check: () => Promise<void>, ms = 120_000): Promise<void> {
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await p.reload();
    await check();
  }).toPass({ timeout: ms, intervals: [2_000, 4_000, 6_000] });
}

/** Việc dạng form ở «Việc của tôi» (đúng tên bước) ⇒ mở ⇒ `fill` (nếu có) ⇒ bấm nút gửi của form. */
async function doTask(
  p: Page,
  stepName: string,
  fill?: (form: Locator) => Promise<void>,
): Promise<void> {
  await p.goto(`${E.cw}/contracts/approvals`);
  const row = p
    .getByTestId(/^(requests-waiting-row|approval-task-row)$/)
    .filter({ hasText: stepName })
    .first();
  await reloadUntil(p, async () => expect(row).toBeVisible({ timeout: 4_000 }));
  await row.click();
  const form = p.locator('form[data-flow="form"]').first();
  await expect(form).toBeVisible({ timeout: 60_000 });
  await fill?.(form);
  // Ô của form mang id `flow-<bước>-<trường>` (FormStep.tsx): bước kế cùng người có thể hiện form NGAY chỗ cũ ⇒ chờ ô của
  // ĐÚNG bước này biến mất, không chờ «form nào đó» ẩn.
  const own = await form.locator("[id^=flow-]").first().getAttribute("id");
  const submit = form
    .locator("button[type=submit]")
    .or(form.getByRole("button", { name: "Gửi", exact: true }));
  await submit.first().click();
  if (own) await expect(p.locator(`[id="${own}"]`)).toHaveCount(0, { timeout: 60_000 });
  else await expect(form).toBeHidden({ timeout: 60_000 });
}

/** Trang HĐ: bước ký ⇒ «tải bản đã ký» (ký qua = tải bản đã ký). */
async function uploadSigned(p: Page, id: string): Promise<void> {
  await p.goto(`${E.cw}/contracts/c/${id}`);
  const box = p.getByTestId("signed-upload-box");
  await reloadUntil(p, async () => expect(box).toBeVisible({ timeout: 4_000 }));
  await box.getByTestId("signed-upload-input").setInputFiles({
    name: `da-ky-${RUN}.pdf`,
    mimeType: "application/pdf",
    buffer: await pdfOf([`BAN DA KY ${RUN}`, "Da ky: Smoke"]),
  });
  await box.getByTestId("signed-upload-submit").click();
  await expect(p.getByTestId("signed-upload-box")).toHaveCount(0, { timeout: 60_000 });
}

/**
 * Bước Duyệt «Ý kiến + chữ ký hoặc tệp» (reviewNew: evidence opinion_plus) ⇒ bấm Duyệt chỉ MỞ ô bằng chứng: ghi ý kiến + đính 1 tệp
 * ⇒ bấm nút Duyệt của ô (`request-approve-confirm`). Không có ô ⇒ bỏ qua. (Trước đây bấm nút cuối = «Huỷ» ⇒ không gửi gì.)
 */
async function giveEvidence(p: Page): Promise<void> {
  const ev = p.locator("[data-approval=evidence]");
  if (!(await ev.isVisible({ timeout: 3_000 }).catch(() => false))) return;
  await ev.locator("#evidence-note").fill(`Đồng ý (smoke ${RUN})`);
  const files = ev.locator("#evidence-files");
  if (await files.count()) {
    // Thẻ tệp hiện NGAY khi chọn, trước khi POST /attachments xong ⇒ bấm Duyệt sớm = tệp chưa vào bản nháp ⇒ báo thiếu bằng chứng (S8 lượt 231927).
    const uploaded = p.waitForResponse(
      (r) => r.request().method() === "POST" && /\/attachments$/.test(new URL(r.url()).pathname),
      { timeout: 30_000 },
    );
    await files.setInputFiles({
      name: `y-kien-${RUN}.pdf`,
      mimeType: "application/pdf",
      buffer: await pdfOf([`Y KIEN DUYET ${RUN}`]),
    });
    expect((await uploaded).status(), "đính tệp bằng chứng").toBeLessThan(300);
    await expect(ev.getByTestId("evidence-file-list")).toBeVisible({ timeout: 30_000 });
  }
  await ev.getByTestId(/^request-(approve|pass)-confirm$/).click();
}

/** Người duyệt: mở HĐ, bước `name` đang mở ⇒ (Nhận việc) ⇒ Duyệt/Đạt (+ ô bằng chứng) ⇒ bước «passed». */
async function approve(p: Page, id: string, name: string): Promise<void> {
  await p.goto(`${E.cw}/contracts/c/${id}`);
  const btn = p.getByTestId(/^act-(approve|pass)$/); // nút chính trên đầu trang (HeadActions)
  const take = p.getByTestId("claim-take");
  await reloadUntil(p, async () => {
    await expect(stepOf(p, name)).toHaveAttribute("data-status", "open", { timeout: 4_000 });
    await expect(take.or(btn).first()).toBeVisible({ timeout: 4_000 });
  });
  if (await take.isVisible()) {
    await take.click();
    await expect(p.getByTestId("claim-state")).toContainText("Bạn đang giữ");
  }
  const posts: string[] = [];
  const onRes = async (r: import("@playwright/test").Response) => {
    const u = new URL(r.url());
    if (/.(js|css|png|svg|woff2?|map)$/.test(u.pathname)) return;
    const body =
      r.request().method() === "GET" ? "" : (await r.text().catch(() => "")).slice(0, 120);
    posts.push(`${r.request().method()} ${u.pathname.slice(0, 60)} ${r.status()} ${body}`);
  };
  p.on("response", onRes);
  p.on("request", (r) => {
    if (r.method() !== "GET")
      posts.push(`REQ ${r.method()} ${new URL(r.url()).pathname.slice(0, 60)}`);
  });
  p.on("requestfailed", (r) =>
    posts.push(
      `FAILED ${r.method()} ${new URL(r.url()).pathname.slice(0, 60)} ${r.failure()?.errorText}`,
    ),
  );
  p.on("console", (m) => {
    if (m.type() === "error") posts.push(`CONSOLE ${m.text().slice(0, 100)}`);
  });
  p.on("pageerror", (e) => posts.push(`PAGEERR ${String(e.message).slice(0, 100)}`));
  await btn.click();
  await giveEvidence(p);
  // Bước xác nhận HĐ (finalizes_on_approve) ⇒ hộp «Gắn sản phẩm»: giữ lựa chọn sẵn, xác nhận.
  const plink = p.getByTestId("product-link-confirm");
  if (await plink.isVisible({ timeout: 3_000 }).catch(() => false)) await plink.click();
  // Máy duyệt chạy bất đồng bộ sau khi bấm: có thể qua «running» trước «passed».
  await expect(stepOf(p, name))
    .toHaveAttribute("data-status", "passed", { timeout: 60_000 })
    .catch(async () => {
      const st = await stepOf(p, name).getAttribute("data-status");
      const dlg = await p
        .locator("[role=dialog],[data-approval=evidence],[role=alert]")
        .allInnerTexts();
      throw new Error(
        `bước «${name}» sau khi bấm Duyệt: data-status=${st}; mạng: ${
          posts
            .filter((x) => !x.startsWith("GET"))
            .slice(0, 8)
            .join(" ; ") || `(không có yêu cầu ghi; ${posts.length} GET)`
        }; hộp/cảnh báo: ${dlg.join(" | ").slice(0, 200)}`,
      );
    });
}

test("Hành trình thật: hai công ty gửi/nhận hợp đồng, kết nối, tin nhắn, AI đọc", async ({
  browser,
}) => {
  const S = new Steps(E.out);
  const pages = new Map<string, Page>();
  /** Phiên Sổ Hợp Tác của một người (đăng nhập MỘT lần; giới hạn 30 lượt/10 phút/IP). */
  const as = async (c: Co, r: Role): Promise<Page> => {
    const k = `${c}-${r}`;
    if (!pages.has(k)) {
      const ctx = await browser.newContext({
        locale: "vi-VN",
        viewport: { width: 1440, height: 900 },
      });
      const p = await ctx.newPage();
      await login(p, E.cw, c, r);
      pages.set(k, p);
    }
    return S.use(pages.get(k) as Page);
  };
  const other = async (base: string): Promise<Page> => {
    const ctx = await browser.newContext({
      locale: "vi-VN",
      viewport: { width: 1440, height: 900 },
    });
    const p = S.use(await ctx.newPage());
    await login(p, base, "a", "gd");
    return p;
  };
  const noDenied = async (p: Page): Promise<void> => {
    await p.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await expect(p.getByText(/chưa có quyền/i)).toHaveCount(0);
  };
  let cid = "";
  let bid = "";

  await S.run("S1", "Đăng nhập Sổ Hợp Tác (giám đốc A) · không «chưa có quyền»", async () => {
    const p = await as("a", "gd");
    await expect(p.getByRole("link", { name: "Tổng quan" }).first()).toBeVisible();
    await noDenied(p);
  });
  await S.run("S2", "Đăng nhập web Quản trị (giám đốc A)", async () => {
    const p = await other(E.admin);
    await noDenied(p);
    await expect(p).not.toHaveURL(/\/login/);
  });
  await S.run("S3", "Đăng nhập Chat AI (giám đốc A) · thấy thẻ Sổ Hợp Tác", async () => {
    const p = await other(E.chat);
    await expect(p.getByTestId("portal-tile-contracts")).toBeVisible();
    await noDenied(p);
  });

  for (const c of ["a", "b"] as const) {
    // CR-185: mục «Kết nối» đã bỏ; điều kiện đối tác là cảnh báo vàng ở «Quy trình duyệt» — ĐỦ điều kiện ⇒ không có cảnh báo nào.
    const card = async (): Promise<Page> => {
      const p = await as(c, "gd");
      const loaded = p.waitForResponse((r) => /\/partner-confirm(\?|$)/.test(r.url()), {
        timeout: 30_000,
      });
      await p.goto(`${E.cw}/contracts/settings?sec=flow`);
      await expect(p.getByTestId("flow-current-title")).toBeVisible({ timeout: 30_000 });
      await loaded;
      return p;
    };
    const noWarn = async (p: Page): Promise<void> => {
      await expect(p.getByTestId("flow-partner-warn")).toHaveCount(0);
      await expect(p.getByTestId("flow-receive-warn")).toHaveCount(0);
      if ((await p.getByTestId("flow-select").count()) > 0) {
        await p.getByTestId("flow-select").click();
        await expect(
          p.locator('[data-testid^="flow-option-"]').filter({ hasText: "⚠" }),
        ).toHaveCount(0);
        await p.keyboard.press("Escape");
      }
    };
    await S.run(`S4${c}`, `Danh bạ công ty bật · công ty ${c.toUpperCase()}`, async () => {
      expect(
        E.dir[c],
        "Danh bạ công ty TẮT mặc định khi tạo công ty mới — phải bật tay ở Quản trị › Hồ sơ (bài tự bật để đi tiếp)",
      ).not.toBe("off");
      const p = await card();
      await expect(p.getByTestId("flow-current-title")).toBeVisible();
      await expect(p.getByRole("button", { name: /^Kết nối/ })).toHaveCount(0);
      await noWarn(p);
    });
    await S.run(
      `S5${c}`,
      `Quy trình duyệt không có cảnh báo điều kiện đối tác · ${c.toUpperCase()}`,
      async () => {
        const p = await card();
        await noWarn(p);
      },
    );
  }

  await S.run("S6", "Nhân viên A tải hợp đồng (PDF) lên", async () => {
    const p = await as("a", "nv");
    await p.goto(`${E.cw}/contracts/list`);
    await p.locator('input[type="file"]').setInputFiles({
      name: `hop-dong-smoke-${RUN}.pdf`,
      mimeType: "application/pdf",
      buffer: await pdfOf([
        "HOP DONG MUA BAN HANG HOA",
        `So hop dong: SMK-${RUN}`,
        "Ngay ky: 15/11/2026. Thoi han: 12 thang.",
        `Ben A (Ben mua): Cong ty Smoke A, MST ${TAX.a}`,
        `Ben B (Ben ban): Cong ty Smoke B, MST ${TAX.b}`,
        "Dieu 1. Hang hoa: 100 thung nuoc suoi, don gia 120.000 dong/thung.",
        "Dieu 2. Gia tri hop dong: 12.000.000 dong (chua VAT).",
        "Dieu 3. Thanh toan trong 30 ngay ke tu ngay giao hang.",
      ]),
    });
    await p.getByTestId("upload-confirm").click();
    await p.waitForURL(UUID, { timeout: 60_000 });
    cid = UUID.exec(p.url())?.[1] ?? "";
    expect(cid).not.toBe("");
  });

  let manual = false;
  await S.run(
    "AI",
    "AI đọc hợp đồng (báo riêng, không làm hỏng cả bài)",
    async () => {
      const p = await as("a", "nv");
      const send = p.getByRole("button", { name: "Gửi duyệt" });
      const fail = p.getByTestId("manual-entry");
      await expect(send.or(fail)).toBeVisible({ timeout: 420_000 });
      if (await fail.isVisible()) {
        manual = true;
        throw new Error(
          `AI đọc lỗi: ${(await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200)}`,
        );
      }
      await expect(p.getByRole("textbox", { name: /^Tên hợp đồng/ })).not.toHaveValue("", {
        timeout: 120_000,
      });
      return "AI đọc xong, điền được tên hợp đồng";
    },
    ["S6"],
  );

  await S.run(
    "S7",
    "Nhân viên A «Gửi duyệt» (nhập tay + chọn Loại nếu AI lỗi)",
    async () => {
      const p = await as("a", "nv");
      if (manual) {
        const resp = p.waitForResponse((r) => r.url().includes("manual-entry"), {
          timeout: 30_000,
        });
        await p.getByTestId("manual-entry").click();
        const r = await resp;
        const body = (await r.text()).slice(0, 200);
        await expect(
          p.getByTestId("manual-banner"),
          `manual-entry → ${r.status()} ${body}`,
        ).toBeVisible({ timeout: 30_000 });
        await p.getByRole("textbox", { name: /^Tên hợp đồng/ }).fill(TITLE);
        const eff = p.getByLabel(/^Hiệu lực từ/);
        if ((await eff.count()) && (await eff.inputValue()) === "") await eff.fill("2026-11-15");
        // CR-157: ô «Tôi đã đối chiếu…» bị khoá khi form còn sửa chưa lưu (lưu sửa xoá đối chiếu) ⇒ điền → Lưu nháp → mới tích.
        const kind = p.getByRole("group", { name: /Loại/ }).getByRole("radio").first();
        if (await kind.count()) await kind.click();
        await p.getByRole("button", { name: "Thao tác" }).click();
        await p.getByRole("menuitem", { name: "Lưu nháp" }).click();
        const tick = p.getByTestId("manual-reconciled");
        await expect(tick).toBeEnabled({ timeout: 30_000 });
        await tick.click();
        await expect(tick).toBeChecked({ timeout: 30_000 });
      } else {
        await expect(p.getByRole("textbox", { name: /^Nhà cung cấp/ }))
          .not.toHaveValue("", { timeout: 60_000 })
          .catch(() => undefined);
      }
      // «Hiệu lực từ» bắt buộc: AI không luôn điền được (ảnh S7: «Thiếu: Hiệu lực từ») ⇒ người dùng điền tay như thật.
      const from = p.getByLabel(/^Hiệu lực từ/);
      if (await from.count()) {
        if ((await from.inputValue()) === "") {
          await from.fill("2026-11-15");
          await p.getByRole("button", { name: "Thao tác" }).click();
          await p.getByRole("menuitem", { name: "Lưu nháp" }).click();
        }
      }
      const btn = p.getByRole("button", { name: "Gửi duyệt" });
      await expect(btn).toBeVisible({ timeout: 60_000 });
      // Gửi duyệt ⇒ (HĐ có dòng hàng) hộp «Gắn sản phẩm» ⇒ Xác nhận (mặc định «Tạo sản phẩm mới») ⇒ hộp đóng. Không dùng «nút Gửi duyệt
      // ẩn» làm dấu xong: hộp mở ra khiến nền bị aria-hidden ⇒ nút «ẩn» dù hộp chưa được xác nhận (lỗi S7 ngày 2026-11-15: không có POST nào sau hộp).
      const gan = p.getByRole("dialog", { name: /Gắn sản phẩm/ });
      await btn.click();
      await expect(gan.or(stepOf(p, "Trưởng phòng duyệt")).first()).toBeVisible({
        timeout: 60_000,
      });
      if (await gan.isVisible()) {
        await gan.getByRole("button", { name: "Xác nhận", exact: true }).click();
        await expect(gan, "hộp «Gắn sản phẩm» còn đó sau Xác nhận").toBeHidden({ timeout: 30_000 });
      }
      // Đã gửi: băng «Thông tin khoá trong lúc duyệt…» (ảnh lượt 183903); danh sách bước nạp sau ⇒ chờ ĐƯỢC NẠP (có trong trang) chứ không đòi đang nằm trong khung nhìn.
      await reloadUntil(p, async () => {
        await expect(p.getByText(/Thông tin khoá trong lúc duyệt/)).toBeVisible({ timeout: 4_000 });
        await expect(stepOf(p, "Trưởng phòng duyệt")).toHaveCount(1, { timeout: 4_000 });
      });
    },
    ["S6"],
  );

  await S.run(
    "S8",
    "Trưởng phòng A duyệt",
    async () => approve(await as("a", "tp"), cid, "Trưởng phòng duyệt"),
    ["S7"],
  );
  // CR-165 (tenant-flows.data.ts `gate`): nhánh có trưởng phòng duyệt nhảy thẳng tới «Ký hợp đồng» (`next_step`);
  // «Chuẩn bị ký» chỉ ở nhánh người gửi là cấp cao nhất ⇒ sau S8 giám đốc A Ký luôn (không có S10 riêng).
  await S.run(
    "S9",
    "Giám đốc A Ký (tải bản đã ký) · không qua «Chuẩn bị ký»",
    async () => uploadSigned(await as("a", "gd"), cid),
    ["S8"],
  );
  await S.run(
    "S11",
    "Giám đốc A «Nhờ đối tác ký?» = Có",
    async () => {
      await doTask(await as("a", "gd"), "Nhờ đối tác ký", async (form) => {
        const sel = form.getByRole("combobox").first();
        if (await sel.count()) await pickOption(sel, { label: "Có" });
        else await form.getByLabel("Có", { exact: true }).check();
      });
    },
    ["S9"],
  );
  // Đối tác chỉ chọn được khi ĐÃ kết nối (FL3-4) ⇒ S17 chạy trước S12; sau đó B không còn băng lời mời.
  await S.run(
    "S17",
    "Kết nối công ty: A «Tìm công ty» mời B, B đồng ý (trước khi gửi hợp đồng)",
    async () => {
      const a = await as("a", "gd");
      await a.goto(`${E.cw}/contracts/partners`);
      await a.getByRole("button", { name: "Tìm công ty" }).click();
      const dlg = a.getByRole("dialog", { name: "Tìm công ty để kết nối" });
      await dlg.getByLabel("Tên công ty hoặc mã số thuế").fill(NAME.b);
      const row = dlg.getByTestId("connect-results").getByRole("listitem").first();
      await expect(row).toContainText(NAME.b, { timeout: 30_000 });
      await row.getByRole("button", { name: "Gửi lời mời kết nối" }).click();
      await a
        .getByRole("dialog", { name: /^Gửi lời mời cho/ })
        .getByRole("button", { name: "Gửi lời mời", exact: true })
        .click();
      const b = await as("b", "gd");
      await b.goto(`${E.cw}/contracts/partners`);
      const band = b.getByTestId("connect-invite").filter({ hasText: NAME.a });
      await reloadUntil(b, async () => expect(band).toBeVisible({ timeout: 4_000 }));
      await band.getByRole("button", { name: "Đồng ý", exact: true }).click();
      await expect(b.getByTestId("connected-list")).toContainText(NAME.a);
    },
    ["S11"],
  );
  await S.run(
    "S12",
    "Giám đốc A chọn đối tác Smoke B + người nhận ⇒ Gửi",
    async () => {
      await doTask(await as("a", "gd"), "Chọn đối tác", async (form) => {
        const partner = form.locator("[data-flow-field=partner_tax_code]");
        await partner.getByRole("searchbox").fill(TAX.b);
        await partner.getByRole("combobox").click();
        const opt = form.page().getByRole("option", { name: new RegExp(TAX.b) });
        await expect(opt, "Smoke B không có trong danh sách đối tác của A").toHaveCount(1, {
          timeout: 30_000,
        });
        await opt.click();
        await form
          .locator("[data-flow-field=partner_email] input")
          .fill("smoke-b-gd@smoke.invalid");
      });
    },
    ["S17"],
  );

  await S.run(
    "S13",
    "Giám đốc B: đã kết nối ⇒ KHÔNG còn băng lời mời; thấy hợp đồng ở «Đối tác gửi»",
    async () => {
      const p = await as("b", "gd");
      await p.goto(`${E.cw}/contracts/list?source=partner`);
      const row = p
        .getByRole("row")
        .filter({ has: p.getByTestId("row-view") })
        .first();
      await reloadUntil(p, async () => expect(row).toBeVisible({ timeout: 4_000 }));
      await expect(p.getByTestId("partner-invite")).toHaveCount(0);
    },
    ["S12"],
  );
  await S.run(
    "S14",
    "B thấy hợp đồng của A ở «Đối tác gửi»",
    async () => {
      const p = await as("b", "gd");
      await p.goto(`${E.cw}/contracts/list?source=partner`);
      const row = p
        .getByRole("row")
        .filter({ has: p.getByTestId("row-view") })
        .first();
      await reloadUntil(p, async () => expect(row).toBeVisible({ timeout: 4_000 }));
      await row.getByTestId("row-view").click();
      await p.waitForURL(UUID, { timeout: 30_000 });
      bid = UUID.exec(p.url())?.[1] ?? "";
    },
    ["S13"],
  );
  await S.run(
    "S15",
    "B «Chuẩn bị ký» + ký (tải bản đã ký) + Đồng ý",
    async () => {
      const p = await as("b", "gd");
      await doTask(p, "Chuẩn bị ký");
      await uploadSigned(p, bid);
      await p.goto(`${E.cw}/contracts/c/${bid}`);
      const co = p.getByRole("button", { name: /Đồng ý ký cùng lúc|Đồng ý/ }).first();
      if (await co.isVisible().catch(() => false)) await co.click();
    },
    ["S14"],
  );
  await S.run(
    "S16",
    "A thấy «Đối tác đã xác nhận»",
    async () => {
      const p = await as("a", "nv");
      await p.goto(`${E.cw}/contracts/c/${cid}`);
      await reloadUntil(
        p,
        async () =>
          expect(p.getByText("Đối tác đã xác nhận").first()).toBeVisible({ timeout: 4_000 }),
        150_000,
      );
    },
    ["S15"],
  );

  if (!E.cr169) {
    S.skip(
      "S18",
      "Tin nhắn A→B kèm tệp, B thấy + trả lời",
      "CR-169 chưa có trên môi trường này (image không có pmsg_send) — bỏ qua",
    );
  } else {
    await S.run(
      "S18",
      "Tin nhắn: nhân viên A nhắn 1 người B kèm tệp, B thấy + trả lời",
      async () => {
        // Nhân viên (không Toàn quyền) không thấy khối «Công ty đã kết nối»: đi đường «Tin nhắn» › chip công ty › tìm người.
        const a = await as("a", "nv");
        await a.goto(`${E.cw}/contracts/messages`);
        // Chờ chip bật + kết quả đúng người B rồi mới bấm: bấm ngay dòng đầu từng chọn nhầm đồng nghiệp A (danh sách «công ty mình» chưa đổi)
        // ⇒ tin đi vào cuộc NỘI BỘ A, B không bao giờ thấy (bản test 20261115: hub.pmsg_threads 0 dòng, msg_conversations A có cuộc nv↔gd).
        await a.getByTestId("tab-partner").click({ timeout: 60_000 });
        await a
          .getByTestId("partner-item")
          .filter({ hasText: /Smoke B/ })
          .first()
          .click();
        await expect(a.getByTestId("tab-partner")).toHaveAttribute("aria-pressed", "true");
        await a
          .getByRole("searchbox", { name: "Tìm người, nhóm, công ty" })
          .fill("Nhân viên Smoke B");
        const person = a.getByTestId("people-results").getByTestId("person-row").first();
        await expect(person).toContainText("Nhân viên Smoke B", { timeout: 30_000 });
        await person.click();
        await expect(a.getByTestId("chat-company")).toContainText("Smoke B");
        const files = a.getByTestId("composer-file-input");
        await files.setInputFiles({
          name: "kem-theo.pdf",
          mimeType: "application/pdf",
          buffer: await pdfOf(["TEP KEM THEO"]),
        });
        const drafts = a.getByTestId("draft-list");
        await expect(drafts).toContainText("kem-theo.pdf");
        await expect(drafts).not.toContainText("Đang tải");
        await a.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(`Xin chào ${RUN}`);
        await a.getByRole("button", { name: "Gửi", exact: true }).click();
        await expect(a.getByTestId("msg-row").filter({ hasText: `Xin chào ${RUN}` })).toBeVisible();
        const b = await as("b", "nv");
        await b.goto(`${E.cw}/contracts/messages`);
        const conv = b.getByTestId("conv-row").filter({ hasText: "Nhân viên Smoke A" });
        // CR-178: mặc định «Tất cả» = cuộc gần đây
        await reloadUntil(b, async () => {
          await expect(conv).toBeVisible({ timeout: 4_000 });
        });
        await conv.click();
        await expect(b.getByText(`Xin chào ${RUN}`).first()).toBeVisible({ timeout: 30_000 });
        await b.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(`Đã nhận ${RUN}`);
        await b.getByRole("button", { name: "Gửi", exact: true }).click();
        await expect(b.getByTestId("msg-row").filter({ hasText: `Đã nhận ${RUN}` })).toBeVisible();
      },
      ["S17"],
    );
  }

  for (const p of pages.values()) await p.context().close();
  const bad = S.failed;
  console.log("\n== KẾT QUẢ ==");
  for (const r of S.rows)
    console.log(
      `${r.status.padEnd(14)} ${r.id.padEnd(4)} ${r.name}${r.note ? ` — ${r.note}` : ""}`,
    );
  expect(
    bad.map((r) => `${r.id}: ${r.note ?? ""}`),
    "bước sản phẩm không đạt",
  ).toEqual([]);
});
