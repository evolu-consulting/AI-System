// ADM-FR-71 · HUB-FR-143 · HUB-FR-144 · HUB-FR-145 · AC-H41 · AC-H42 · AC-H43 · P-d1 · e2e admin editor (test-plan-e2e PD-E01…E04;
// nhãn nguyên văn plan-frontend §7 + i18n). Def `pd-edit` / `pd-bad` nạp bằng SQL (`seedPd`). Lưu ⇒ chờ PUT (CONVENTIONS §2).
import { expect, type Page, test } from "@playwright/test";
import {
  defByKey,
  loginAs,
  node,
  openDef,
  panel,
  saveDef,
  seedPd,
  seedPd2Defs,
  seedPd2Tools,
} from "./_pd-support";

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

// ---------- P-d2 · test-plan-e2e PD2-E01, E02, E05 (nhãn nguyên văn plan-frontend-d2 §13 + mockup 04) ----------
// Tiền đề thiếu (0012 công tắc tool / 0037) ⇒ `seedPd2Tools` ném "chưa có tính năng: …" NGAY, trước mọi locator.
const TOOL_OPT = "Xuất HĐ · xuat-hoa-don";
const stageOfDef = async (key: string, i: number) => (await defByKey(key)).stages?.[i];

test("ADM-FR-71 · AC-H44 · PD2-E01 · stage 'Gọi tool': chọn 'Xuất HĐ · xuat-hoa-don', nguồn tong_tien = kết quả giai đoạn trước, ma_kh = giá trị cố định KH1; tool 'Tác dụng phụ'; tham số tệp bị khoá; Lưu 200, tải lại giữ", async ({
  page: p,
}) => {
  await seedPd2Tools();
  await seedPd2Defs();
  await openDef(p, "pd2-tool", "Gọi tool E2E");
  await node(p, "Xuất hoá đơn").click();
  await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
  await p.getByRole("option", { name: "Gọi tool" }).click();
  const g = panel(p).getByRole("group", { name: "Gọi tool" });
  await g.getByRole("combobox", { name: "Tool" }).click();
  await expect(p.getByRole("option", { name: /Tải tệp · tai-tep/ })).toBeDisabled(); // tham số tệp
  await expect(p.getByRole("option", { name: /Hết hạn/ })).toHaveCount(0); // workflow tắt
  await p.getByRole("option", { name: /Ghi sổ · ghi-so/ }).click(); // có side_effect
  await expect(g.getByText("Tác dụng phụ")).toBeVisible();
  await g.getByRole("combobox", { name: "Tool" }).click();
  await p.getByRole("option", { name: TOOL_OPT }).click();
  await expect(g.getByText("Tác dụng phụ")).toHaveCount(0);
  await g.getByRole("combobox", { name: "Nguồn của tham số tong_tien" }).click();
  await p.getByRole("option", { name: "Kết quả giai đoạn trước" }).click();
  await g.getByRole("combobox", { name: "Giá trị của tham số tong_tien" }).click();
  await p.getByRole("option", { name: /Giai đoạn 1 · tong_tien/ }).click();
  await g.getByRole("combobox", { name: "Nguồn của tham số ma_kh" }).click();
  await p.getByRole("option", { name: "Giá trị cố định" }).click();
  await g.getByLabel("Giá trị của tham số ma_kh").fill("KH1");
  expect(await saveDef(p)).toBe(200);

  await p.reload();
  await node(p, "Xuất hoá đơn").click();
  const g2 = panel(p).getByRole("group", { name: "Gọi tool" });
  await expect(g2.getByRole("combobox", { name: "Tool" })).toContainText("Xuất HĐ");
  await expect(g2.getByRole("combobox", { name: "Nguồn của tham số tong_tien" })).toContainText(
    "Kết quả giai đoạn trước",
  );
  await expect(g2.getByLabel("Giá trị của tham số ma_kh")).toHaveValue("KH1");
  const ex = (await stageOfDef("pd2-tool", 1))?.executor;
  expect(ex).toMatchObject({
    kind: "tool",
    tool_key: "xuat-hoa-don",
    args: {
      tong_tien: { from: "field", stage_key: "doc", field: "tong_tien" },
      ma_kh: { from: "const", value: "KH1" },
    },
  });
});

