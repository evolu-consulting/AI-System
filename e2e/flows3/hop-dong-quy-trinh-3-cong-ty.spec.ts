// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-165 · e2e HỢP ĐỒNG + QUY TRÌNH THẬT của 3 công ty (G4, N2: mỗi bước đúng vai, khác người tạo). Quy trình = ĐÚNG bộ `flowsFor` (`tools/scripts/src/tenant-flows.data.ts`)
// do `_flows3-stack.ts` áp lên Niti / Evolu / Preschool-flows (cây phòng ban của deploy/tenants/*.yaml). Nhãn nguyên văn: «Trưởng phòng duyệt», «Chuẩn bị ký», «Ký hợp đồng»,
// «Nhờ đối tác ký?» (Có/Không), «Chọn đối tác», «Đối tác đã xác nhận». Chạy: `run-tests.ps1 -Step e2e -Filter flows3`. Ca độc lập (không serial): ca đỏ không làm ca sau bị bỏ qua.
import { expect, test } from "@playwright/test";
import {
  approveStep,
  as,
  createAndSubmit,
  declineStep,
  doTask,
  envOf,
  expectStatus,
  openReceived,
  pickPartner,
  RUN,
  reloadUntil,
  resubmit,
  settled,
  signAndAsk,
  statusOf,
  uploadSigned,
} from "./_flows3-kit";
import { CO, WHO } from "./_flows3-who";

const [EN, EE, EP] = [envOf("n"), envOf("e"), envOf("p")];
const BTN = /^act-(approve|pass)$/;

/** Bên N (Giám đốc Tiên tạo) gửi HĐ `tag` tới Evolu: Chuẩn bị ký → Ký → Có → chọn đối tác. Trả id HĐ bên gửi. */
async function sendNtoE(browser: import("@playwright/test").Browser, tag: string): Promise<string> {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  const id = await createAndSubmit(tien, "n", tag);
  await signAndAsk(tien, EN, id, "Có", true);
  await pickPartner(tien, EN, CO.e.tax, `nhan-${RUN}${tag}@doitac.test`);
  return id;
}

test.setTimeout(600_000);

test("FL3-1 · Nhân viên Kế toán tạo ⇒ Trưởng phòng duyệt (ý kiến + tệp) ⇒ Giám đốc Ký ⇒ «Nhờ đối tác ký?» Không ⇒ «Đã duyệt» (hiệu lực nội bộ)", async ({
  browser,
}) => {
  const hoa = await as(browser, "n", WHO.n.ktNv);
  const id = await createAndSubmit(hoa, "n", "c1");
  await approveStep(await as(browser, "n", WHO.n.ktTruong), EN, id, "Trưởng phòng duyệt");
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await signAndAsk(tien, EN, id, "Không", false); // trưởng phòng đã duyệt ⇒ Ký luôn, không «Chuẩn bị ký»
  await expectStatus(hoa, EN, id, "done");
  await expect(hoa.getByText("Đã duyệt").first()).toBeVisible();
  // CR-174: nhánh «Không» ⇒ khối «Các bước duyệt» nói rõ bước «Chọn đối tác & người nhận» được BỎ QUA (không còn «Đang chờ đối tác trả lời»)
  const skipped = hoa
    .getByTestId("approval-step-module")
    .filter({ hasText: "Chọn đối tác & người nhận" });
  await expect(skipped).toHaveAttribute("data-outcome", "skipped");
  await expect(skipped).toContainText("Bỏ qua");
});

test("FL3-2 · Nhân viên phòng Kinh doanh KHÔNG có trưởng ⇒ leo cấp, Giám đốc duyệt ⇒ Ký ⇒ Không ⇒ «Đã duyệt»", async ({
  browser,
}) => {
  const vy = await as(browser, "n", WHO.n.kdNv);
  const id = await createAndSubmit(vy, "n", "c2");
  // phòng không trưởng ⇒ người duyệt là Giám đốc (trưởng phòng gốc); Phó giám đốc (cùng phòng gốc, không phải trưởng) KHÔNG được giao
  await approveStep(await as(browser, "n", WHO.n.giamdoc), EN, id, "Trưởng phòng duyệt");
  await signAndAsk(await as(browser, "n", WHO.n.giamdoc), EN, id, "Không", false);
  await expectStatus(vy, EN, id, "done");
});

