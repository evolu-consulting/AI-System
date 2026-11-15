// CR-159 · BÀI KIỂM HÀNH TRÌNH THẬT (bản test / prod): mỗi bước do ĐÚNG vai làm, khác người tạo (N2). Hai công ty tạm smoke-a / smoke-b đã được
// deploy/smoke/smoke-journey.ps1 tạo sẵn (giám đốc `gd` · trưởng phòng `tp` · nhân viên `nv`; quy trình «Duyệt hợp đồng gửi đi» / «Nhận hợp đồng từ đối tác»).
// Chỉ thao tác như người dùng thật (UI). Mỗi bước ghi Đạt / Không đạt / Bỏ qua + ảnh vào $SMOKE_OUT; bước lỗi KHÔNG ném (bước độc lập vẫn chạy).
// Bước «AI đọc hợp đồng» báo RIÊNG (lỗi AI không làm hỏng cả bài). Bước tin nhắn chỉ chạy khi CR-169 đã có trên môi trường (SMOKE_CR169=1).
import { expect, type Locator, type Page, test } from "@playwright/test";
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
  const submit = form
    .locator("button[type=submit]")
    .or(form.getByRole("button", { name: "Gửi", exact: true }));
  await submit.first().click();
  await expect(form).toBeHidden({ timeout: 60_000 });
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

