// CR-188 · BR-188-4/5 · danh sách phiên bản chữ ký (số bản, đang dùng) + ngăn «Giấy tờ đã ký bằng chữ ký này» (trạng thái rỗng/lỗi/xem thêm).
import { describe, expect, test } from "bun:test";
import type { MySignatureHistoryRow } from "@ai/contracts/signature";
import { renderToStaticMarkup } from "react-dom/server";
import { SignatureVersions } from "./components/SignatureVersions";
import { SignedDocsPanel } from "./components/SignedDocsPanel";
import { numberVersions } from "./lib/versions";

const row = (
  id: string,
  at: string,
  retired: string | null,
  kind: "main" | "initials" = "main",
): MySignatureHistoryRow => ({
  id,
  kind,
  method: "type",
  created_at: at,
  retired_at: retired,
});
const H = [
  row("11111111-1111-4111-8111-111111111113", "2026-11-03T00:00:00Z", null),
  row(
    "11111111-1111-4111-8111-111111111112",
    "2026-11-02T00:00:00Z",
    "2026-11-03T00:00:00Z",
    "initials",
  ),
  row("11111111-1111-4111-8111-111111111111", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"),
];

describe("CR-188 · phiên bản chữ ký", () => {
  test("đánh số cũ nhất = 1, mỗi loại đếm riêng, đánh dấu bản đang dùng", () => {
    const v = numberVersions(H);
    expect(v.map((x) => [x.number, x.current])).toEqual([
      [2, true],
      [1, false],
      [1, false],
    ]);
  });
  test("danh sách có số bản, ngày tạo, «Đang dùng», bản được chọn aria-pressed", () => {
    const h = renderToStaticMarkup(<SignatureVersions history={H} selectedId={H[0]?.id} />);
    expect(h).toContain("contracts.mySig.versions.item");
    expect(h).toContain("contracts.mySig.versions.current");
    expect(h.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(h.match(/<button/g)?.length).toBe(3);
  });
});

describe("CR-188 · ngăn giấy tờ đã ký bằng chữ ký này", () => {
  const f = { kind: "" as const, from: "", to: "" };
  const render = (o: Partial<Parameters<typeof SignedDocsPanel>[0]> = {}) =>
    renderToStaticMarkup(<SignedDocsPanel filter={f} onFilter={() => {}} items={[]} {...o} />);
  test("có ô lọc loại + từ ngày + đến ngày, rỗng thì câu nói rõ lý do", () => {
    const h = render();
    expect(h).toContain("contracts.mySig.docs.title");
    expect(h).toContain("contracts.mySig.docs.from");
    expect(h).toContain("contracts.mySig.docs.to");
    expect(h).toContain("contracts.mySig.docs.empty");
  });
  test("đang tải thì không hiện «rỗng», lỗi thì báo lỗi, còn trang thì «Xem thêm»", () => {
    expect(render({ loading: true })).not.toContain("contracts.mySig.docs.empty");
    expect(render({ error: true })).toContain("contracts.mySig.docs.loadErr");
    expect(render({ hasMore: true })).toContain("contracts.mySig.docs.more");
    expect(render()).not.toContain("contracts.mySig.docs.more");
  });
});
