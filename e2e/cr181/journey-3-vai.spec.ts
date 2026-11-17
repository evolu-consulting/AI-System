// CR-181 · s15 · HÀNH TRÌNH 3 VAI (UAT K01–K10, M01–M04): mỗi bước do đúng một vai làm, người sau KHÁC người tạo.
//   sale (e2e-kd-nv, người tạo) → trưởng phòng (e2e-kd-truong, duyệt + ký) → giám đốc (e2e-giamdoc, người ký công ty); kế toán (e2e-ketoan) chỉ xem.
// Công ty `e2e-q5-<hậu tố>` (dựng bởi `_cr181-stack.ts`): bật «Ký trên tài liệu», KHÔNG ai có chữ ký sẵn; quy trình Trưởng phòng duyệt [ý kiến + chữ ký] → Ký `ondoc`.
import { test } from "@playwright/test";
import { envOf, expect, loginCw, newPage, U } from "../cr127/_cr127-kit";
import {
  addMineAt,
  addMineByMenu,
  createSignatureIfAsked,
  draftSample,
  dragMarkAcrossSeam,
  HEAD,
  prepareSignPlaces,
  saleSends,
  saveSigned,
  stepEventually,
} from "./_cr181-kit";

test.describe.configure({ mode: "serial" });
const E = envOf("q5");
const RUN = Date.now().toString(36);
let id = "";

test("K01-K04 · sale: lần đầu tạo chữ ký → tải HĐ → Cần ký → chuẩn bị chỗ ký (Tự đặt A/B) → Gửi duyệt", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  // chưa tạo chữ ký thì chưa vào tiếp được (không có «Làm sau»)
  const gate = page.getByRole("dialog", { name: "Tạo chữ ký của bạn" });
  await expect(gate).toBeVisible({ timeout: 30_000 });
  await expect(gate.getByRole("button", { name: "Làm sau" })).toHaveCount(0);
  expect(await createSignatureIfAsked(page, "Lê Mạnh Cường")).toBe(true);

  id = await draftSample(page, E, RUN);
  // chưa có chỗ ký ⇒ chưa gửi được, nói rõ lý do
  await expect(page.getByTestId("sign-prep")).toContainText("chỗ ký");
  await prepareSignPlaces(page);

  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(page.getByTestId("signers-strip")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("signers-strip")).toContainText("Đại diện Người ký hợp đồng");
  await expect(page.getByTestId("signers-strip")).not.toContainText("[object Object]");
  const send = page.getByRole("button", { name: "Gửi duyệt" });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(send).toBeHidden({ timeout: 60_000 });
  await stepEventually(page, id, "Trưởng phòng duyệt", "open");
  await page.context().close();
});

test("K05-K06 · trưởng phòng (khác người tạo): «Đạt» khoá khi chưa ký → Mở và ký (giáp lai + chép mọi trang) → Lưu → Đạt", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPage(browser);
  await loginCw(page, E, HEAD);
  await createSignatureIfAsked(page, "Trần Bình");
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await stepEventually(page, id, "Trưởng phòng duyệt", "open");
  const take = page.getByTestId("claim-take");
  if (await take.isVisible({ timeout: 15_000 }).catch(() => false)) await take.click();
  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  const box = page.getByTestId("approver-sign");
  await expect(box).toBeVisible();
  await expect(page.getByTestId("signature-pad")).toHaveCount(0); // không vẽ tay (Q4)
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý, ký duyệt");
  await expect(page.getByTestId("request-approve-confirm")).toBeDisabled(); // chưa ký ⇒ khoá

  await box.getByRole("link", { name: "Mở và ký" }).click();
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  // trưởng phòng ký tự do: giáp lai trang 1–2 + một chữ ký trang 3 chép sang mọi trang
  await addMineAt(page, 0, 0.5, 0.97);
  await dragMarkAcrossSeam(page, 0);
  await expect(page.getByRole("group", { name: /Chữ ký, Giáp lai 2 trang/ })).toBeVisible();
  await addMineAt(page, 2, 0.5, 0.5);
  await page.getByRole("group", { name: /Chữ ký, Trang 3/ }).click();
  await page.getByRole("button", { name: "Chép sang mọi trang" }).click();
  await expect(page.getByRole("group", { name: /Chữ ký, Trang 6/ })).toBeVisible();
  await saveSigned(page, id);

  await page.locator("[data-approval=pass], [data-approval=approve]").first().click();
  await page.getByRole("textbox", { name: "Ý kiến" }).fill("Đồng ý, ký duyệt");
  await expect(page.getByTestId("approver-sign")).toContainText("đã ký");
  await expect(page.getByTestId("request-approve-confirm")).toBeEnabled();
  await page.getByTestId("request-approve-confirm").click();
  await stepEventually(page, id, "Trưởng phòng duyệt", "passed");
  await page.context().close();
});

