// CR-102 · C12b · 3 vai trên stack thật + seed demo (docs/current/community/hien-thi.md): ai thấy bài nào, che liên hệ,
// luồng riêng từng công ty, dấu "chỉ chủ quản". Dữ liệu = `seed-community-demo` (bài Thùng phi 200L, CKS, Băng keo…).
import { expect, test } from "@playwright/test";
import { MASK_PHONE, ORG, openAs, postByTitle } from "./_stack";

test.describe("community-web · 3 vai (stack thật)", () => {
  test("chủ quản: thấy mọi bài, số điện thoại NCC bị tô (raw), luồng theo từng công ty, đánh dấu bài đối tác", async ({
    browser,
  }) => {
    const { ctx, page } = await openAs(browser, "host");
    await page.goto("/#/feed");
    for (const t of ["Thùng phi 200L", "Lịch nghỉ lễ 20/11", "Băng keo 5cm"])
      await expect(postByTitle(page, t).first()).toBeVisible();
    // hai bài Chữ ký số (của chủ quản + của ABC) và hai bài Băng keo (Tân Phát bán, Hưng Thịnh mua)
    await expect(postByTitle(page, "Chữ ký số DN – USB Token")).toHaveCount(2);
    await expect(postByTitle(page, "Băng keo 5cm")).toHaveCount(2);
    // bài của đối tác: nhãn "Chỉ chủ quản" + "Lưu báo giá" (C7: bật cho chủ quản) mở form báo giá điền sẵn nhà cung cấp
    const tp = postByTitle(page, "Băng keo 5cm").filter({ hasText: ORG.supplier });
    await expect(tp).toContainText("Chỉ chủ quản");
    await tp.getByRole("button", { name: /Lưu báo giá/ }).click();
    await expect(tp.locator("#q-sup")).toHaveValue(ORG.supplier);
    await expect(postByTitle(page, "Lịch nghỉ lễ 20/11")).not.toContainText("Chỉ chủ quản");
    // luồng riêng: bài Thùng phi có tab công ty Tân Phát, thấy số điện thoại gốc trong luồng
    const phi = postByTitle(page, "Thùng phi 200L");
    await phi.getByRole("button", { name: /Bình luận/ }).click();
    await expect(phi.getByRole("tab", { name: new RegExp(ORG.supplier) })).toBeVisible();
    await expect(phi.getByTestId("thread")).toContainText("0903 123 456");
    await expect(phi.getByTestId("thread")).not.toContainText(MASK_PHONE);
    await ctx.close();
  });

  test("NCC (Tân Phát): chỉ thấy bài được gửi tới mình, liên hệ của mình bị che, không Lưu báo giá, luồng riêng", async ({
    browser,
  }) => {
    const { ctx, page } = await openAs(browser, "supplier");
    await page.goto("/#/feed");
    await expect(postByTitle(page, "Thùng phi 200L")).toBeVisible(); // Cần mua của chủ quản gửi NCC Thùng phi
    await expect(postByTitle(page, "Lịch nghỉ lễ 20/11")).toBeVisible(); // thông báo: mọi bạn bè
    // KHÔNG thấy: bài CKS của chủ quản (audience người mua nhóm CKS), bài của ABC / Hưng Thịnh
    await expect(postByTitle(page, "Chữ ký số DN – USB Token")).toHaveCount(0);
    await expect(postByTitle(page, "Băng keo 5cm")).toHaveCount(1); // chỉ bài của chính mình
    const mine = postByTitle(page, "Băng keo 5cm");
    await expect(mine).not.toContainText("0903");
    await expect(mine).not.toContainText("zalo.me");
    // thẻ bài của đối tác ghi "Chỉ chủ quản"; nhắc ở ô soạn bài (Composer) cho đối tác
    await expect(mine).toContainText("Chỉ chủ quản");
    await expect(page.getByTestId("partner-note")).toHaveText("Chỉ chủ quản thấy bài này");
    await expect(page.getByText("Lưu báo giá")).toHaveCount(0);
    // luồng riêng của mình: số điện thoại trong bình luận chính mình cũng bị che; không có tab công ty khác
    const phi = postByTitle(page, "Thùng phi 200L");
    await phi.getByRole("button", { name: /Bình luận/ }).click();
    const th = phi.getByTestId("thread");
    await expect(th).toContainText("Chỉ chủ quản thấy trao đổi này.");
    await expect(th).not.toContainText("0903");
    await expect(th).toContainText(MASK_PHONE);
    await expect(phi.getByRole("tab")).toHaveCount(0);
    // tên công ty khác bị che khi viết bình luận
    await th.getByLabel("Viết bình luận").fill(`Báo giá cho ${ORG.buyer}: 0912 345 678`);
    await th.getByRole("button", { name: "Gửi bình luận" }).click();
    await expect(th).toContainText(MASK_PHONE);
    await expect(th).not.toContainText("0912");
    await ctx.close();
  });

  test("người mua (ABC): không thấy bài Cần mua / bài của đối tác khác; thấy thông báo; bài mình chỉ chủ quản thấy", async ({
    browser,
  }) => {
    const { ctx, page } = await openAs(browser, "buyer");
    await page.goto("/#/feed");
    await expect(postByTitle(page, "Lịch nghỉ lễ 20/11")).toBeVisible();
    await expect(postByTitle(page, "Thùng phi 200L")).toHaveCount(0); // Cần mua gửi NCC, ABC chỉ là người mua
    await expect(postByTitle(page, "Băng keo 5cm")).toHaveCount(0); // bài Tân Phát/Hưng Thịnh: chỉ chủ quản
    await expect(postByTitle(page, "Chữ ký số DN – USB Token")).toHaveCount(1); // bài Cần mua của chính ABC
    await expect(postByTitle(page, "Chữ ký số DN – USB Token")).toContainText("Chỉ chủ quản");
    await expect(page.getByTestId("partner-note")).toHaveText("Chỉ chủ quản thấy bài này");
    await expect(page.getByText("Lưu báo giá")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mở trợ lý giá" })).toHaveCount(0);
    // không có tab luồng công ty khác: ABC chỉ có luồng riêng với chủ quản
    const mine = postByTitle(page, "Chữ ký số DN – USB Token");
    await mine.getByRole("button", { name: /Bình luận/ }).click();
    await expect(mine.getByRole("tab")).toHaveCount(0);
    await ctx.close();
  });

  test("hai đối tác không thấy nhau: bài gửi NCC không tới người mua", async ({ browser }) => {
    const a = await openAs(browser, "supplier");
    const b = await openAs(browser, "buyer");
    for (const p of [a.page, b.page]) await p.goto("/#/feed");
    await expect(postByTitle(a.page, "Thùng phi 200L")).toBeVisible();
    await expect(postByTitle(b.page, "Thùng phi 200L")).toHaveCount(0);
    await a.ctx.close();
    await b.ctx.close();
  });
});
