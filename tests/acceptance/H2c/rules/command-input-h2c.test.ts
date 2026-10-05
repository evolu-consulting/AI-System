// HUB-FR-12 · ADM-FR-21 · H2c-R20 · K10 · buildInputs + nguồn `attachment` (test-plan H2c §1, cases §1.5 R31–R34;
// chữ ký plan-rules §5).
import { describe, expect, it } from "bun:test";
import type { CommandArg, InputMap, WorkflowInput } from "@ai/contracts";
import {
  type BuildInputsInput,
  buildInputs,
} from "../../../../apps/hub-api/src/modules/commands/command-input.rules";
import { arg, DICH_ARGS, DICH_INPUTS, DICH_MAP, input } from "../../H2a/rules/_catalog";
import { uid } from "./_rules";

const X = uid(501);

type Case = {
  schema: readonly WorkflowInput[];
  map: InputMap;
  args?: readonly CommandArg[];
  values?: Record<string, string | null>;
  ctx?: BuildInputsInput["ctx"];
  attachment?: { id: string } | null;
};

function run(c: Case, withAttachmentKey = "attachment" in c) {
  const i: BuildInputsInput = {
    inputMap: c.map,
    inputSchema: c.schema,
    args: c.args ?? Object.keys(c.values ?? {}).map((n) => arg(n)),
    values: c.values ?? {},
    ctx: c.ctx ?? {},
    userId: uid(1),
    tenantId: uid(2),
    ...(withAttachmentKey ? { attachment: c.attachment ?? null } : {}),
  };
  return buildInputs(i);
}

const FILE_REQ = input("file", "file", { required: true, description: "Hoá đơn PDF" });
const NOTE = input("note");
const HOADON_MAP: InputMap = {
  file: { source: "attachment" },
  note: { source: "arg", value: "note" },
};

describe("HUB-FR-12 · hồi quy H2a khi không có file [R31]", () => {
  it("HUB-FR-12 · R31 · vắng attachment / attachment null → y hệt H2a, không khoá files [H2c-R20 · K10]", () => {
    const cases: Case[] = [
      { schema: DICH_INPUTS, map: DICH_MAP, args: DICH_ARGS, values: { lang: "en", text: "xin" } },
      { schema: DICH_INPUTS, map: DICH_MAP, args: DICH_ARGS, values: { lang: null, text: "xin" } },
      { schema: DICH_INPUTS, map: DICH_MAP, args: DICH_ARGS, values: { lang: "xx", text: "xin" } },
      {
        schema: [input("query", "text", { required: true })],
        map: { query: { source: "selection" } },
        ctx: { selection: "hỏi" },
      },
    ];
    for (const c of cases) {
      const h2a = run(c, false);
      const nul = run({ ...c, attachment: null });
      expect(nul).toEqual(h2a);
      expect("files" in nul).toBe(false);
    }
  });
});

describe("HUB-FR-12 · ADM-FR-21 · input file ← attachment [R32]", () => {
  it("HUB-FR-12 · R32 · bắt buộc + có file → files[{input, attachmentId}], inputs không có file [H2c-R20 · HUB-H2c-AC-09]", () => {
    const r = run({
      schema: [FILE_REQ, NOTE],
      map: HOADON_MAP,
      values: { note: "tháng 9" },
      attachment: { id: X },
    });
    expect(r).toEqual({
      ok: true,
      inputs: { note: "tháng 9" },
      query: null,
      files: [{ input: "file", attachmentId: X }],
    });
  });

  it("HUB-FR-12 · R32 · bắt buộc + vắng file → missing [file]; tuỳ chọn + vắng → ok, không files [H2c-R20]", () => {
    expect(run({ schema: [FILE_REQ, NOTE], map: HOADON_MAP, values: { note: null } })).toEqual({
      ok: false,
      missing: ["file"],
      invalid: [],
    });
    const opt = run({
      schema: [input("file", "file"), NOTE],
      map: HOADON_MAP,
      values: { note: "x" },
      attachment: null,
    });
    expect(opt).toEqual({ ok: true, inputs: { note: "x" }, query: null });
    expect("files" in opt).toBe(false);
  });

  it("ADM-FR-21 · R32 · hai input file cùng map attachment → cả hai nhận cùng file (T9) [H2c-R20]", () => {
    const r = run({
      schema: [FILE_REQ, input("ban_sao", "file")],
      map: { file: { source: "attachment" }, ban_sao: { source: "attachment" } },
      attachment: { id: X },
    });
    expect(r).toEqual({
      ok: true,
      inputs: {},
      query: null,
      files: [
        { input: "file", attachmentId: X },
        { input: "ban_sao", attachmentId: X },
      ],
    });
  });
});

describe("HUB-FR-12 · ADM-FR-21 · lệch map → invalid [R33, R34]", () => {
  it("ADM-FR-21 · R33 · file ← arg → invalid nhãn = tên tham số, bất kể có giá trị (P13, K10) [H2c-R20 · K10]", () => {
    for (const v of ["a.pdf", null]) {
      const r = run({
        schema: [input("file", "file", { required: true })],
        map: { file: { source: "arg", value: "tep" } },
        values: { tep: v },
        attachment: { id: X },
      });
      expect(r).toEqual({ ok: false, missing: [], invalid: ["tep"] });
    }
  });

  it("ADM-FR-21 · R33 · file ← selection → invalid; text ← attachment → invalid có/không file [H2c-R20 · K10]", () => {
    const sel = run({
      schema: [input("file", "file")],
      map: { file: { source: "selection" } },
      ctx: { selection: "vùng chọn" },
    });
    expect(sel).toEqual({ ok: false, missing: [], invalid: ["file"] });
    for (const attachment of [{ id: X }, null]) {
      for (const required of [true, false]) {
        const r = run({
          schema: [input("q", "text", { required })],
          map: { q: { source: "attachment" } },
          attachment,
        });
        expect(r).toEqual({ ok: false, missing: [], invalid: ["q"] });
      }
    }
  });

  it("HUB-FR-12 · R34 · thứ tự missing/invalid như H2a khi lẫn lỗi file + lỗi arg [H2c-R20]", () => {
    const schema = [
      input("t", "text", { required: true }),
      input("target_lang", "select", { required: true, options: ["en", "vi"] }),
      input("doc", "file", { required: true }),
    ];
    const map: InputMap = {
      t: { source: "arg", value: "t" },
      target_lang: { source: "arg", value: "lang" },
      doc: { source: "arg", value: "tep" },
    };
    const values = { t: null, lang: "xx", tep: "a.pdf" };
    const a = run({ schema, map, values, args: [arg("t"), arg("lang"), arg("tep")] });
    expect(a).toEqual({ ok: false, missing: ["t"], invalid: ["lang", "tep"] });
    const b = run({ schema, map, values, args: [arg("tep"), arg("lang"), arg("t")] });
    expect(b).toEqual({ ok: false, missing: ["t"], invalid: ["tep", "lang"] });
  });

  it("HUB-FR-12 · R34 · file không map + bắt buộc → missing như H2a [H2c-R20]", () => {
    expect(run({ schema: [FILE_REQ], map: {}, attachment: { id: X } })).toEqual({
      ok: false,
      missing: ["file"],
      invalid: [],
    });
  });
});
