import { describe, expect, test } from "bun:test";
import type { FrameChild, Milestone } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import {
  attachCandidates,
  docErrorKey,
  docErrorText,
  frameLinkOf,
  kindsFor,
  mergeDiary,
  outsideCount,
  usageOf,
} from "./frame-view";

const child = (id: string, start: string | null, o: Partial<FrameChild> = {}): FrameChild => ({
  id,
  doc_type: "contract",
  title: id,
  number: null,
  status: "active",
  value: 100,
  start_date: start,
  outside_frame: false,
  ...o,
});
const ms = (id: string, due: string, o: Partial<Milestone> = {}) =>
  ({ id, due_date: due, seq: 1, status: "open", kind: "renewal", ...o }) as Milestone;

describe("usageOf (R44)", () => {
  test("không hạn mức ⇒ không thanh", () => {
    expect(usageOf({ credit_pct: null }, null)).toEqual({
      hasLimit: false,
      pct: null,
      bar: 0,
      over: false,
    });
  });
  test("40% ⇒ thanh 40, chưa vượt", () => {
    expect(usageOf({ credit_pct: 40 }, 1000)).toMatchObject({ pct: 40, bar: 40, over: false });
  });
  test("125% ⇒ thanh kín, cảnh báo vượt", () => {
    expect(usageOf({ credit_pct: 125 }, 1000)).toMatchObject({ pct: 125, bar: 100, over: true });
  });
});

describe("mergeDiary (R47)", () => {
  test("xen mốc + con theo ngày, mốc trước con cùng ngày, con không ngày ở cuối, bỏ mốc huỷ", () => {
    const out = mergeDiary(
      [
        ms("m1", "2026-06-01"),
        ms("m2", "2026-03-01"),
        ms("mx", "2026-01-01", { status: "cancelled" }),
      ],
      [child("c1", "2026-03-01"), child("c2", null), child("c3", "2026-02-01")],
    ).map((n) => (n.type === "milestone" ? n.m.id : n.child.id));
    expect(out).toEqual(["c3", "m2", "c1", "m1", "c2"]);
  });
});

describe("kindsFor (R44)", () => {
  test("HĐ NT chỉ Nhắc gia hạn + Khác", () => {
    expect(kindsFor("framework")).toEqual(["renewal", "other"]);
  });
  test("loại khác đủ 7 loại", () => {
    expect(kindsFor("contract")).toHaveLength(7);
    expect(kindsFor(undefined)).toHaveLength(7);
  });
});

describe("outsideCount (R45)", () => {
  test("đếm con ngoài hiệu lực", () => {
    expect(outsideCount([child("a", "x", { outside_frame: true }), child("b", "y")])).toBe(1);
  });
});

describe("attachCandidates", () => {
  const row = (id: string, o: object = {}) => ({ id, kind: "contract", status: "active", ...o });
  test("loại HĐ NT, chính nó, đã gắn, phụ lục, bị từ chối", () => {
    const items = [
      row("self"),
      row("fw"),
      row("att"),
      row("app", { kind: "appendix" }),
      row("rej", { status: "rejected" }),
      row("ok"),
      row("deal"),
    ];
    const docs = items.map((it) => ({
      id: it.id,
      doc_type: it.id === "fw" ? "framework" : it.id === "deal" ? "deal" : "contract",
      frame_root_id: null,
      frame_restricted: false,
    }));
    const r = attachCandidates({ items, docs } as never, "self", ["att"]);
    expect(r.map((x) => x.id)).toEqual(["ok", "deal"]);
  });
});

describe("lỗi 422/409 bằng tiếng Việt", () => {
  const t = (k: string) => k;
  test("khoá theo mã", () => {
    expect(docErrorKey("FRAME_PARTNER_MISMATCH")).toBe("contracts.docframe.err.partnerMismatch");
    expect(docErrorKey("FRAME_MILESTONE_KIND")).toBe("contracts.docframe.err.milestoneKind");
    expect(docErrorKey("FRAME_HAS_CHILDREN")).toBe("contracts.docframe.err.hasChildren");
    expect(docErrorKey("???")).toBeNull();
  });
  test("ApiError ⇒ câu theo mã; 409 lạ ⇒ xung đột; khác ⇒ chung", () => {
    expect(docErrorText(new ApiError(422, "FRAME_PARTNER_MISMATCH" as never, "x"), t)).toBe(
      "contracts.docframe.err.partnerMismatch",
    );
    expect(docErrorText(new ApiError(409, "OTHER" as never, "x"), t)).toBe(
      "contracts.errors.conflict",
    );
    expect(docErrorText(new Error("boom"), t)).toBe("contracts.errors.unknown");
  });
});

describe("frameLinkOf", () => {
  test("không cha ⇒ null; thấy ⇒ link; RLS ⇒ restricted", () => {
    expect(frameLinkOf(undefined)).toBeNull();
    expect(frameLinkOf({ frame: null } as never)).toBeNull();
    expect(frameLinkOf({ frame: { restricted: true } } as never)).toEqual({ kind: "restricted" });
    expect(frameLinkOf({ frame: { id: "i", title: "T", number: "N" } } as never)).toEqual({
      kind: "link",
      id: "i",
      title: "T",
      number: "N",
    });
  });
});