/** Người duyệt: mở HĐ, bước `name` đang mở ⇒ (Nhận việc) ⇒ Duyệt/Đạt ⇒ bước «passed». */
async function approve(p: Page, id: string, name: string): Promise<void> {
  await p.goto(`${E.cw}/contracts/c/${id}`);
  const btn = p.locator("[data-approval=pass], [data-approval=approve]").first();
  const take = p.getByTestId("claim-take");
  await reloadUntil(p, async () => {
    await expect(stepOf(p, name)).toHaveAttribute("data-status", "open", { timeout: 4_000 });
    await expect(take.or(btn).first()).toBeVisible({ timeout: 4_000 });
  });
  if (await take.isVisible()) {
    await take.click();
    await expect(p.getByTestId("claim-state")).toContainText("Bạn đang giữ");
  }
  await btn.click();
  await expect(stepOf(p, name)).toHaveAttribute("data-status", "passed");
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
    const card = async (): Promise<Page> => {
      const p = await as(c, "gd");
      await p.goto(`${E.cw}/contracts/settings?sec=sign`);
      await expect(p.getByTestId("partner-confirm-status")).toBeVisible({ timeout: 30_000 });
      return p;
    };
    await S.run(`S4${c}`, `Danh bạ công ty bật · công ty ${c.toUpperCase()}`, async () => {
      expect(
        E.dir[c],
        "Danh bạ công ty TẮT mặc định khi tạo công ty mới — phải bật tay ở Quản trị › Hồ sơ (bài tự bật để đi tiếp)",
      ).not.toBe("off");
      const p = await card();
      await expect(p.getByTestId("partner-confirm-item-listed")).toHaveCount(0);
    });
    await S.run(
      `S5${c}`,
      `Khung «Gửi và nhận hợp đồng với đối tác» đủ điều kiện · ${c.toUpperCase()}`,
      async () => {
        const p = await card();
        const sum = (await p.getByTestId("partner-confirm-summary").innerText()).trim();
        expect(sum, `khung báo: ${sum}`).toContain("sẵn sàng gửi và nhận");
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
        await p.getByTestId("manual-entry").click();
        await p.getByRole("textbox", { name: /^Tên hợp đồng/ }).fill(TITLE);
        await p.getByTestId("manual-reconciled").click();
        const kind = p.getByRole("group", { name: /Loại/ }).getByRole("radio").first();
        if (await kind.count()) await kind.click();
        const save = p.getByRole("button", { name: /^(Xác nhận và lưu|Lưu thay đổi)/ }).first();
        if (await save.isEnabled()) await save.click();
      } else {
        await expect(p.getByRole("textbox", { name: /^Nhà cung cấp/ }))
          .not.toHaveValue("", { timeout: 60_000 })
          .catch(() => undefined);
      }
      const btn = p.getByRole("button", { name: "Gửi duyệt" });
      await expect(btn).toBeVisible({ timeout: 60_000 });
      await expect(async () => {
        if (await btn.isVisible()) await btn.click({ timeout: 5_000 });
        await expect(btn).toBeHidden({ timeout: 10_000 });
      }).toPass({ timeout: 60_000 });
      await expect(stepOf(p, "Trưởng phòng duyệt")).toBeVisible({ timeout: 120_000 });
    },
    ["S6"],
  );

  await S.run(
    "S8",
    "Trưởng phòng A duyệt",
    async () => approve(await as("a", "tp"), cid, "Trưởng phòng duyệt"),
    ["S7"],
  );
  await S.run(
    "S9",
    "Giám đốc A «Chuẩn bị ký»",
    async () => doTask(await as("a", "gd"), "Chuẩn bị ký"),
    ["S8"],
  );
  await S.run(
    "S10",
    "Giám đốc A Ký (tải bản đã ký)",
    async () => uploadSigned(await as("a", "gd"), cid),
    ["S9"],
  );
  await S.run(
    "S11",
    "Giám đốc A «Nhờ đối tác ký?» = Có",
    async () => {
      await doTask(await as("a", "gd"), "Nhờ đối tác ký", async (form) => {
        const sel = form.locator("select").first();
        if (await sel.count()) await sel.selectOption({ label: "Có" });
        else await form.getByLabel("Có", { exact: true }).check();
      });
    },
    ["S10"],
  );
  await S.run(
    "S12",
    "Giám đốc A chọn đối tác Smoke B + người nhận ⇒ Gửi",
    async () => {
      await doTask(await as("a", "gd"), "Chọn đối tác", async (form) => {
        const partner = form.locator("[data-flow-field=partner_tax_code]");
        await partner.getByRole("searchbox").fill(TAX.b);
        const opt = partner.locator("select option", { hasText: TAX.b });
        await expect(opt, "Smoke B không có trong danh sách đối tác của A").toHaveCount(1, {
          timeout: 30_000,
        });
        await partner.locator("select").selectOption((await opt.getAttribute("value")) ?? "");
        await form
          .locator("[data-flow-field=partner_email] input")
          .fill("smoke-b-gd@smoke.invalid");
      });
    },
    ["S11"],
  );

  await S.run(
    "S13",
    "Giám đốc B nhận lời mời (băng «Nhận»)",
    async () => {
      const p = await as("b", "gd");
      await p.goto(`${E.cw}/contracts/list`);
      const invite = p.getByTestId("partner-invite").first();
      await reloadUntil(p, async () => expect(invite).toBeVisible({ timeout: 4_000 }));
      await invite.getByRole("button", { name: /Nhận/ }).click();
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

  await S.run("S17", "Kết nối công ty: A «Tìm công ty» mời B, B đồng ý", async () => {
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
  });

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
        const a = await as("a", "nv");
        await a.goto(`${E.cw}/contracts/partners`);
        await a.getByRole("button", { name: "Nhắn tin" }).first().click();
        await a.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(`Xin chào ${RUN}`);
        await a.getByTestId("cc-file-input").setInputFiles({
          name: "kem-theo.pdf",
          mimeType: "application/pdf",
          buffer: await pdfOf(["TEP KEM THEO"]),
        });
        await a.getByRole("button", { name: "Gửi", exact: true }).click();
        const b = await as("b", "nv");
        await b.goto(`${E.cw}/contracts/messages`);
        const msg = b.getByText(`Xin chào ${RUN}`).first();
        await reloadUntil(b, async () => expect(msg).toBeVisible({ timeout: 4_000 }));
        await b.getByRole("textbox", { name: "Nhập tin nhắn" }).fill(`Đã nhận ${RUN}`);
        await b.getByRole("button", { name: "Gửi", exact: true }).click();
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