test("FL3-3 · Giám đốc Niti tự tạo ⇒ không bước duyệt ⇒ Chuẩn bị ký ⇒ Ký ⇒ Có ⇒ chọn Evolu ⇒ Evolu nhận (lời mời lần đầu) ⇒ Julian phụ trách ⇒ Thomas duyệt + ký ⇒ Đồng ý ⇒ Niti thấy «Đối tác đã xác nhận»", async ({
  browser,
}) => {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  const id = await createAndSubmit(tien, "n", "c3");
  await expect(
    tien.getByTestId(/^approval-step-\d+$/).filter({ hasText: "Trưởng phòng duyệt" }),
  ).toHaveCount(0); // người gửi là cấp cao nhất ⇒ bỏ bước duyệt
  await signAndAsk(tien, EN, id, "Có", true);
  await pickPartner(tien, EN, CO.e.tax, `nhan-${RUN}c3@doitac.test`);

  const thomas = await as(browser, "e", WHO.e.giamdoc);
  const bid = await openReceived(thomas, EE, "c3"); // băng «Nhận» lần nối đầu được bấm trong hàm
  // N2: Julian là người phụ trách (người tạo của lượt nhận) ⇒ KHÔNG tự duyệt được; chỉ Thomas (trưởng phòng của Julian)
  const julian = await as(browser, "e", WHO.e.kdTruong);
  await julian.goto(`${EE.cw}/contracts/c/${bid}`);
  await expect(statusOf(julian).first()).toBeVisible({ timeout: 60_000 });
  await expect(julian.getByTestId(BTN)).toHaveCount(0);
  await approveStep(thomas, EE, bid, "Trưởng phòng duyệt");
  await uploadSigned(thomas, EE, bid);
  const co = thomas.getByRole("button", { name: /Đồng ý ký cùng lúc|Đồng ý/ }).first();
  if (await co.isVisible().catch(() => false)) await co.click();

  await tien.goto(`${EN.cw}/contracts/c/${id}`);
  await reloadUntil(
    tien,
    async () =>
      expect(tien.getByText("Đối tác đã xác nhận").first()).toBeVisible({ timeout: 4_000 }),
    180_000,
  );
});

test("FL3-4 · Công ty MỘT người (Preschool) gửi: Chuẩn bị ký ⇒ Ký ⇒ Có ⇒ Niti nhận (đã kết nối ⇒ không lời mời) ⇒ Chuẩn bị ký + Ký ⇒ Đồng ý ⇒ Preschool thấy «Đối tác đã xác nhận»", async ({
  browser,
}) => {
  const dung = await as(browser, "p", WHO.p.giamdoc);
  const tien = await as(browser, "n", WHO.n.giamdoc);
  // kết nối trước (đường «Tìm công ty» như người dùng thật) ⇒ lần gửi sau không còn băng lời mời
  await dung.goto(`${EP.cw}/contracts/partners`);
  await dung.getByRole("button", { name: "Tìm công ty" }).click();
  const dlg = dung.getByRole("dialog", { name: "Tìm công ty để kết nối" });
  await dlg.getByLabel("Tên công ty hoặc mã số thuế").fill(CO.n.name);
  const hit = dlg.getByTestId("connect-results").getByRole("listitem").first();
  await expect(hit).toContainText(CO.n.name, { timeout: 30_000 });
  await hit.getByRole("button", { name: "Gửi lời mời kết nối" }).click();
  await dung
    .getByRole("dialog", { name: /^Gửi lời mời cho/ })
    .getByRole("button", { name: "Gửi lời mời", exact: true })
    .click();
  await tien.goto(`${EN.cw}/contracts/partners`);
  const band = tien.getByTestId("connect-invite").filter({ hasText: CO.p.name });
  await reloadUntil(tien, async () => expect(band).toBeVisible({ timeout: 4_000 }));
  await band.getByRole("button", { name: "Đồng ý", exact: true }).click();
  await expect(tien.getByTestId("connected-list")).toContainText(CO.p.name);

  const id = await createAndSubmit(dung, "p", "c4");
  await signAndAsk(dung, EP, id, "Có", true);
  await pickPartner(dung, EP, CO.n.tax, `nhan-${RUN}c4@doitac.test`);

  await tien.goto(`${EN.cw}/contracts/list?source=partner`);
  const row = tien
    .getByRole("row")
    .filter({ has: tien.getByTestId("row-view") })
    .filter({ hasText: `E2E-JOURNEY-${RUN}c4` })
    .first();
  await reloadUntil(tien, async () => expect(row).toBeVisible({ timeout: 4_000 }));
  await expect(tien.getByTestId("partner-invite")).toHaveCount(0);
  await row.getByTestId("row-view").click();
  await tien.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/);
  const bid = /\/contracts\/c\/([0-9a-f-]{36})/.exec(tien.url())?.[1] ?? "";
  // người phụ trách của Niti là Giám đốc (cấp cao nhất) ⇒ KHÔNG bước duyệt: Chuẩn bị ký → Ký → Đồng ý
  await doTask(tien, EN, "Chuẩn bị ký");
  await uploadSigned(tien, EN, bid);
  const co = tien.getByRole("button", { name: /Đồng ý ký cùng lúc|Đồng ý/ }).first();
  if (await co.isVisible().catch(() => false)) await co.click();

  await dung.goto(`${EP.cw}/contracts/c/${id}`);
  await reloadUntil(
    dung,
    async () =>
      expect(dung.getByText("Đối tác đã xác nhận").first()).toBeVisible({ timeout: 4_000 }),
    180_000,
  );
});

