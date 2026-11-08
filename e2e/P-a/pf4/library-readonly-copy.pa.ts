// CR-121 c17 · e2e P-a PF4 (VIẾT, CHƯA CHẠY — chạy một lần cuối đợt): tenant_admin Adm mở quy trình THƯ VIỆN từ Công ty › Quy trình ⇒
// CHỈ XEM (không Xuất bản/Lưu) + "Sao chép cho công ty này" ⇒ bản riêng sửa được, "Sao từ thư viện: … · vN"; gọi lại (API) ⇒ 200 cùng bản.
import { expect, test } from "@playwright/test";
import { ACME, ADMIN_URL, adminLogin, hub, settle, tok, withSql } from "../_pa-support";

test.afterEach(() => settle());

test("CR-121 c17 · thư viện chỉ xem ⇒ Sao chép ⇒ bản riêng sửa được; sao lần hai ⇒ 200 cùng bản", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    // quy trình thư viện đã xuất bản của khe duyệt hợp đồng (seed hub 0069), do platform tạo — không bật sẵn gì cho Acme
    const libId = await withSql(
      async (sql) =>
        (
          await sql`select id::text as id from hub.process_defs
            where tenant_id is null and slot = 'contracts.approval' and published_version is not null and deleted_at is null
            order by created_at limit 1`
        )[0]?.id as string,
    );
    expect(libId).toBeTruthy();
    // điều kiện của Hub cho phép xem thư viện: có bản phát hành đúng published_version (chẩn đoán rõ nếu thiếu dữ liệu mồi)
    const rel = await withSql(
      async (sql) =>
        (
          await sql`select count(*)::int as n from hub.process_def_releases r join hub.process_defs d on d.id = r.def_id and r.rel_version = d.published_version where d.id = ${libId}`
        )[0]?.n as number,
    );
    expect({ libId, rel }).toEqual({ libId, rel: 1 });
    // pf4/editor-steps (cùng job) có thể đã sao chép thư viện này cho Acme: đưa về trạng thái "chưa sao chép" để kiểm sao chép LẦN ĐẦU
    await withSql(
      (sql) =>
        sql`update hub.process_defs set deleted_at = now() where tenant_id = ${ACME} and source_template_id = ${libId} and deleted_at is null`,
    );
    await adminLogin(p);
    await p.goto(`${ADMIN_URL}/processes/${libId}?company=${ACME}`);

    // chỉ xem: nói rõ, có nút Sao chép, KHÔNG có sửa/xuất bản; sơ đồ chỉ đọc
    const view = p.getByTestId("library-readonly");
    await expect(view.getByText("Quy trình dùng chung — chỉ xem.")).toBeVisible();
    await expect(p.getByRole("button", { name: /^Xuất bản/ })).toHaveCount(0);
    await expect(p.getByRole("button", { name: "Lưu", exact: true })).toHaveCount(0);
    await expect(p.getByTestId("library-flow-canvas")).toBeVisible(); // flow Thư viện theo sự kiện (CR-122): chỉ có sơ đồ chỉ đọc

    // Sao chép ⇒ mở bản riêng (đường dẫn khác), ghi nguồn, sửa được
    await p.getByTestId("library-copy").click();
    await expect(p.getByText("Đã áp dụng cho công ty.")).toBeVisible();
    await p.waitForURL(
      (u) => /\/processes\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(libId),
    );
    await expect(p.getByTestId("copy-source")).toContainText("Sao từ thư viện:");
    await expect(p.getByRole("button", { name: "Lưu", exact: true })).toBeVisible();

    // sao lần hai (hai admin bấm cùng lúc / bấm lại) ⇒ 200 created:false, đúng bản vừa tạo
    const again = await hub(
      await tok("Adm"),
      "POST",
      `/tenants/${ACME}/process-defs/${libId}/clone-for-company`,
      {},
    );
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);
    expect(p.url()).toContain(again.json.def_id);
    // mở lại thư viện: thay nút Sao chép bằng "Mở bản riêng"
    await p.goto(`${ADMIN_URL}/processes/${libId}?company=${ACME}`);
    await expect(p.getByTestId("library-open-copy")).toBeVisible();
    await expect(p.getByTestId("library-copy")).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
