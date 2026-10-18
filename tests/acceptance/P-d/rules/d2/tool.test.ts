// AC-H44 · HUB-FR-146 · HUB-BR-12 · test-plan-d2 §1 PD2-U04…U09 (plan-d2-rules §1, plan-addendum A7): luật lớp 1 stage `tool`
// — `buildToolArgs`, `classifyToolError`, `toolFailureDecision`, `filterToolFields`, `toolOutputMd`. Nạp qua CỔNG LỚP
// `loadLayer("domain", …)` (barrel `P/domain/index.ts`, T17) — không phụ thuộc đường dẫn file. Barrel vắng ⇒ đỏ "chưa có cổng lớp".
import { describe, expect, it } from "bun:test";
import { layerFn } from "../../_support/modules";

const dom = (name: string) => layerFn("domain", name, "T17");
const N = new Date("2026-11-20T01:00:00.000Z");
const plus = (s: number) => new Date(N.getTime() + s * 1000);
const S = (c: number, ra: number | null, rr: number | null, a = 1, r = 1) => ({
  retryCount: c,
  retryAttempt: ra,
  retryRound: rr,
  attempt: a,
  round: r,
});
const F = (
  code: string,
  sent: boolean,
  httpStatus: number | null = null,
  reason: string | null = null,
) => ({
  code,
  httpStatus,
  sent,
  reason,
});

describe("PD2-U04…U05 · buildToolArgs [plan-d2-rules §1]", () => {
  const args = {
    han: { from: "input", key: "han" },
    tong_tien: { from: "field", stageKey: "s0", field: "tong_tien" },
    gap: { from: "const", value: true },
  };
  it("AC-H44 · PD2-U04 · input + field + const ⇒ ok, giá trị đúng kiểu (số giữ số, boolean giữ boolean)", async () => {
    const f = await dom("buildToolArgs");
    const r = f(
      args,
      new Map([["han", "2026-11-30"]]),
      new Map([["s0", { tong_tien: 25_000_000 }]]),
    );
    expect(r).toEqual({
      ok: true,
      values: { han: "2026-11-30", tong_tien: 25_000_000, gap: true },
    });
  });
  it("AC-H44 · PD2-U05 · stage nguồn null (skipped) / field vắng / input vắng ⇒ {ok:false, missing:<tên tham số>}", async () => {
    const f = await dom("buildToolArgs");
    const inputs = new Map([["han", "2026-11-30"]]);
    expect(f(args, inputs, new Map([["s0", null]]))).toEqual({ ok: false, missing: "tong_tien" });
    expect(f(args, inputs, new Map([["s0", { khac: 1 }]]))).toEqual({
      ok: false,
      missing: "tong_tien",
    });
    expect(f(args, new Map(), new Map([["s0", { tong_tien: 1 }]]))).toEqual({
      ok: false,
      missing: "han",
    });
  });
});

describe("PD2-U04 · buildToolArgs · inputTypes [D2-29, readiness #100]", () => {
  const args = {
    tong_tien: { from: "input", key: "so-tien" },
    ma_kh: { from: "input", key: "ma" },
  };
  const inputs = new Map([
    ["so-tien", "25000000"],
    ["ma", "007"],
  ]);
  it("AC-H44 · PD2-U04 · input kiểu number ⇒ Number (số JS); input text giữ chuỗi dù trông như số", async () => {
    const f = await dom("buildToolArgs");
    const types = new Map([
      ["so-tien", "number"],
      ["ma", "text"],
    ]);
    expect(f(args, inputs, new Map(), types)).toEqual({
      ok: true,
      values: { tong_tien: 25_000_000, ma_kh: "007" },
    });
  });
  it("AC-H44 · PD2-U04 · không truyền inputTypes (tham số 4 tuỳ chọn) ⇒ giữ chuỗi như P-d2 gốc", async () => {
    const f = await dom("buildToolArgs");
    expect(f(args, inputs, new Map())).toEqual({
      ok: true,
      values: { tong_tien: "25000000", ma_kh: "007" },
    });
  });
});

describe("PD2-U02 · paramCompatible [plan-d2-rules §2, D2-29, readiness #100]", () => {
  // [kiểu tham số, kiểu nguồn, hợp lệ?] — ma trận duy nhất BE ≡ FE
  const V: [string, string, boolean][] = [
    ["number", "number", true],
    ["number", "string", false],
    ["number", "date", false],
    ["number", "boolean", false],
    ["boolean", "boolean", true],
    ["boolean", "string", false],
    ["boolean", "number", false],
    ["select", "string", true],
    ["select", "number", false],
    ["select", "date", false],
    ["select", "boolean", false],
    ["text", "string", true],
    ["text", "number", true],
    ["text", "date", true],
    ["text", "boolean", true],
    ["paragraph", "number", true],
    ["paragraph", "date", true],
    ["date", "date", true],
    ["date", "string", true],
    ["date", "number", false],
  ];
  it("AC-H44 · PD2-U02 · ma trận paramCompatible(sourceType, paramType) khớp bảng plan-d2-rules §2 (20 vector)", async () => {
    const f = await dom("paramCompatible");
    const got = V.map(([p, s]) => [p, s, f(s, p)]);
    expect(got).toEqual(V);
  });
});

