import { describe, expect, test } from "bun:test";
import { checkPrototype } from "./check.rules";
import {
  appendDecision,
  type Feedback,
  feedbackSchema,
  protoVersion,
  staleError,
} from "./feedback.rules";
import { wrap2 } from "./flow";
import { scenarioSkeleton } from "./scenarios.rules";
import { type Prototype, prototypeSchema } from "./schema";

const mk = (over: Record<string, unknown> = {}): Prototype =>
  prototypeSchema.parse({
    title: "Mẫu",
    roles: [
      { key: "a", label: "Kế toán" },
      { key: "b", label: "Đối tác" },
    ],
    screens: [
      { id: "s1", title: "Việc của tôi", role: "a", blocks: [] },
      { id: "s2", title: "Đối tác xác nhận", role: "b", blocks: [] },
    ],
    flow: [
      { from: "s1", action: "Gửi đối tác", to: "s2", by: "a" },
      { from: "s2", action: "Xác nhận", to: "s1", by: "b" },
    ],
    questions: [{ id: "q1", text: "Hạn?", options: ["3 ngày", "7 ngày"], default: "7 ngày" }],
    ...over,
  });

const screens = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Màn ${i}`, blocks: [] }));

describe("schema chéo", () => {
  test("flow từ/đến màn không có, câu hỏi sai màn/gợi ý, vai lạ đều bị từ chối", () => {
    expect(() => mk({ flow: [{ from: "zz", action: "x", to: "s1", by: "a" }] })).toThrow(/zz/);
    expect(() => mk({ flow: [{ from: "s1", action: "x", to: "s2", by: "q" }] })).toThrow(/vai/);
    expect(() =>
      mk({
        questions: [{ id: "q", screen: "nope", text: "?", options: ["a", "b"], default: "a" }],
      }),
    ).toThrow(/nope/);
    expect(() =>
      mk({ questions: [{ id: "q", text: "?", options: ["a", "b"], default: "c" }] }),
    ).toThrow(/gợi ý/);
  });

  test("goto trong thẻ, hộp thoại, trang trống, tab đều được kiểm", () => {
    const bad = (block: unknown) =>
      mk({ screens: [{ id: "s1", title: "A", blocks: [block] }], flow: [], questions: [] });
    expect(() => bad({ type: "cards", items: [{ title: "x", goto: "zz" }] })).toThrow(/zz/);
    expect(() =>
      bad({ type: "modal", trigger: "t", title: "t", text: "t", confirm: "c", goto: "zz" }),
    ).toThrow(/zz/);
    expect(() => bad({ type: "empty", title: "t", action: "a", goto: "zz" })).toThrow(/zz/);
    expect(() =>
      bad({
        type: "tabs",
        tabs: [{ key: "k", label: "K", blocks: [{ type: "button", label: "b", goto: "zz" }] }],
      }),
    ).toThrow(/zz/);
  });
});

describe("checkPrototype", () => {
  test("sạch thì không lỗi", () => {
    expect(checkPrototype(mk())).toEqual({ errors: [], warnings: [] });
  });

  test("cảnh báo > 8 màn, lỗi > 12 màn", () => {
    expect(
      checkPrototype(mk({ screens: screens(9), flow: [], questions: [] })).warnings,
    ).toHaveLength(1);
    const r = checkPrototype(mk({ screens: screens(13), flow: [], questions: [] }));
    expect(r.errors[0]).toContain("13");
  });

  test("từ kỹ thuật trong chữ hiển thị: báo đường dẫn; mã nội bộ thì bỏ qua", () => {
    const p = mk({
      screens: [
        {
          id: "slot-1",
          title: "Chọn slot",
          blocks: [{ type: "text", text: "gửi payload cho tenant" }],
        },
        {
          id: "s2",
          title: "Lỗi id=5",
          blocks: [{ type: "text", text: "Khe cắm; không phải khẻ" }],
        },
      ],
      flow: [],
      questions: [],
    });
    const e = checkPrototype(p).errors.join("\n");
    expect(e).toContain("$.screens[0].title");
    expect(e).toContain("$.screens[0].blocks[0].text");
    expect(e).toContain("$.screens[1].title");
    expect(e).toContain("$.screens[1].blocks[0].text");
    expect(e).not.toContain("$.screens[0].id");
    expect(checkPrototype(mk({ title: "Nghe tên khẻ" })).errors).toEqual([]);
  });
});

describe("góp ý", () => {
  const fb = (p: Prototype): Feedback =>
    feedbackSchema.parse({
      prototype: { id: "mau", title: p.title, version: protoVersion(p) },
      exportedAt: "2026-11-10T01:00:00.000Z",
      answers: [{ id: "q1", question: "Hạn?", answer: "3 ngày" }],
      unanswered: [{ id: "q2", question: "Từ chối thì sao?" }],
      screens: [
        { id: "s1", title: "Việc của tôi", verdict: "fix", note: "Thêm cột hạn" },
        { id: "s2", title: "Đối tác xác nhận", verdict: "ok", note: "" },
      ],
    });

  test("phiên bản đổi khi nội dung đổi; góp ý bản cũ bị từ chối", () => {
    const p = mk();
    expect(protoVersion(p)).toBe(protoVersion(mk()));
    expect(protoVersion(p)).not.toBe(protoVersion(mk({ title: "Khác" })));
    expect(staleError(fb(p), p)).toBeNull();
    expect(staleError(fb(p), mk({ title: "Khác" }))).toContain("Góp ý cũ");
  });

  test("đoạn Quyết định có đủ câu đã chốt, màn cần sửa, màn đúng ý", () => {
    const out = appendDecision("# Spec\n", fb(mk()), "2026-11-10") ?? "";
    expect(out).toContain("## Quyết định từ bản mẫu (2026-11-10)");
    expect(out).toContain("- Hạn? → **3 ngày**");
    expect(out).toContain("### Câu chưa chốt\n- Từ chối thì sao?");
    expect(out).toContain("### Màn hình cần sửa\n- «Việc của tôi»: Thêm cột hạn");
    expect(out).toContain("### Màn hình đúng ý\n- «Đối tác xác nhận»");
    expect(out.startsWith("# Spec\n\n## Quyết định")).toBe(true);
  });

  test("nối lần hai cùng góp ý thì bỏ qua", () => {
    const f = fb(mk());
    const once = appendDecision("", f, "2026-11-10") ?? "";
    expect(appendDecision(once, f, "2026-11-11")).toBeNull();
  });
});

describe("scenarioSkeleton", () => {
  test("mỗi bước luồng một Kịch bản, gom theo màn", () => {
    const out = scenarioSkeleton(mk(), "pl/gui.md");
    expect(out).toContain("### ADDED pl/gui.md");
    expect(out).toContain(
      "#### Yêu cầu: Việc của tôi\n- Kịch bản: khi Kế toán gửi đối tác thì «Đối tác xác nhận» [test: thủ công — chưa viết]",
    );
    expect(out).toContain(
      "#### Yêu cầu: Đối tác xác nhận\n- Kịch bản: khi Đối tác xác nhận thì «Việc của tôi»",
    );
    expect(out.match(/- Kịch bản:/g)).toHaveLength(2);
  });
});

describe("wrap2", () => {
  test("tối đa 2 dòng", () => {
    expect(wrap2("Gửi đối tác xác nhận hợp đồng lần nữa cho chắc ăn nhé")).toHaveLength(2);
    expect(wrap2("Xác nhận")).toEqual(["Xác nhận"]);
  });
});