test("ADM-FR-71 · AC-H45 · PD2-E02 · 'Rẽ nhánh': thêm luật tong_tien ≥ 20000000 ⇒ Bước 4, canvas có cạnh 'Rẽ nhánh · luật 1', tải lại giữ; xoá luật ⇒ hết cạnh", async ({
  page: p,
}) => {
  await seedPd2Tools();
  await seedPd2Defs();
  await openDef(p, "pd2-branch", "Rẽ nhánh E2E");
  await node(p, "Phân loại").click();
  const g = panel(p).getByRole("group", { name: "Rẽ nhánh" });
  await g.getByRole("button", { name: "Thêm luật rẽ nhánh" }).click();
  await g.getByRole("combobox", { name: "Nếu trường" }).click();
  await p.getByRole("option", { name: /tong_tien/ }).click();
  await g.getByRole("combobox", { name: "Phép so sánh" }).click();
  await p.getByRole("option", { name: "lớn hơn hoặc bằng" }).click();
  await g.getByLabel("Giá trị", { exact: true }).fill("20000000");
  await g.getByRole("combobox", { name: "Thì tới bước" }).click();
  await p.getByRole("option", { name: "Bước 4" }).click();
  expect(await saveDef(p)).toBe(200);
  await expect(p.getByText("Rẽ nhánh · luật 1")).toBeVisible();

  await p.reload();
  await node(p, "Phân loại").click();
  const g2 = panel(p).getByRole("group", { name: "Rẽ nhánh" });
  await expect(g2.getByRole("combobox", { name: "Thì tới bước" })).toContainText("Bước 4");
  await expect(g2.getByLabel("Giá trị", { exact: true })).toHaveValue("20000000");
  const br = (await stageOfDef("pd2-branch", 0))?.after?.branch;
  expect(br).toEqual([{ field: "tong_tien", op: "ge", value: 20000000, goto_step: 3 }]);

  await g2.getByRole("button", { name: "Xoá luật 1" }).click();
  expect(await saveDef(p)).toBe(200);
  await expect(p.getByText("Rẽ nhánh · luật 1")).toHaveCount(0);
  expect((await stageOfDef("pd2-branch", 0))?.after?.branch ?? []).toEqual([]);
});

test("AC-H47 · PD2-E05 · công ty chưa bật tool: danh sách rỗng có thông báo; bật 'Ghi sổ' mà không bật 'Xuất HĐ' ⇒ không có option 'Xuất HĐ · xuat-hoa-don'", async ({
  page: p,
}) => {
  await seedPd2Tools();
  await seedPd2Defs();
  const open = async () => {
    await loginAs(p, "globex", "hoa");
    await p
      .getByRole("navigation", { name: "Điều hướng chính" })
      .getByRole("link", { name: "Quy trình", exact: true })
      .click();
    await p.getByRole("tab", { name: "Mẫu · chạy thử" }).click(); // CR-105: def tenant không khe/không của gói nằm ở tab này
    await p
      .getByRole("table", { name: "Quy trình" })
      .getByRole("row")
      .filter({ hasText: "pd2-globex" })
      .getByRole("link", { name: "Công ty khác E2E" })
      .click();
    await node(p, "Xuất hoá đơn").click();
    await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
    await p.getByRole("option", { name: "Gọi tool" }).click();
  };
  await open();
  await expect(
    panel(p).getByText("Chưa có tool nào được bật cho công ty — liên hệ quản trị nền tảng"),
  ).toBeVisible();
  await seedPd2Tools(["WS"]);
  await p.context().clearCookies();
  await open();
  await panel(p)
    .getByRole("group", { name: "Gọi tool" })
    .getByRole("combobox", { name: "Tool" })
    .click();
  await expect(p.getByRole("option", { name: /Ghi sổ · ghi-so/ })).toBeVisible();
  await expect(p.getByRole("option", { name: TOOL_OPT })).toHaveCount(0);
});
