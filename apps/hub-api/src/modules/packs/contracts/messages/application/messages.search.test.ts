// CR-178 M3 · unit luật thuần tìm tin: bỏ dấu, đoạn trích, con trỏ.
import { describe, expect, it } from "bun:test";
import { MSG_SNIPPET_MAX } from "@ai/contracts/pack-contracts";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  escapeLike,
  foldText,
  newerFirst,
  snippetOf,
} from "./messages.search";

const CID = "0a0b0c0d-1111-4222-8333-444455556666";
const len = (s: string) =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)).length;

describe("CR-178 M3 · foldText / escapeLike", () => {
  it("bỏ dấu + hoa/thường, đ→d; bản NFD cũng khớp", () => {
    expect(foldText("Báo GIÁ Đặng")).toBe("bao gia dang");
    expect(foldText("Báo giá".normalize("NFD"))).toBe("bao gia");
  });
  it("thoát \\ % _", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });
});

describe("CR-178 M3 · snippetOf", () => {
  it("thân ngắn: giữ nguyên (gộp khoảng trắng), match theo UTF-16, 'bao gia' khớp 'Báo giá'", () => {
    const r = snippetOf("Gửi anh  Báo giá\nQ1", "bao gia");
    expect(r.snippet).toBe("Gửi anh Báo giá Q1");
    expect(r.snippet.slice(r.match?.start, r.match?.end)).toBe("Báo giá");
  });
  it("thân dài: ≤ 160 ký tự, có chỗ khớp, «…» đúng đầu/cuối; khớp ở đầu / giữa / cuối", () => {
    const pad = (n: number) => "lorem ipsum ".repeat(n);
    for (const body of [
      `báo giá ${pad(40)}`,
      `${pad(20)} báo giá ${pad(20)}`,
      `${pad(40)} báo giá`,
    ]) {
      const r = snippetOf(body, "BAO GIA");
      expect(len(r.snippet)).toBeLessThanOrEqual(MSG_SNIPPET_MAX);
      expect(r.snippet.slice(r.match?.start, r.match?.end)).toBe("báo giá");
    }
    const mid = snippetOf(`${pad(20)} báo giá ${pad(20)}`, "báo giá").snippet;
    expect([mid.startsWith("…"), mid.endsWith("…")]).toEqual([true, true]);
  });
  it("không cắt đôi emoji (cặp thay thế, cụm ghép ZWJ); không khớp ⇒ trích từ đầu, match null", () => {
    const body = `${"😀".repeat(100)}báo giá${"👨‍👩‍👧".repeat(100)}`;
    const r = snippetOf(body, "bao gia");
    expect(len(r.snippet)).toBeLessThanOrEqual(MSG_SNIPPET_MAX);
    expect(r.snippet).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
    expect(r.snippet.slice(r.match?.start, r.match?.end)).toBe("báo giá");
    const t = snippetOf("😀".repeat(300), "zzz");
    expect([t.match, len(t.snippet) <= MSG_SNIPPET_MAX, t.snippet.endsWith("…")]).toEqual([
      null,
      true,
      true,
    ]);
  });
});

describe("CR-178 M3 · con trỏ + thứ tự", () => {
  it("mã hoá/giải mã; hỏng ⇒ null", () => {
    const c = { at: "2026-11-16T01:02:03.456789Z", cid: CID, seq: 9 };
    expect(decodeSearchCursor(encodeSearchCursor(c))).toEqual(c);
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const bad = [
      "",
      "%%",
      enc([1, 2, 3]),
      enc(["2026-11-16T01:02:03Z", "x", 1]),
      enc(["2026-11-16T01:02:03Z", CID, 0]),
    ];
    for (const s of bad) expect([s, decodeSearchCursor(s)]).toEqual([s, null]);
  });
  it("newerFirst: thời điểm → id cuộc → seq, giảm dần", () => {
    const x = { at: "2026-11-16T01:00:00.000000Z", conversation_id: CID, seq: 1 };
    expect(newerFirst({ ...x, at: "2026-11-16T02:00:00.000000Z" }, x)).toBe(-1);
    expect(newerFirst({ ...x, seq: 2 }, x)).toBeLessThan(0);
    expect(newerFirst(x, { ...x, seq: 2 })).toBeGreaterThan(0);
  });
});