test("FL3-5a · Trưởng phòng Trả lại (lý do bắt buộc) ⇒ HĐ về Nháp; người tạo sửa + gửi lại ⇒ vòng 2 trưởng phòng duyệt được", async ({
  browser,
}) => {
  const hoa = await as(browser, "n", WHO.n.ktNv);
  const id = await createAndSubmit(hoa, "n", "c5a");
  const truong = await as(browser, "n", WHO.n.ktTruong);
  await declineStep(
    truong,
    EN,
    id,
    "Trưởng phòng duyệt",
    "return",
    "Điều 3 thiếu hạn thanh toán, xin bổ sung",
  );
  await expectStatus(hoa, EN, id, "draft");
  // G3: người tạo phải thấy LÝ DO ngay ở băng đầu trang (không chỉ «đã trả lại»)
  await expect
    .soft(hoa.getByTestId("head-banner"))
    .toContainText("Điều 3 thiếu hạn thanh toán, xin bổ sung");
  // người tạo sửa (đổi tên) → Lưu nháp → Gửi duyệt lại
  await hoa.getByRole("textbox", { name: /^Tên hợp đồng/ }).fill(`Hợp đồng đã sửa ${RUN}`);
  await resubmit(hoa); // vòng > 0: nút chính «Gửi lại» tự lưu chỗ vừa sửa rồi gửi (không có «Lưu nháp»)
  await approveStep(truong, EN, id, "Trưởng phòng duyệt"); // vòng 2: bước mở lại cho đúng trưởng phòng
});

test("FL3-5b · Trưởng phòng Từ chối (lý do bắt buộc) ⇒ HĐ «Từ chối»", async ({ browser }) => {
  const hoa = await as(browser, "n", WHO.n.ktNv);
  const id = await createAndSubmit(hoa, "n", "c5b");
  await declineStep(
    await as(browser, "n", WHO.n.ktTruong),
    EN,
    id,
    "Trưởng phòng duyệt",
    "reject",
    "Không phù hợp chính sách mua hàng",
  );
  await expectStatus(hoa, EN, id, "reject");
  // G3: người tạo phải thấy LÝ DO ngay ở băng đầu trang (không chỉ «đã trả lại»)
  await expect
    .soft(hoa.getByTestId("head-banner"))
    .toContainText("Không phù hợp chính sách mua hàng");
});

