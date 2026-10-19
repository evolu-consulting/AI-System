// HD4-AC08 · HD4-FR-06 · S05: thẻ hạn chót (render tĩnh, i18n thật) + luật trình bày `deadline.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { daysUntil, leftOf, showsDeadline } from "../lib/deadline";
import { DeadlinePanel } from "./DeadlinePanel";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const ID = "4d400000-0000-4000-8000-000000000001";
type C = Parameters<typeof DeadlinePanel>[0]["contract"];
const base: C = {
  id: ID,
  status: "expiring",
  kind: "contract",
  action_deadline: "2026-10-06",
  handled: null,
};
const html = (c: C, write = true) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <DeadlinePanel contract={c} write={write} queryKey={["contract", ID]} today="2026-10-01" />
    </QueryClientProvider>,
  );

describe("DeadlinePanel", () => {
  test("HD4-AC08 · HĐ đã duyệt: 'Hạn chót hành động 06/10/2026 · còn 5 ngày' + chọn 'Ghi nhận xử lý' (người ghi)", () => {
    const out = html(base);
    expect(out).toContain("Hạn chót hành động");
    expect(out).toContain("06/10/2026");
    expect(out).toContain("còn 5 ngày");
    expect(out).toContain("Ghi nhận xử lý");
    expect(out).toContain("Đang đàm phán");
  });
  test("viewer không thấy ô chọn; đã xử lý ⇒ 'Đã xử lý: Không gia hạn', không đếm ngày", () => {
    expect(html(base, false)).not.toContain("Ghi nhận xử lý");
    const done = html({ ...base, status: "terminated", handled: { outcome: "not_renewed" } });
    expect(done).toContain("Đã xử lý: Không gia hạn");
    expect(done).not.toContain("còn 5 ngày");
  });
  test("chưa duyệt / phụ lục ⇒ không hiện; chưa có hạn ⇒ 'chưa có hạn chót'", () => {
    expect(html({ ...base, status: "needs_review" })).toBe("");
    expect(html({ ...base, kind: "appendix" })).toBe("");
    expect(html({ ...base, action_deadline: null })).toContain("chưa có hạn chót");
  });
  test("luật: daysUntil, tông quá hạn / hôm nay / ≤ 30 / xa, showsDeadline", () => {
    expect(daysUntil("2026-10-06", "2026-10-01")).toBe(5);
    expect(daysUntil(null, "2026-10-01")).toBeNull();
    expect(leftOf(-3)).toMatchObject({ key: "overdue", n: 3, tone: "text-late" });
    expect(leftOf(0).key).toBe("today");
    expect(leftOf(30).tone).toBe("text-soon");
    expect(leftOf(31).tone).toContain("text-dim");
    expect(showsDeadline({ status: "renewed", kind: "contract" })).toBe(true);
    expect(showsDeadline({ status: "rejected", kind: "contract" })).toBe(false);
  });
});
