// CHAT-AC-52 · F1 · e2e P-a PF1 · E-P6 (test-plan-e2e §2; plan-frontend-e2e §1 "Hỏi AI"): `/c/new` gõ "!hoa-don-t x" ⇒ điều
// hướng `/runs/<id>`; ở `/c/<id>` ⇒ thẻ trong `region "Quy trình trong hội thoại này"` + toast "Đã bắt đầu quy trình …" có
// "Mở"; có tệp đính kèm ⇒ alert "Quy trình chưa nhận tệp đính kèm…" (không tạo run).

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ACME, PERSONA, settle, users, withSql } from "../_pa-support";

test.afterEach(() => settle());

const aiBox = (p: import("@playwright/test").Page) =>
  p.getByRole("textbox", { name: "Tin nhắn", exact: true });

test('CHAT-AC-52 · E-P6 · Hỏi AI: /c/new "!hoa-don-t x" ⇒ /runs/<id>; ở /c/<id> ⇒ thẻ trên khung nhập + toast "Mở"; có tệp ⇒ alert chặn', async ({
  browser,
}) => {
  const u = await users(browser, "A");
  try {
    const p = u.A;
    await p.goto("/c/new");
    await aiBox(p).fill("!hoa-don-t x");
    await p.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(p).toHaveURL(/\/runs\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(p.getByRole("heading", { name: "Hoá đơn T" })).toBeVisible();

    // hội thoại có sẵn
    const convId = randomUUID();
    await withSql(
      (sql) => sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
        values (${convId}, ${ACME}, ${PERSONA.A.id}, 'EP6 hội thoại', 'ep6 hoi thoai')`,
    );
    await p.goto(`/c/${convId}`);
    await aiBox(p).fill("!hoa-don-t HD-6");
    await p.getByRole("button", { name: "Gửi", exact: true }).click();
    const region = p.getByRole("region", { name: "Quy trình trong hội thoại này" });
    await expect(region.getByRole("article", { name: "Quy trình Hoá đơn T" })).toBeVisible();
    const toast = p.getByText(/Đã bắt đầu quy trình Hoá đơn T/);
    await expect(toast).toBeVisible();
    await expect(p.getByRole("button", { name: "Mở", exact: true })).toBeVisible();

    // có tệp ⇒ chặn
    await p
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "hd.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("HD-6"),
      });
    await aiBox(p).fill("!hoa-don-t HD-7");
    await p.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(
      p.getByRole("alert").filter({ hasText: "Quy trình chưa nhận tệp đính kèm" }),
    ).toBeVisible();
    await expect(region.getByRole("article", { name: "Quy trình Hoá đơn T" })).toHaveCount(1);
  } finally {
    await u.close();
  }
});
