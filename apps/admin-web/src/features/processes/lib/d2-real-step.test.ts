// HUB-FR-146 · HUB-BR-12 · AC-H44 · D2-49 · TECH-DEBT #204 (hướng A): stage "Gọi tool" có tác dụng phụ ở giai đoạn KHÔNG bật được
// "Hành động thật" (bước 0, hoặc bước trước có giai đoạn không người kiểm) ⇒ câu lỗi riêng `sideEffectLocked` (path vẫn
// `stages.<i>.real_action`), thay vì bảo người dùng bật công tắc đang bị khoá. Bật được ⇒ giữ `TOOL_SIDE_EFFECT`.
// `realActionAllowed` (domain/tool-rules) = điều kiện mở công tắc. Nạp qua namespace ⇒ export vắng đỏ ở expect, không lỗi nạp file.
import { describe, expect, test } from "bun:test";
import type { ProcessToolItem } from "@ai/contracts/hub-admin";
import * as toolRules from "../domain/tool-rules";
import { d2LiveErrors, TOOL_ERR } from "./d2-validate";
import type { StageDraft } from "./draft-types";
import { emptyStage } from "./stage-convert";
import { setArg } from "./tool-form";

const LOCKED = "process.admin.editor.stage.tool.err.sideEffectLocked";
const SIDE = "process.admin.editor.stage.tool.err.TOOL_SIDE_EFFECT";
const CATALOG: ProcessToolItem[] = [
  {
    key: "ghi-so",
    name: "Ghi sổ",
    description: "Ghi sổ",
    side_effect: true,
    params: [{ name: "ma_kh", type: "text", required: true }],
  },
];
const st = (key: string, step: number, p: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  key,
  name: key,
  step,
  filename: `${key}.md`,
  template: "x",
  sections: ["Kết quả"],
  ...p,
});
const ghiSo = (key: string, step: number, p: Partial<StageDraft> = {}): StageDraft =>
  st(key, step, {
    executor: "tool",
    tool: setArg({ key: "ghi-so", args: {} }, "ma_kh", { from: "const", value: "KH1" }),
    ...p,
  });
const live = (stages: StageDraft[]) => d2LiveErrors(stages, [], CATALOG);

type Allowed = (stages: readonly { step: number; after: string }[], i: number) => boolean;
function realActionAllowed(): Allowed {
  const f = (toolRules as Record<string, unknown>).realActionAllowed;
  expect(typeof f).toBe("function");
  return f as Allowed;
}

describe("#204 · tool tác dụng phụ ở giai đoạn không bật được Hành động thật", () => {
  test("TOOL_ERR.sideEffectLocked là khoá câu riêng; sideEffect giữ khoá cũ", () => {
    expect((TOOL_ERR as Record<string, string>).sideEffectLocked).toBe(LOCKED);
    expect(TOOL_ERR.sideEffect).toBe(SIDE);
  });
  test("bước 0 (một mình) ⇒ stages.0.real_action = sideEffectLocked", () => {
    expect(live([ghiSo("t", 0)])["stages.0.real_action"]).toBe(LOCKED);
  });
  test("bước 1 sau giai đoạn auto ⇒ sideEffectLocked", () => {
    const e = live([st("p", 0, { after: "auto" }), ghiSo("t", 1)]);
    expect(e["stages.1.real_action"]).toBe(LOCKED);
  });
  test("bước 1 sau giai đoạn review, real:false ⇒ TOOL_SIDE_EFFECT (bật được); real:true ⇒ không lỗi", () => {
    const e = live([st("p", 0, { after: "review" }), ghiSo("t", 1)]);
    expect(e["stages.1.real_action"]).toBe(SIDE);
    const ok = live([st("p", 0, { after: "review" }), ghiSo("t", 1, { real: true })]);
    expect(ok["stages.1.real_action"]).toBeUndefined();
  });
});

describe("#204 · realActionAllowed (= điều kiện mở công tắc Hành động thật)", () => {
  test("bước 0 ⇒ false", () => {
    expect(realActionAllowed()([{ step: 0, after: "review" }], 0)).toBe(false);
  });
  test("bước trước có giai đoạn auto ⇒ false; mọi giai đoạn bước trước review ⇒ true", () => {
    const f = realActionAllowed();
    const mixed = [
      { step: 0, after: "review" },
      { step: 0, after: "auto" },
      { step: 1, after: "auto" },
    ];
    expect(f(mixed, 2)).toBe(false);
    const all = [
      { step: 0, after: "review" },
      { step: 0, after: "review" },
      { step: 1, after: "auto" },
    ];
    expect(f(all, 2)).toBe(true);
  });
});
