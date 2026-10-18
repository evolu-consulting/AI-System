// ADM-FR-71 · HUB-FR-143 · HUB-FR-144 · HUB-FR-145 · AC-H41 · AC-H42 · AC-H43 · P-d1 · e2e admin editor (test-plan-e2e PD-E01…E04;
// nhãn nguyên văn plan-frontend §7 + i18n). Def `pd-edit` / `pd-bad` nạp bằng SQL (`seedPd`). Lưu ⇒ chờ PUT (CONVENTIONS §2).
import { expect, type Page, test } from "@playwright/test";
import { defByKey, node, openDef, panel, saveDef, seedPd } from "./_pd-support";

test.beforeAll(() => seedPd());

const reopen = async (p: Page, name: string) => {
  await p.reload();
  await node(p, name).click();
};

test("ADM-FR-71 · AC-H41 · PD-E01 · stage 'Chờ hạn' ⇒ 'Chờ tới ngày': nguồn ngày/chênh lệch/giờ, múi giờ công ty; Sau giai đoạn khoá 'Chạy tiếp (cố định)'; Lưu 200, tải lại giữ", async ({
  page: p,
}) => {
  await openDef(p, "pd-edit", "Chờ hạn E2E");
  await node(p, "Chờ hạn").click();
  await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
  await p.getByRole("option", { name: "Chờ tới ngày" }).click();
  const g = panel(p).getByRole("group", { name: "Chờ tới ngày" });
  await g.getByRole("combobox", { name: "Lấy ngày từ" }).click();
  await p.getByRole("option", { name: /Kết quả giai đoạn 1 · .*ngay_het_han/ }).click();
  await g.getByRole("spinbutton", { name: "Chênh lệch (ngày)" }).fill("-3");
  await g.getByLabel("Giờ trong ngày").fill("09:00");
  await expect(g.getByRole("status")).toContainText("Theo múi giờ công ty: Asia/Ho_Chi_Minh");
  const after = panel(p).getByRole("combobox", { name: "Sau giai đoạn" });
  await expect(after).toBeDisabled();
  await expect(after).toContainText("Chạy tiếp (cố định)");
  expect(await saveDef(p)).toBe(200);

  await reopen(p, "Chờ hạn");
  const g2 = panel(p).getByRole("group", { name: "Chờ tới ngày" });
  await expect(g2.getByRole("combobox", { name: "Lấy ngày từ" })).toContainText("ngay_het_han");
  await expect(g2.getByRole("spinbutton", { name: "Chênh lệch (ngày)" })).toHaveValue("-3");
  await expect(g2.getByLabel("Giờ trong ngày")).toHaveValue("09:00");
  const st = (await defByKey("pd-edit")).stages?.[1];
  expect({
    kind: st?.executor?.kind,
    off: st?.executor?.offset_days,
    time: st?.executor?.time,
  }).toEqual({
    kind: "wait_until",
    off: -3,
    time: "09:00",
  });
});

test("ADM-FR-71 · AC-H42 · PD-E02 · gate Duyệt: nhắc 4 giờ + chuyển cấp sau 24 giờ tới Group 'Giám đốc' (danh sách không có nhóm duyệt); Lưu 200, tải lại giữ", async ({
  page: p,
}) => {
  await openDef(p, "pd-edit", "Chờ hạn E2E");
  await node(p, "Đọc hồ sơ").click();
  const pn = panel(p);
  await pn.getByRole("spinbutton", { name: "Nhắc mỗi (giờ)" }).fill("4");
  await pn.getByRole("checkbox", { name: "Chuyển cấp nếu chưa ai kiểm" }).check();
  await pn.getByRole("spinbutton", { name: "Chuyển cấp sau (giờ)" }).fill("24");
  await pn.getByRole("combobox", { name: "Chuyển cấp tới nhóm" }).click();
  await expect(p.getByRole("option", { name: "Giám đốc" })).toBeVisible();
  await expect(p.getByRole("option", { name: /Kế toán P-a/ })).toHaveCount(0);
  await p.getByRole("option", { name: "Giám đốc" }).click();
  expect(await saveDef(p)).toBe(200);

  await reopen(p, "Đọc hồ sơ");
  await expect(panel(p).getByRole("spinbutton", { name: "Nhắc mỗi (giờ)" })).toHaveValue("4");
  await expect(panel(p).getByRole("spinbutton", { name: "Chuyển cấp sau (giờ)" })).toHaveValue(
    "24",
  );
  await expect(panel(p).getByRole("combobox", { name: "Chuyển cấp tới nhóm" })).toContainText(
    "Giám đốc",
  );
});

test("ADM-FR-71 · AC-H43 · PD-E03 · thẻ Thông tin: thời hạn lượt chạy 30 ngày; 'Không hết hạn' khoá ô số, tải lại giữ ttl_days null", async ({
  page: p,
}) => {
  await openDef(p, "pd-edit", "Chờ hạn E2E");
  const days = p.getByRole("spinbutton", { name: "Thời hạn lượt chạy (ngày)" });
  const never = p.getByRole("checkbox", { name: "Không hết hạn" });
  await expect(days).toHaveValue("7"); // mặc định quy trình
  await days.fill("30");
  expect(await saveDef(p)).toBe(200);
  expect((await defByKey("pd-edit")).ttl_days).toBe(30);

  await never.check();
  await expect(days).toBeDisabled();
  await expect(days).toHaveValue("");
  expect(await saveDef(p)).toBe(200);

  await p.reload();
  await expect(p.getByRole("checkbox", { name: "Không hết hạn" })).toBeChecked();
  await expect(p.getByRole("spinbutton", { name: "Thời hạn lượt chạy (ngày)" })).toBeDisabled();
  expect((await defByKey("pd-edit")).ttl_days).toBeNull();
});

test("ADM-FR-71 · AC-H41 · PD-E04 · nguồn ngày cùng bước ⇒ lỗi inline WAIT_INVALID dưới 'Lấy ngày từ', panel vẫn mở", async ({
  page: p,
}) => {
  await openDef(p, "pd-bad", "Chờ cùng bước");
  await node(p, "Chờ sai nguồn").click();
  const g = panel(p).getByRole("group", { name: "Chờ tới ngày" });
  await expect(
    g.getByText(
      "Nguồn ngày không hợp lệ. Chọn trường nhập kiểu Ngày hoặc trường Ngày của giai đoạn ở bước trước.",
    ),
  ).toBeVisible();
  await expect(panel(p)).toBeVisible();
});
