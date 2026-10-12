// HUB-FR-104 · HUB-FR-136 · P-b2 (test-plan §1): builder stage/def THUẦN (không DB, không app) — dùng chung rules/ và int.
// Shape theo `ProcessStageDefSchema` (plan §1.2): `step?` + `after.back_to_steps` (review). Output Markdown cố định §1.
// biome-ignore lint/suspicious/noExplicitAny: json fixture theo contract chưa có
export type Json = any;

const x = (n: number) => `b2b20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** uuid tất định dải `b2b2…` (P-b2). */
export const pb2Id = x;

export const AG_READ_FALLBACK = x(990);
export const SECTIONS = ["Bảng ý", "Tổng tiền"];
export const TEMPLATE = "## Bảng ý\n\n## Tổng tiền\n";

/** `## Bảng ý` + `## Tổng tiền` + `## Bàn giao` (HANDOFF-OK); `BODY-ONLY-7f3a` = dấu kiểm KHÔNG nhúng nguyên file. */
export const MD_HO =
  "## Bảng ý\nBODY-ONLY-7f3a nội dung dài.\n\n## Tổng tiền\n12 000 000\n\n## Bàn giao\nHANDOFF-OK: đã đọc HD-12, tổng 12 000 000.";
/** `MD_HO` bỏ `## Bàn giao`. */
export const MD_NOHO = "## Bảng ý\nBODY-ONLY-7f3a nội dung dài.\n\n## Tổng tiền\n12 000 000";
/** Bàn giao tuỳ ý (mặc định 900 ký tự `H` ⇒ bị cắt). */
export const mdWithHandoff = (handoff: string, body = "BODY-ONLY-7f3a nội dung dài."): string =>
  `## Bảng ý\n${body}\n\n## Tổng tiền\n12 000 000\n\n## Bàn giao\n${handoff}`;
export const MD_LONGHO = mdWithHandoff("H".repeat(900));

export type StageOpt = {
  key: string;
  name?: string;
  step?: number;
  /** agent id (mặc định `agent`), hoặc `team` id. */
  agent?: string;
  team?: string;
  /** group duyệt; `undefined` ⇒ auto; `null` ⇒ review không Group. */
  review?: string | null;
  back?: number[];
  real?: boolean;
  sections?: string[];
  template?: string;
  answerer?: Json;
};

/** Stage def (contract) — `review` có `back_to_steps` khi truyền `back`. */
export function st(o: StageOpt, agentDefault: string = AG_READ_FALLBACK): Json {
  const sections = o.sections ?? SECTIONS;
  const s: Json = {
    key: o.key,
    name: o.name ?? o.key,
    executor: o.team
      ? { kind: "team", team_id: o.team }
      : { kind: "agent", agent_id: o.agent ?? agentDefault },
    instruction: `Thực hiện ${o.name ?? o.key}.`,
    output: {
      filename: `${o.key}.md`,
      template: o.template ?? sections.map((x) => `## ${x}\n`).join("\n"),
      required_sections: sections,
      fields: [],
    },
    after:
      o.review === undefined
        ? { kind: "auto" }
        : o.back
          ? { kind: "review", group_id: o.review, back_to_steps: o.back }
          : { kind: "review", group_id: o.review },
    real_action: o.real ?? false,
    answerer: o.answerer ?? { kind: "starter" },
    timeout_s: 600,
    token_budget: null,
    sources: [],
    must_know: [],
  };
  if (o.step !== undefined) s.step = o.step;
  return s;
}

/** Stage chỉ có `step` (+ tuỳ chọn) cho luật thuần `processDefStageIssues` — key `s<i>`. */
export function stepsOnly(
  steps: (number | undefined)[],
  extra: (i: number) => Partial<StageOpt> = () => ({}),
): Json[] {
  return steps.map((step, i) => st({ key: `s${i}`, step, review: null, ...extra(i) }));
}

/** `ProcessDefInput` (POST /process-defs). */
export function defBody(key: string, stages: Json[], o: Json = {}): Json {
  return {
    key,
    name: o.name ?? `Quy trình ${key}`,
    description: o.description ?? "Quy trình bộ test P-b2.",
    input_hint: "Số hoá đơn",
    run_group_ids: [],
    stages,
    token_budget: null,
    enabled: true,
    sources: [],
    inputs: [],
  };
}
