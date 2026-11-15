// [prod-journey] · các ca quy trình hợp đồng FL3-1…FL3-6 (e2e/flows3) chạy tới môi trường ĐÃ DEPLOY trên 3 công ty thật evolu / nitigroup / preschool.
// Mỗi bước do đúng người thật (deploy/tenants/*.yaml) làm, khác người tạo (N2). Nhãn bước nguyên văn: «Trưởng phòng duyệt», «Chuẩn bị ký», «Nhờ đối tác ký?», «Chọn đối tác».
// Khác flows3: yaml thật không có nhân viên Kế toán (Hoa/Lan) và Minh (Evolu) ⇒ người tạo thay bằng người thật (xem từng ca). Ca độc lập (không serial).
import { expect, test } from "@playwright/test";
import {
  approveStep,
  as,
  BTN,
  CO,
  createAndSubmit,
  declineStep,
  doTask,
  E,
  ensureConnected,
  expectStatus,
  openReceived,
  pickPartner,
  RUN,
  reloadUntil,
  resubmit,
  settled,
  shootAll,
  signAndAsk,
  statusOf,
  uploadSigned,
  WHO,
} from "./_kit";

test.setTimeout(900_000);
test.afterEach(async (_fx, info) => {
  await shootAll(info.title.split(" ")[0] ?? "ca");
});

/** Niti (Giám đốc Tiên tạo) gửi HĐ `tag` tới Evolu: Chuẩn bị ký → Ký → Có → chọn đối tác. Trả id HĐ bên gửi. */
async function sendNtoE(browser: import("@playwright/test").Browser, tag: string): Promise<string> {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await ensureConnected(tien, "n", await as(browser, "e", WHO.e.giamdoc), "e");
  const id = await createAndSubmit(tien, tag);
  await signAndAsk(tien, id, "Có", true);
  await pickPartner(tien, CO.e.tax, `nhan-${RUN}${tag}@doitac.test`);
  return id;
}

test("FL3-1 · Phó phòng Kế toán (Phương) tạo ⇒ leo cấp, Giám đốc Tiên duyệt (ý kiến + tệp) ⇒ Ký ⇒ «Nhờ đối tác ký?» Không ⇒ «Đã duyệt»", async ({
  browser,
}) => {
  const phuong = await as(browser, "n", WHO.n.ktPho);
  const id = await createAndSubmit(phuong, "c1");
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await approveStep(tien, id, "Trưởng phòng duyệt");
  await signAndAsk(tien, id, "Không", false); // đã duyệt ⇒ Ký luôn, không «Chuẩn bị ký»
  await expectStatus(phuong, id, "done");
  await expect(phuong.getByText("Đã duyệt").first()).toBeVisible();
  const skipped = phuong
    .getByTestId("approval-step-module")
    .filter({ hasText: "Chọn đối tác & người nhận" });
  await expect(skipped).toHaveAttribute("data-outcome", "skipped");
  await expect(skipped).toContainText("Bỏ qua");
});

test("FL3-2 · Nhân viên phòng Kinh doanh KHÔNG có trưởng (Thúy Vy) ⇒ leo cấp, Giám đốc Tiên duyệt ⇒ Ký ⇒ Không ⇒ «Đã duyệt»", async ({
  browser,
}) => {
  const vy = await as(browser, "n", WHO.n.kdNv);
  const id = await createAndSubmit(vy, "c2");
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await approveStep(tien, id, "Trưởng phòng duyệt");
  await signAndAsk(tien, id, "Không", false);
  await expectStatus(vy, id, "done");
});

test("FL3-3 · Tiên (Niti) tự tạo ⇒ Chuẩn bị ký ⇒ Ký ⇒ Có ⇒ chọn Evolu ⇒ Julian phụ trách (không tự duyệt) ⇒ Thomas duyệt + ký ⇒ Niti thấy «Đối tác đã xác nhận»", async ({
  browser,
}) => {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  const thomas = await as(browser, "e", WHO.e.giamdoc);
  await ensureConnected(tien, "n", thomas, "e");
  const id = await createAndSubmit(tien, "c3");
  await expect(
    tien.getByTestId(/^approval-step-\d+$/).filter({ hasText: "Trưởng phòng duyệt" }),
  ).toHaveCount(0); // người gửi là cấp cao nhất ⇒ bỏ bước duyệt
  await signAndAsk(tien, id, "Có", true);
  await pickPartner(tien, CO.e.tax, `nhan-${RUN}c3@doitac.test`);

  const bid = await openReceived(thomas, "c3");
  // N2: Julian là người phụ trách (người tạo của lượt nhận) ⇒ KHÔNG tự duyệt được; chỉ Thomas (trưởng phòng của Julian)
  const julian = await as(browser, "e", WHO.e.kdTruong);
  await julian.goto(`${E.cw}/contracts/c/${bid}`);
  await expect(statusOf(julian).first()).toBeVisible({ timeout: 60_000 });
  await expect(julian.getByTestId(BTN)).toHaveCount(0);
  await approveStep(thomas, bid, "Trưởng phòng duyệt");
  await uploadSigned(thomas, bid);
  const co = thomas.getByRole("button", { name: /Đồng ý ký cùng lúc|Đồng ý/ }).first();
  if (await co.isVisible().catch(() => false)) await co.click();

  await tien.goto(`${E.cw}/contracts/c/${id}`);
  await reloadUntil(
    tien,
    async () =>
      expect(tien.getByText("Đối tác đã xác nhận").first()).toBeVisible({ timeout: 4_000 }),
    180_000,
  );
});

