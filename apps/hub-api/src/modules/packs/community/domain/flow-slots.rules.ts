// CR-120 · cr120-community-flows · `SlotSpec` của 3 khe Community (đăng ký vào registry kit lúc mount). `slot_body` = khung bước cố
// định của khe (khớp seed hub 0092): chỉ cho đổi tên bước và (duyệt bài) `remind_every_h`/`escalate_after_h`; thêm/bớt/đổi loại bước
// ⇒ vi phạm. `compile` dựng `stages` hiển thị (tool khoá của khe), giống hệt seed.
import { AGENT_SCREEN, AGENT_TRIAGE, SLOT_JOIN, SLOT_MODERATION, SLOT_REPORT } from "./flow.rules";

/** Khớp `SlotIssue` / `SlotSpec` của kit (domain không import kit; `community.mount` gán vào registry, typecheck bắt lệch). */
export type SlotIssue = { path: string; rule: string };
export type SlotSpec = {
  key: string;
  label: string;
  packKey: string;
  optIn?: boolean;
  requiredInputs: readonly string[];
  systemTools: readonly string[];
  validate(body: unknown): SlotIssue[];
  compile(body: unknown): unknown[];
  groupKeys(body: unknown): string[];
};

type StepShape = {
  key: string;
  kind: "agent" | "review" | "form" | "set";
  tool: string;
  agent?: string;
};
type Body = { steps: { key: string; kind: string; name: string; [k: string]: unknown }[] };

const SHAPES: Record<string, { input: string; arg: string; steps: StepShape[] }> = {
  [SLOT_MODERATION]: {
    input: "post-id",
    arg: "post_id",
    steps: [
      { key: "screen", kind: "agent", tool: "community-screen", agent: AGENT_SCREEN },
      { key: "review", kind: "review", tool: "community-moderate" },
      { key: "publish", kind: "set", tool: "community-publish" },
    ],
  },
  [SLOT_JOIN]: {
    input: "request-id",
    arg: "request_id",
    steps: [
      { key: "apply", kind: "form", tool: "community-join-form" },
      { key: "review", kind: "review", tool: "community-join-review" },
      { key: "link", kind: "set", tool: "community-join-link" },
    ],
  },
  [SLOT_REPORT]: {
    input: "report-id",
    arg: "report_id",
    steps: [
      { key: "triage", kind: "agent", tool: "community-triage", agent: AGENT_TRIAGE },
      { key: "review", kind: "review", tool: "community-report-review" },
      { key: "action", kind: "set", tool: "community-report-action" },
    ],
  },
};

const isBody = (b: unknown): b is Body =>
  !!b &&
  typeof b === "object" &&
  Array.isArray((b as Body).steps) &&
  (b as Body).steps.every((s) => s && typeof s === "object" && typeof s.key === "string");

const hours = (v: unknown) =>
  v === undefined ||
  v === null ||
  (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 168);

export function validateSlotBody(slot: string, body: unknown): SlotIssue[] {
  const shape = SHAPES[slot];
  if (!shape) return [{ path: "", rule: "SLOT_UNKNOWN" }];
  if (!isBody(body)) return [{ path: "steps", rule: "SLOT_SHAPE" }];
  if (body.steps.length !== shape.steps.length)
    return [{ path: "steps", rule: "SLOT_STEPS_FIXED" }];
  const out: SlotIssue[] = [];
  body.steps.forEach((s, i) => {
    const want = shape.steps[i] as StepShape;
    if (s.key !== want.key || s.kind !== want.kind)
      out.push({ path: `steps.${i}`, rule: "SLOT_STEPS_FIXED" });
    if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 200)
      out.push({ path: `steps.${i}.name`, rule: "NAME_INVALID" });
    if (!hours(s.remind_every_h) || !hours(s.escalate_after_h))
      out.push({ path: `steps.${i}`, rule: "HOURS_INVALID" });
  });
  return out;
}

function stage(shape: (typeof SHAPES)[string], s: Body["steps"][number], i: number) {
  const want = shape.steps[i] as StepShape;
  const review = want.kind === "review";
  const last = i === shape.steps.length - 1;
  return {
    key: s.key,
    name: s.name,
    step: i,
    executor: {
      kind: "tool",
      tool_key: want.tool,
      args: { [shape.arg]: { from: "input", key: shape.input } },
    },
    instruction: "",
    output: { filename: `${s.key}.md`, template: "x", required_sections: ["x"], fields: [] },
    after: review
      ? {
          kind: "review",
          back_to_steps: [],
          remind_every_h: (s.remind_every_h as number | undefined) ?? null,
          branch: [],
          exclude_starter: true,
          group_id: null,
          group_key: "contracts-admin",
          escalate: null,
        }
      : { kind: "auto", branch: last ? [] : [] },
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 60,
    token_budget: null,
    slot: { ...s, ...(want.agent ? { agent_key: want.agent } : {}) },
  };
}

export function compileSlotBody(slot: string, body: unknown): unknown[] {
  const shape = SHAPES[slot];
  if (!shape || !isBody(body) || validateSlotBody(slot, body).length > 0)
    throw new Error(`slot_body không hợp lệ: ${slot}`);
  return body.steps.map((s, i) => stage(shape, s, i));
}

const LABELS: Record<string, string> = {
  [SLOT_MODERATION]: "Community · Duyệt bài",
  [SLOT_JOIN]: "Community · Đối tác xin tham gia",
  [SLOT_REPORT]: "Community · Báo cáo vi phạm",
};

export function communitySlotSpecs(): SlotSpec[] {
  return Object.entries(SHAPES).map(([key, shape]) => ({
    key,
    label: LABELS[key] ?? key,
    packKey: "community",
    optIn: true, // bật khi platform admin gán; không tự cấp mặc định
    requiredInputs: [shape.input],
    systemTools: shape.steps.map((s) => s.tool),
    validate: (b) => validateSlotBody(key, b),
    compile: (b) => compileSlotBody(key, b),
    // Người duyệt do MẶT Bảng tin quyết (ADR-0044: mọi user nội bộ của công ty, không Group riêng) — hub không giải Group của khe này;
    // `group_key` ở thân khe chỉ là nhãn dữ liệu cũ (lát 2 đổi/gỡ) ⇒ khai `groupKeys` ở đây sẽ chặn mọi lần gán (B2 thiếu Group).
    groupKeys: () => [],
  }));
}
