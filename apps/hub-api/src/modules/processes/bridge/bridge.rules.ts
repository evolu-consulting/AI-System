// CR-122 · N2 · FLOW2-FR-26 · luật THUẦN của "Gợi ý cầu nối": dựng đầu vào cho AI (CHỈ tên/kiểu trường — không dữ liệu bản ghi), đọc + kiểm
// câu trả lời của AI bằng zod, dựng stage `set` đầy đủ, rồi kiểm lại bằng `flowEdgeIssues` sau khi chèn. Không I/O.

import type { AppEventDecl } from "@ai/contracts/app-manifest";
import {
  BRIDGE_TEXT_MAX,
  type BridgeSuggestResponse,
  type EdgePaletteNode,
  FIELD_KEY_RE,
  type FlowEdgeIssue,
  flowEdgeIssues,
  insertBridgeStage,
  type ProcessDefInput,
  ProcessStageDefSchema,
  resolveSteps,
  SET_AS,
  SET_VALUES_MAX,
  SetFromSchema,
  STAGE_TIMEOUT_S,
} from "@ai/contracts/hub-admin";
import { z } from "zod";
import { inputFieldType, type SetFieldType, setDefIssues } from "../domain/set/set.rules";

type Stage = ProcessDefInput["stages"][number];
const Text = z.string().trim().min(1).max(BRIDGE_TEXT_MAX);

/** Câu trả lời của agent `flow-bridge`: JSON duy nhất. */
export const BridgeAiReplySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    values: z
      .array(
        z.strictObject({
          key: z.string().regex(FIELD_KEY_RE),
          type: z.enum(["number", "string", "date"]),
          from: SetFromSchema,
          as: z.enum(SET_AS).optional(),
        }),
      )
      .min(1)
      .max(SET_VALUES_MAX),
    explain_vi: Text,
    explain_en: Text,
  }),
  z.strictObject({ ok: z.literal(false), reason_vi: Text, reason_en: Text }),
]);
export type BridgeAiReply = z.infer<typeof BridgeAiReplySchema>;

/** Lấy đối tượng JSON đầu tiên trong văn bản trả lời (agent có thể bọc ```json); sai dạng ⇒ null. */
export function parseBridgeReply(text: string): BridgeAiReply | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  const r = BridgeAiReplySchema.safeParse(raw);
  return r.success ? r.data : null;
}

const no = (vi: string, en: string): BridgeSuggestResponse => ({
  ok: false,
  reason_vi: vi,
  reason_en: en,
});
export const BRIDGE_NO = {
  matched: () =>
    no(
      "Hai bước này đã khớp trường, không cần cầu nối.",
      "These two steps already match, no bridge is needed.",
    ),
  unavailable: () =>
    no(
      "Trợ lý AI chưa sẵn sàng. Hãy thêm bước Ghi giá trị bằng tay hoặc thử lại sau.",
      "The AI assistant is not available. Add a Set value step by hand or try again later.",
    ),
  capped: () =>
    no(
      "Đã hết hạn mức AI hôm nay. Hãy thêm bước Ghi giá trị bằng tay hoặc thử lại sau.",
      "The AI quota for today is used up. Add a Set value step by hand or try again later.",
    ),
  failed: () =>
    no(
      "AI chưa trả lời được. Hãy thử lại hoặc thêm bước Ghi giá trị bằng tay.",
      "The AI could not answer. Try again or add a Set value step by hand.",
    ),
  invalid: () =>
    no(
      "AI đề xuất không dùng được cho hai bước này. Hãy thêm bước Ghi giá trị bằng tay.",
      "The AI proposal does not fit these two steps. Add a Set value step by hand.",
    ),
};

type Io = { key: string; type: string; required?: boolean };

/**
 * Đầu vào cho AI — CHỈ tên/kiểu trường: đầu ra của bước trước, đầu vào của bước sau, chỗ lệch, và đầu vào của quy trình (`set` chỉ đọc
 * được đầu vào của lượt chạy hoặc hằng số). Không có dữ liệu bản ghi, không có tên/nội dung do người dùng đặt.
 */
export function bridgePromptOf(c: {
  fromNode: string | null;
  toNode: string | null;
  fromOutputs: readonly Io[];
  toInputs: readonly Io[];
  issue: FlowEdgeIssue;
  runInputs: readonly { key: string; type: SetFieldType }[];
  /** CR-122 E4 · bước của stage trước (nguồn `{kind:"field", step, key}`) + dữ kiện sự kiện (nguồn `{kind:"fact", key}`). */
  fromStep?: number;
  facts?: readonly { key: string; type: string }[];
}): string {
  const io = (x: Io) => ({ key: x.key, type: x.type, ...(x.required ? { required: true } : {}) });
  return JSON.stringify({
    from: { node: c.fromNode, step: c.fromStep ?? null, outputs: c.fromOutputs.map(io) },
    facts: (c.facts ?? []).map((f) => ({ key: f.key, type: f.type })),
    to: { node: c.toNode, inputs: c.toInputs.map(io) },
    mismatch: { missing: c.issue.missing, type: c.issue.typeMismatch },
    run_inputs: c.runInputs,
  });
}