test("FL3-5c · Bên nhận (Thomas) Trả lại ⇒ Niti thấy lý do, HĐ về Nháp; gửi lại ⇒ vòng 2 có «Chuẩn bị ký» mới", async ({
  browser,
}) => {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  const id = await sendNtoE(browser, "c5c");
  const thomas = await as(browser, "e", WHO.e.giamdoc);
  const bid = await openReceived(thomas, EE, "c5c");
  await declineStep(
    thomas,
    EE,
    bid,
    "Trưởng phòng duyệt",
    "return",
    "Giá trị chưa khớp báo giá, xin sửa",
  );
  await expectStatus(tien, EN, id, "draft");
  await expect
    .soft(tien.getByTestId("head-banner"))
    .toContainText("Giá trị chưa khớp báo giá, xin sửa");
  await tien.getByRole("textbox", { name: /^Tên hợp đồng/ }).fill(`Hợp đồng gửi lại ${RUN}`);
  await resubmit(tien); // vòng > 0: nút chính «Gửi lại» tự lưu chỗ vừa sửa rồi gửi (không có «Lưu nháp»)
  // vòng 2: người gửi là cấp cao nhất ⇒ lại «Chuẩn bị ký»
  await doTask(tien, EN, "Chuẩn bị ký");
});

test("FL3-5d · Bên nhận (Thomas) Từ chối ⇒ Niti thấy HĐ «Từ chối»", async ({ browser }) => {
  const tien = await as(browser, "n", WHO.n.giamdoc);
  const id = await sendNtoE(browser, "c5d");
  const thomas = await as(browser, "e", WHO.e.giamdoc);
  const bid = await openReceived(thomas, EE, "c5d");
  await declineStep(
    thomas,
    EE,
    bid,
    "Trưởng phòng duyệt",
    "reject",
    "Không đồng ý điều khoản phạt",
  );
  await expectStatus(tien, EN, id, "reject");
});

test("FL3-6 · Quyền: người khác (không được giao) không có nút Duyệt / Ký; người tạo không nhận bước «Trưởng phòng duyệt»", async ({
  browser,
}) => {
  const hoa = await as(browser, "n", WHO.n.ktNv);
  const id = await createAndSubmit(hoa, "n", "c6");
  const truong = await as(browser, "n", WHO.n.ktTruong);
  await reloadUntil(truong, async () => {
    await truong.goto(`${EN.cw}/contracts/c/${id}`);
    await expect(truong.getByTestId(BTN).or(truong.getByTestId("claim-take")).first()).toBeVisible({
      timeout: 4_000,
    });
  });
  // người tạo + đồng nghiệp cùng phòng + Phó giám đốc: không nút Duyệt. (Giám đốc là Toàn quyền ⇒ «duyệt thay» theo CR-113, không đưa vào ca này.)
  for (const u of [WHO.n.ktNv, WHO.n.ktNv2, WHO.n.phogd]) {
    const p = await as(browser, "n", u);
    await p.goto(`${EN.cw}/contracts/c/${id}`);
    await settled(p);
    await expect(p.getByTestId(BTN), `${u} không được thấy nút Duyệt`).toHaveCount(0);
  }
  // «Việc của tôi»: trưởng phòng CÓ việc «Trưởng phòng duyệt», người tạo KHÔNG có việc duyệt chính HĐ của mình
  const rowsOf = (p: typeof hoa) =>
    p
      .getByTestId(/^(requests-waiting-row|approval-task-row)$/)
      .filter({ hasText: "Trưởng phòng duyệt" });
  await truong.goto(`${EN.cw}/contracts/approvals`);
  await expect(rowsOf(truong).first()).toBeVisible({ timeout: 30_000 });
  await hoa.goto(`${EN.cw}/contracts/approvals`);
  await expect(hoa.getByRole("heading").first()).toBeVisible();
  await expect(rowsOf(hoa)).toHaveCount(0);
  // sau khi trưởng phòng duyệt, bước Ký chỉ của Giám đốc: những người khác không có ô «tải bản đã ký»
  await approveStep(truong, EN, id, "Trưởng phòng duyệt");
  const tien = await as(browser, "n", WHO.n.giamdoc);
  await tien.goto(`${EN.cw}/contracts/c/${id}`);
  await reloadUntil(tien, async () =>
    expect(tien.getByTestId("signed-upload-box")).toBeVisible({ timeout: 4_000 }),
  );
  for (const u of [WHO.n.ktNv, WHO.n.ktNv2, WHO.n.phogd, WHO.n.ktTruong]) {
    const p = await as(browser, "n", u);
    await p.goto(`${EN.cw}/contracts/c/${id}`);
    await settled(p);
    await expect(p.getByTestId("signed-upload-box"), `${u} không được thấy ô Ký`).toHaveCount(0);
  }
});
