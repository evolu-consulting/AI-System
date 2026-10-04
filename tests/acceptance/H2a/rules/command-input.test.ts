// HUB-FR-12 · H2a-R06 · buildInputs, appNeedsQuery (test-plan H2a §4 R15–R26, cases §1.2; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import type { CommandArg, InputMap, WorkflowInput } from "@ai/contracts";
import type { MessageContext } from "@ai/contracts/chat";
import {
  appNeedsQuery,
  type BuildInputsInput,
  buildInputs,
} from "../../../../apps/hub-api/src/modules/commands/command-input.rules";
import { arg, DICH_ARGS, DICH_INPUTS, DICH_MAP, input, uid } from "./_catalog";

const USER = uid(1);
const TENANT = uid(2);

type Case = {
  schema: readonly WorkflowInput[];
  map: InputMap;
  args?: readonly CommandArg[];
  values?: Record<string, string | null>;
  ctx?: MessageContext;
};

function run(c: Case) {
  const i: BuildInputsInput = {
    inputMap: c.map,
    inputSchema: c.schema,
    args: c.args ?? Object.keys(c.values ?? {}).map((n) => arg(n)),
    values: c.values ?? {},
    ctx: c.ctx ?? {},
    userId: USER,
    tenantId: TENANT,
  };
  return buildInputs(i);
}

const NUM = { schema: [input("n", "number")], map: { n: { source: "arg", value: "n" } } } as const;
const BOOL = {
  schema: [input("flag", "boolean")],
  map: { flag: { source: "arg", value: "flag" } },
} as const;

describe("HUB-FR-12 · buildInputs nguồn map [R15, R16]", () => {
  it("HUB-FR-12 · map arg, const, user_id, tenant_id [R15]", () => {
    const r = run({
      schema: [input("a", "text", { required: true }), input("c"), input("u"), input("t")],
      map: {
        a: { source: "arg", value: "a" },
        c: { source: "const", value: "cố định" },
        u: { source: "user_id" },
        t: { source: "tenant_id" },
      },
      values: { a: "xin" },
    });
    expect(r).toEqual({
      ok: true,
      inputs: { a: "xin", c: "cố định", u: USER, t: TENANT },
      query: null,
    });
  });

  it("HUB-FR-12 · H2a-R16 · map selection/page_url/page_text lấy từ context [R16]", () => {
    const r = run({
      schema: [input("s"), input("p"), input("x")],
      map: { s: { source: "selection" }, p: { source: "page_url" }, x: { source: "page_text" } },
      ctx: { selection: "vùng chọn", page_url: "https://a.vn/x", page_text: "nội dung" },
    });
    expect(r).toEqual({
      ok: true,
      inputs: { s: "vùng chọn", p: "https://a.vn/x", x: "nội dung" },
      query: null,
    });
  });
});

describe("HUB-FR-12 · thiếu bắt buộc [R17, R18, R22, R25]", () => {
  it("HUB-FR-12 · input required rỗng nguồn arg → missing = tên tham số command [R17]", () => {
    const r = run({
      schema: DICH_INPUTS,
      map: DICH_MAP,
      args: DICH_ARGS,
      values: { lang: null, text: "xin" },
    });
    expect(r).toEqual({ ok: false, missing: ["lang"], invalid: [] });
  });

  it("HUB-FR-12 · input required nguồn selection rỗng → missing = tên input [R18]", () => {
    const r = run({
      schema: [input("source_text", "text", { required: true })],
      map: { source_text: { source: "selection" } },
    });
    expect(r).toEqual({ ok: false, missing: ["source_text"], invalid: [] });
  });

  it("HUB-FR-12 · input không bắt buộc rỗng → không vào missing [R22]", () => {
    const r = run({
      schema: [input("a", "text", { required: true }), input("opt")],
      map: { a: { source: "arg", value: "a" }, opt: { source: "arg", value: "opt" } },
      values: { a: "x", opt: null },
    });
    expect(r.ok).toBe(true);
  });

  it("HUB-FR-12 · map attachment bắt buộc (H2c) → missing có tên input [R25]", () => {
    const r = run({
      schema: [input("file", "file", { required: true })],
      map: { file: { source: "attachment" } },
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.missing).toContain("file");
  });
});

describe("HUB-FR-12 · kiểu number/boolean/select [R19–R21, R26]", () => {
  it("HUB-FR-12 · number = Number() hữu hạn [R19]", () => {
    for (const [raw, n] of [
      ["3.5", 3.5],
      ["1e3", 1000],
      ["-2", -2],
    ] as const) {
      expect(run({ ...NUM, values: { n: raw } })).toEqual({ ok: true, inputs: { n }, query: null });
    }
    for (const bad of ["abc", "Infinity", "NaN"]) {
      expect(run({ ...NUM, values: { n: bad } })).toEqual({
        ok: false,
        missing: [],
        invalid: ["n"],
      });
    }
  });

  it("HUB-FR-12 · boolean ∈ {true,false,1,0,yes,no} không phân biệt hoa [R20]", () => {
    for (const [raw, b] of [
      ["true", true],
      ["FALSE", false],
      ["1", true],
      ["0", false],
      ["yes", true],
      ["No", false],
    ] as const) {
      expect(run({ ...BOOL, values: { flag: raw } })).toEqual({
        ok: true,
        inputs: { flag: b },
        query: null,
      });
    }
    expect(run({ ...BOOL, values: { flag: "maybe" } })).toEqual({
      ok: false,
      missing: [],
      invalid: ["flag"],
    });
  });

  it("HUB-FR-12 · select ∉ options → invalid (tên tham số); ∈ → giữ [R21]", () => {
    const base = { schema: DICH_INPUTS, map: DICH_MAP, args: DICH_ARGS };
    expect(run({ ...base, values: { lang: "xx", text: "a" } })).toEqual({
      ok: false,
      missing: [],
      invalid: ["lang"],
    });
    expect(run({ ...base, values: { lang: "ja", text: "a" } })).toEqual({
      ok: true,
      inputs: { target_lang: "ja", source_text: "a", tone: "neutral" },
      query: null,
    });
  });

  it("HUB-FR-12 · vừa thiếu vừa sai kiểu → đủ hai danh sách, không trùng [R26]", () => {
    const r = run({
      schema: [input("lang", "text", { required: true }), input("n", "number", { required: true })],
      map: { lang: { source: "arg", value: "lang" }, n: { source: "arg", value: "n" } },
      values: { lang: null, n: "abc" },
    });
    expect(r).toEqual({ ok: false, missing: ["lang"], invalid: ["n"] });
  });
});

describe("HUB-FR-13 · query [R23, R24]", () => {
  it("HUB-FR-13 · input tên `query` → query = giá trị; không có → null [R23]", () => {
    const withQ = run({
      schema: [input("query", "text", { required: true })],
      map: { query: { source: "arg", value: "q" } },
      args: [arg("q", { rest: true })],
      values: { q: "hỏi gì đó" },
    });
    expect(withQ).toMatchObject({ ok: true, query: "hỏi gì đó" });
    const noQ = run({ schema: [input("a")], map: { a: { source: "const", value: "x" } } });
    expect(noQ).toMatchObject({ ok: true, query: null });
  });

  it("HUB-FR-13 · appNeedsQuery: workflow false; chat, agent true [R24]", () => {
    expect(appNeedsQuery("workflow")).toBe(false);
    expect(appNeedsQuery("chat")).toBe(true);
    expect(appNeedsQuery("agent")).toBe(true);
  });
});