/**
 * CR-122 E4b · dữ kiện (CHỈ khoá + kiểu) của sự kiện mở flow: `def.app` → manifest → `events[trigger.event].facts`. Không app / không
 * trigger / sự kiện lạ ⇒ rỗng (AI không dùng được nguồn `fact`). Không đọc giá trị bản ghi.
 */
export function eventFactsOf(
  def: { app?: string | null; trigger?: { event: string } | null },
  manifestOf: (app: string) => { events: readonly AppEventDecl[] } | undefined,
): { key: string; type: string }[] {
  const ev =
    def.app && def.trigger
      ? manifestOf(def.app)?.events.find((e) => e.key === def.trigger?.event)
      : undefined;
  return (ev?.facts ?? []).map((f) => ({ key: f.key, type: f.type }));
}

/** Đầu vào của quy trình mà `set` đọc được (kiểu field tương ứng); loại file/nguồn. */
export function runInputsOf(
  inputs: readonly { key: string; type: string }[],
): { key: string; type: SetFieldType }[] {
  return inputs.flatMap((i) => {
    const t = inputFieldType(i.type);
    return t ? [{ key: i.key, type: t }] : [];
  });
}

/** Khoá stage cầu nối chưa dùng trong def (`bridge`, `bridge-2`, …). */
export function freeBridgeKey(stages: readonly { key: string }[]): string {
  const used = new Set(stages.map((s) => s.key));
  let k = "bridge";
  for (let n = 2; used.has(k); n++) k = `bridge-${n}`;
  return k;
}

/** Stage `set` đầy đủ từ các dòng gán AI đề xuất (hình theo `ProcessStageDefSchema`; `step` do `insertBridgeStage` đặt). */
export function bridgeStageOf(key: string, values: Extract<BridgeAiReply, { ok: true }>["values"]) {
  const stage = {
    key,
    name: "Ghi giá trị cầu nối",
    step: 0,
    executor: {
      kind: "set" as const,
      values: values.map((v) => ({ key: v.key, from: v.from, ...(v.as ? { as: v.as } : {}) })),
    },
    instruction: "",
    output: {
      filename: `${key}.md`,
      template: "x",
      required_sections: ["x"],
      // Nguồn field/fact có thể trống/sai dạng lúc chạy (ghi null) ⇒ không bắt buộc, tránh vỡ mẫu output.
      fields: values.map((v) => ({ key: v.key, type: v.type, required: !("kind" in v.from) })),
    },
    after: { kind: "auto" as const, branch: [] },
    real_action: false,
    answerer: { kind: "starter" as const },
    timeout_s: STAGE_TIMEOUT_S.default,
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
  const r = ProcessStageDefSchema.safeParse(stage);
  return r.success ? r.data : null;
}

/**
 * Kiểm đề xuất: stage hợp lệ (luật `set`: khoá khai trong output, nguồn là đầu vào quy trình cùng kiểu / hằng đúng kiểu), chèn được vào
 * cạnh, và SAU KHI chèn không cạnh nào chạm cầu nối còn lệch (`flowEdgeIssues`). Đạt ⇒ phản hồi `ok: true`, không ⇒ `ok: false`.
 */
export function verifyBridge(
  r: Extract<BridgeAiReply, { ok: true }>,
  c: {
    def: ProcessDefInput;
    from: string;
    to: string;
    palette: readonly EdgePaletteNode[];
    /** CR-122 E4 · dữ kiện của sự kiện mở flow (`AppEventDecl.facts`); vắng ⇒ AI không được dùng nguồn `fact`. */
    facts?: readonly { key: string; type: string }[];
  },
): BridgeSuggestResponse {
  const key = freeBridgeKey(c.def.stages);
  const stage = bridgeStageOf(key, r.values);
  if (!stage) return BRIDGE_NO.invalid();
  const ins = insertBridgeStage(c.def.stages, c.from, c.to, stage as unknown as Stage);
  if (!ins) return BRIDGE_NO.invalid();
  // CR-122 E4 · kiểm luật `set` trên def SAU khi chèn (nguồn field phải là bước trước có khoá đó); dữ kiện phải thuộc sự kiện của flow.
  const at = ins.stages.findIndex((s) => s.key === key);
  const own = setDefIssues(
    ins.stages.map((s) => ({ executor: s.executor, fields: s.output.fields })),
    c.def.inputs,
    { steps: resolveSteps(ins.stages) },
  ).filter((x) => x.path.startsWith(`stages.${at}.`));
  if (own.length > 0) return BRIDGE_NO.invalid();
  const facts = new Set((c.facts ?? []).map((f) => f.key));
  if (r.values.some((v) => "kind" in v.from && v.from.kind === "fact" && !facts.has(v.from.key)))
    return BRIDGE_NO.invalid();
  const left = flowEdgeIssues({ stages: ins.stages }, c.palette).filter(
    (x) => x.from === key || x.to === key,
  );
  if (left.length > 0) return BRIDGE_NO.invalid();
  return {
    ok: true,
    stage: { ...stage, step: ins.step },
    explain_vi: r.explain_vi,
    explain_en: r.explain_en,
  };
}