describe("PD2-U06 · classifyToolError [plan-d2-rules §1, Q-D2-2]", () => {
  it("HUB-BR-12 · PD2-U06 · chưa gửi UPSTREAM_ERROR/TIMEOUT ⇒ transient", async () => {
    const f = await dom("classifyToolError");
    expect([f(F("UPSTREAM_ERROR", false)), f(F("TIMEOUT", false))]).toEqual([
      "transient",
      "transient",
    ]);
  });
  it("HUB-BR-12 · PD2-U06 · đã gửi: http null/500/503/408/429 ⇒ transient; 400/403 ⇒ business", async () => {
    const f = await dom("classifyToolError");
    const http = [null, 500, 503, 408, 429, 400, 403];
    expect(http.map((h) => f(F("UPSTREAM_ERROR", true, h)))).toEqual([
      "transient",
      "transient",
      "transient",
      "transient",
      "transient",
      "business",
      "business",
    ]);
  });
  it("HUB-BR-12 · PD2-U06 · NOT_CONFIGURED / INVALID_ARGS / reason invalid_output / mã lạ ⇒ business", async () => {
    const f = await dom("classifyToolError");
    expect([
      f(F("NOT_CONFIGURED", false)),
      f(F("INVALID_ARGS", true, 400)),
      f(F("UPSTREAM_ERROR", true, 200, "invalid_output")),
      f(F("XYZ_LA", true, 500)),
    ]).toEqual(["business", "business", "business", "business"]);
  });
});

describe("PD2-U07 · toolFailureDecision — dùng chung decideRetry/backoff [D2-13]", () => {
  it("HUB-BR-12 · PD2-U07 · business ⇒ decide tool_failed", async () => {
    const f = await dom("toolFailureDecision");
    expect(
      f({ f: F("UPSTREAM_ERROR", true, 400), sideEffect: false, state: S(0, null, null), now: N }),
    ).toEqual({
      kind: "decide",
      reason: "tool_failed",
    });
  });
  it("HUB-BR-12 · PD2-U07 · transient + sideEffect + sent ⇒ decide tool_failed (không gọi lại)", async () => {
    const f = await dom("toolFailureDecision");
    expect(
      f({ f: F("UPSTREAM_ERROR", true, 500), sideEffect: true, state: S(0, null, null), now: N }),
    ).toEqual({
      kind: "decide",
      reason: "tool_failed",
    });
  });
  it("HUB-BR-12 · PD2-U07 · transient + sideEffect + chưa gửi ⇒ retry 1 (+30 s)", async () => {
    const f = await dom("toolFailureDecision");
    expect(
      f({ f: F("UPSTREAM_ERROR", false), sideEffect: true, state: S(0, null, null), now: N }),
    ).toEqual({
      kind: "retry",
      retryCount: 1,
      dueAt: plus(30),
    });
  });
  it("HUB-BR-12 · PD2-U07 · transient không side effect, đã 3 lượt ⇒ decide retry_exhausted", async () => {
    const f = await dom("toolFailureDecision");
    expect(f({ f: F("TIMEOUT", true), sideEffect: false, state: S(3, 1, 1), now: N })).toEqual({
      kind: "decide",
      reason: "retry_exhausted",
    });
  });
});

describe("PD2-U08…U09 · filterToolFields + toolOutputMd [D2-05, plan-addendum A7]", () => {
  const decl = [
    { key: "tong_tien", type: "number", required: true },
    { key: "ngay", type: "date", required: false },
  ];
  it("AC-H44 · PD2-U08 · object đúng kiểu ⇒ ok, bỏ trường thừa", async () => {
    const f = await dom("filterToolFields");
    expect(f({ tong_tien: 25_000_000, ngay: "2026-11-20", thua: 1 }, decl)).toEqual({
      ok: true,
      fields: { tong_tien: 25_000_000, ngay: "2026-11-20" },
    });
  });
  it("AC-H44 · PD2-U08 · mảng/chuỗi ⇒ not_object; thiếu required ⇒ missing; 'abc' cho number / 2026-02-30 ⇒ type", async () => {
    const f = await dom("filterToolFields");
    expect([
      f([1], decl),
      f("x", decl),
      f({ ngay: "2026-11-20" }, decl),
      f({ tong_tien: "abc" }, decl),
      f({ tong_tien: 1, ngay: "2026-02-30" }, decl),
    ]).toEqual([
      { ok: false, why: "not_object" },
      { ok: false, why: "not_object" },
      { ok: false, why: "missing" },
      { ok: false, why: "type" },
      { ok: false, why: "type" },
    ]);
  });
  it("AC-H44 · PD2-U09 · toolOutputMd khớp nguyên văn A7 (bảng theo thứ tự, ## Kết quả + ## Bàn giao, khối fields)", async () => {
    const f = await dom("toolOutputMd");
    const fields = { tong_tien: 25_000_000, ma_kh: "KH1" };
    expect(f("Xuất HĐ", fields)).toBe(
      "# Xuất HĐ\n\n## Kết quả\n| Trường | Giá trị |\n|---|---|\n| tong_tien | 25000000 |\n| ma_kh | KH1 |\n\n" +
        `## Bàn giao\nĐã gọi tool; trường: tong_tien, ma_kh\n\n\`\`\`fields\n${JSON.stringify(fields)}\n\`\`\`\n`,
    );
  });
  it("AC-H44 · PD2-U09 · không trường ⇒ không dòng bảng + '(không có)'; '|' thoát '\\|', xuống dòng ⇒ dấu cách", async () => {
    const f = await dom("toolOutputMd");
    const empty = f("T", {});
    expect(empty).toContain("Đã gọi tool; trường: (không có)");
    expect(empty).not.toMatch(/^\| [a-z]/m);
    expect(f("T", { ghi: "a|b\nc" })).toContain("| ghi | a\\|b c |");
  });
});