test("FL3-4 · Công ty MỘT người (Dung, Preschool) gửi: Chuẩn bị ký ⇒ Ký ⇒ Có ⇒ Tiên (Niti) nhận ⇒ Chuẩn bị ký + Ký ⇒ Đồng ý ⇒ Preschool thấy «Đối tác đã xác nhận»", async ({
  browser,
}) => {
  const dung = await as(browser, "p", WHO.p.giamdoc);
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await ensureConnected(dung, "p", tien, "n");
  const id = await createAndSubmit(dung, "c4");
  await signAndAsk(dung, id, "Có", true);
  await pickPartner(dung, CO.n.tax, `nhan-${RUN}c4@doitac.test`);

  const bid = await openReceived(tien, "c4");
  // người phụ trách của Niti là Giám đốc (cấp cao nhất) ⇒ KHÔNG bước duyệt: Chuẩn bị ký → Ký → Đồng ý
  await doTask(tien, "Chuẩn bị ký");
  await uploadSigned(tien, bid);
  const co = tien.getByRole("button", { name: /Đồng ý ký cùng lúc|Đồng ý/ }).first();
  if (await co.isVisible().catch(() => false)) await co.click();

  await dung.goto(`${E.cw}/contracts/c/${id}`);
  await reloadUntil(
    dung,
    async () =>
      expect(dung.getByText("Đối tác đã xác nhận").first()).toBeVisible({ timeout: 4_000 }),
    180_000,
  );
});

test("FL3-5a · Giám đốc Tiên Trả lại HĐ của Thúy Vy (lý do bắt buộc) ⇒ Nháp; Vy sửa + gửi lại ⇒ vòng 2 Tiên duyệt được", async ({
  browser,
}) => {
  const vy = await as(browser, "n", WHO.n.kdNv);
  const id = await createAndSubmit(vy, "c5a");
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await declineStep(
    tien,
    id,
    "Trưởng phòng duyệt",
    "return",
    "Điều 3 thiếu hạn thanh toán, xin bổ sung",
  );
  await expectStatus(vy, id, "draft");
  await expect
    .soft(vy.getByTestId("head-banner"))
    .toContainText("Điều 3 thiếu hạn thanh toán, xin bổ sung");
  await vy.getByRole("textbox", { name: /^Tên hợp đồng/ }).fill(`Hợp đồng đã sửa ${RUN}`);
  await resubmit(vy);
  await approveStep(tien, id, "Trưởng phòng duyệt"); // vòng 2
});

test("FL3-5b · Giám đốc Tiên Từ chối HĐ của Thúy Vy (lý do bắt buộc) ⇒ HĐ «Từ chối»", async ({
  browser,
}) => {
  const vy = await as(browser, "n", WHO.n.kdNv);
  const id = await createAndSubmit(vy, "c5b");
  await declineStep(
    await as(browser, "n", WHO.n.giamdoc),
    id,
    "Trưởng phòng duyệt",
    "reject",
    "Không phù hợp chính sách mua hàng",
  );
  await expectStatus(vy, id, "reject");
  await expect
    .soft(vy.getByTestId("head-banner"))
    .toContainText("Không phù hợp chính sách mua hàng");
});