test("K07 · giám đốc: bấm ô của mình → Lưu → bước Ký xong; Bên B chưa ký không chặn (tệp «Chờ đối tác»)", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPage(browser);
  await loginCw(page, E, U.director);
  await createSignatureIfAsked(page, "Nguyễn Giám Đốc");
  await page.goto(`${E.cw}/contracts/sign/${id}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Bấm để ký" }).first().click();
  await saveSigned(page, id);
  // ô Bên B chưa ký không chặn: tệp báo «Chờ đối tác» (đối tác ký là đợt 2); trang HĐ không tự cập nhật ⇒ tải lại tới khi đổi
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("sign-status").first()).toContainText("Chờ đối tác", {
      timeout: 5_000,
    });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByText("Đang chờ ký")).toHaveCount(0); // bước Ký đã xong
  await page.context().close();
});

test("K08 · sale: Xem bản đã ký có ba bản «Bản gốc / Sau khi … ký»", async ({ browser }) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await page.getByRole("link", { name: "Xem bản đã ký" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/contracts/signed/${id}`));
  await expect(page.getByTestId("signed-viewer")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("viewer-version").click();
  await expect(page.getByRole("option")).toHaveCount(3); // Bản gốc + sau trưởng phòng + sau giám đốc
  await expect(page.getByRole("option", { name: "Bản gốc" })).toBeVisible();
  await expect(page.getByRole("option", { name: /^Sau khi .* ký/ })).toHaveCount(2);
  await page.context().close();
});

test("K09 · Hồ sơ duyệt hiện hình chữ ký; người chỉ xem HĐ thấy hình nhưng không thấy ý kiến", async ({
  browser,
}) => {
  const rec = async (user: string) => {
    const page = await newPage(browser);
    await loginCw(page, E, user);
    await page.goto(`${E.cw}/contracts/c/${id}`);
    await expect(page.getByTestId("record-line").first()).toBeVisible({ timeout: 60_000 });
    return page;
  };
  const dir = await rec(U.director);
  await expect(dir.getByTestId("record-line").first().locator("img")).toBeVisible();
  await expect(dir.getByText("Đồng ý, ký duyệt")).toBeVisible();
  await dir.context().close();

  const viewer = await rec(U.accounting); // người chỉ xem: ngoài quy trình
  await expect(viewer.getByTestId("record-line").first().locator("img")).toBeVisible();
  await expect(viewer.getByText("Đồng ý, ký duyệt")).toHaveCount(0);
  await expect(viewer.getByTestId("record-hidden").first()).toBeVisible();
  await viewer.context().close();
});

test("M01-M04 · điện thoại 390px: màn ký và trang HĐ không tràn ngang, nút ≥ 44px", async ({
  browser,
}) => {
  const page = await newPage(browser, 390);
  await loginCw(page, E, U.employee);
  const noOverflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
  await page.goto(`${E.cw}/contracts/c/${id}`);
  await expect(page.getByTestId("cfiles")).toBeVisible({ timeout: 30_000 });
  expect(await noOverflow()).toBe(true);
  const view = page.getByTestId("cfile-view").first();
  expect((await view.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.goto(`${E.cw}/contracts/sign/${id}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 30_000 });
  expect(await noOverflow()).toBe(true);
  for (const b of await page.getByRole("button", { name: /^(Lưu|Quay lại|Đóng)/ }).all())
    expect((await b.boundingBox())?.height ?? 44).toBeGreaterThanOrEqual(44);
  await page.context().close();
});

test("Chuột phải «Thêm chữ ký của tôi ở đây» đặt được chữ ký (HĐ riêng, trưởng phòng ở bước duyệt)", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const other = await saleSends(browser, E, `${RUN}m`, U.employee);
  const page = await newPage(browser);
  await loginCw(page, E, HEAD);
  await page.goto(`${E.cw}/contracts/sign/${other}`);
  await expect(page.getByTestId("sign-workspace")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeDisabled();
  await addMineByMenu(page, 0, 0.3, 0.3);
  await expect(page.getByRole("group", { name: /^Chữ ký, Trang 1$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeEnabled();
  await page.context().close();
});
