// CR-130 · hàng thông báo của chuông chung: link thật khi `link`, nút khi mặc định, giờ tạo khi có `time`.
import { describe, expect, test } from "bun:test";
import type { NotificationItem } from "@ai/web-kit/notify/client";
import { NotificationRow } from "@ai/web-kit/ui/NotificationBell";
import { renderToStaticMarkup } from "react-dom/server";

const n = (o: Partial<NotificationItem> = {}): NotificationItem =>
  ({
    id: "a1",
    seq: 1,
    source: "community",
    kind: "comment",
    title: "Có bình luận mới",
    body: "Xin chào",
    link: "/community?post=p1",
    created_at: "2026-10-18T02:00:00.000Z",
    read: false,
    ...o,
  }) as NotificationItem;
const bell = { readOne: async () => {} } as never;
const go = () => {};

describe("NotificationRow", () => {
  test("linkRows: <a href> thật, chưa đọc có chấm + đậm, có giờ", () => {
    const h = renderToStaticMarkup(
      <NotificationRow
        n={n()}
        bell={bell}
        go={go}
        link
        time={(i) => `T:${i.slice(0, 10)}`}
        unreadDot="Chưa đọc"
      />,
    );
    expect(h).toContain('<a href="/community?post=p1"');
    expect(h).toContain('aria-label="Chưa đọc"');
    expect(h).toContain("font-weight:600");
    expect(h).toContain("T:2026-10-18");
  });
  test("mặc định: nút, đã đọc không chấm, không link vẫn là nút", () => {
    const h = renderToStaticMarkup(
      <NotificationRow
        n={n({ read: true, link: null })}
        bell={bell}
        go={go}
        link={false}
        unreadDot="Chưa đọc"
      />,
    );
    expect(h).toContain("<button");
    expect(h).not.toContain("Chưa đọc");
    expect(h).not.toContain("<a ");
  });
});