test("FL3-5c · Bên nhận (Thomas) Trả lại ⇒ Niti thấy lý do, HĐ về Nháp; gửi lại ⇒ vòng 2 có «Chuẩn bị ký» mới", async ({
  browser,
}) => {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  const id = await sendNtoE(browser, "c5c");
  const thomas = await as(browser, "e", WHO.e.giamdoc);
  const bid = await openReceived(thomas, "c5c");
  await declineStep(
    thomas,
    bid,
    "Trưởng phòng duyệt",
    "return",
    "Giá trị chưa khớp báo giá, xin sửa",
  );
  await expectStatus(tien, id, "draft");
  await expect
    .soft(tien.getByTestId("head-banner"))
    .toContainText("Giá trị chưa khớp báo giá, xin sửa");
  await tien.getByRole("textbox", { name: /^Tên hợp đồng/ }).fill(`Hợp đồng gửi lại ${RUN}`);
  await resubmit(tien);
  await doTask(tien, "Chuẩn bị ký"); // vòng 2: người gửi là cấp cao nhất ⇒ lại «Chuẩn bị ký»
});

test("FL3-5d · Bên nhận (Thomas) Từ chối ⇒ Niti thấy HĐ «Từ chối»", async ({ browser }) => {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  const id = await sendNtoE(browser, "c5d");
  const thomas = await as(browser, "e", WHO.e.giamdoc);
  const bid = await openReceived(thomas, "c5d");
  await declineStep(thomas, bid, "Trưởng phòng duyệt", "reject", "Không đồng ý điều khoản phạt");
  await expectStatus(tien, id, "reject");
});

test("FL3-6 · Quyền: Vy tạo, người khác (Ngân, Phương, HR) không có nút Duyệt / Ký; Vy không nhận bước «Trưởng phòng duyệt»; Tiên có", async ({
  browser,
}) => {
  const vy = await as(browser, "n", WHO.n.kdNv);
  const id = await createAndSubmit(vy, "c6");
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await reloadUntil(tien, async () => {
    await tien.goto(`${E.cw}/contracts/c/${id}`);
    await expect(tien.getByTestId(BTN).or(tien.getByTestId("claim-take")).first()).toBeVisible({
      timeout: 4_000,
    });
  });
  const others = [WHO.n.phogd, WHO.n.ktPho, WHO.n.nhanSu]; // Giám đốc là Toàn quyền ⇒ «duyệt thay» (CR-113), nên người được giao là Tiên, không đưa vào danh sách này
  for (const u of others) {
    const p = await as(browser, "n", u);
    await p.goto(`${E.cw}/contracts/c/${id}`);
    await settled(p);
    await expect(p.getByTestId(BTN), `${u} không được thấy nút Duyệt`).toHaveCount(0);
  }
  const rowsOf = (p: typeof vy) =>
    p
      .getByTestId(/^(requests-waiting-row|approval-task-row)$/)
      .filter({ hasText: "Trưởng phòng duyệt" });
  await tien.goto(`${E.cw}/contracts/approvals`);
  await expect(rowsOf(tien).first()).toBeVisible({ timeout: 30_000 });
  await vy.goto(`${E.cw}/contracts/approvals`);
  await expect(vy.getByRole("heading").first()).toBeVisible();
  await expect(rowsOf(vy)).toHaveCount(0);
  await approveStep(tien, id, "Trưởng phòng duyệt");
  await reloadUntil(tien, async () =>
    expect(tien.getByTestId("signed-upload-box")).toBeVisible({ timeout: 4_000 }),
  );
  for (const u of [WHO.n.kdNv, ...others]) {
    const p = await as(browser, "n", u);
    await p.goto(`${E.cw}/contracts/c/${id}`);
    await settled(p);
    await expect(p.getByTestId("signed-upload-box"), `${u} không được thấy ô Ký`).toHaveCount(0);
  }
});

test("FL3-7 · Evolu nội bộ: Julian (trưởng Kinh doanh) tạo ⇒ Thomas duyệt ⇒ Ký ⇒ Không ⇒ «Đã duyệt»", async ({
  browser,
}) => {
  const julian = await as(browser, "e", WHO.e.kdTruong);
  const id = await createAndSubmit(julian, "c7");
  const thomas = await as(browser, "e", WHO.e.giamdoc);
  await approveStep(thomas, id, "Trưởng phòng duyệt");
  await signAndAsk(thomas, id, "Không", false);
  await expectStatus(julian, id, "done");
});

test("FL3-8 · Preschool nội bộ: Dung (một người, cấp cao nhất) tạo ⇒ không bước duyệt ⇒ Chuẩn bị ký ⇒ Ký ⇒ Không ⇒ «Đã duyệt»", async ({
  browser,
}) => {
  const dung = await as(browser, "p", WHO.p.giamdoc);
  const id = await createAndSubmit(dung, "c8");
  await signAndAsk(dung, id, "Không", true);
  await expectStatus(dung, id, "done");
});
