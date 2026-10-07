// CHAT-AC-40 · X2a-AC08 · X2a-AC15 · e2e X2a — kết nối lại `/me/stream` (test-plan X2a §6 E08; plan-frontend-e2e §1 "Trạng thái").
// `page.route` chỉ dùng cho ca lỗi (chặn `/me/stream`). A = lan, B = thu.
import { expect, test } from "@playwright/test";
import { apiGroup, apiSay, roomLog, token, twoUsers, USER_ID, uniq } from "./_x2a-support";

test('CHAT-AC-40 · E08 · chặn /me/stream ⇒ status "Đang kết nối lại…"; bỏ chặn ⇒ banner ẩn; tin gửi lúc đứt hiện đúng 1 lần (data-seq không lặp)', async ({
  browser,
}) => {
  const a = await token("lan");
  const g = await apiGroup(a, uniq("E08"), [USER_ID.thu]);
  await apiSay(a, g, uniq("E08 mồi"));
  const u = await twoUsers(browser);
  try {
    // chặn TRƯỚC khi mở trang: stream không nối được ⇒ client vào trạng thái kết nối lại
    await u.pb.route("**/me/stream*", (r) => r.abort("connectionreset"));
    await u.pb.goto(`/rooms/${g}`);
    await expect(roomLog(u.pb)).toBeVisible();
    const banner = u.pb.getByRole("status").filter({ hasText: "Đang kết nối lại…" });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    const text = uniq("E08 lúc đứt");
    await apiSay(a, g, text);
    await u.pb.unroute("**/me/stream*");
    await expect(banner).toBeHidden({ timeout: 20_000 });
    const hit = roomLog(u.pb).getByRole("article").filter({ hasText: text });
    await expect(hit).toHaveCount(1, { timeout: 5_000 });
    const seqs = await roomLog(u.pb)
      .locator("article[data-seq]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-seq")));
    expect(seqs.length).toBeGreaterThan(0);
    expect(new Set(seqs).size).toBe(seqs.length);
  } finally {
    await u.close();
  }
});
