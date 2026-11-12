// CR-122 · ADR-0038 · FLOW2-FR-17 · luật thuần "app phải khai sự kiện" — dùng bởi `bun run check:app-events` (thay dần
// `check:app-slots`, gỡ ở R1). `error` ⇒ đỏ; `warn` ⇒ in ra, không đỏ.
import { PROCESS_KEY_RE } from "../chat/processes";
import {
  APP_FACT_TYPES,
  type AppEventDecl,
  type AppManifest,
  EVENT_FACTS_MAX,
  EVENT_LABEL_MAX,
  EVENT_OUTCOMES_MAX,
  FACT_KEY_RE,
  FLOW_EVENT_KEY_RE,
  OUTCOME_KEY_RE,
  SCHEDULE_DAYS_MAX,
  SCHEDULE_DAYS_MIN,
} from "./manifest";

export type AppEventIssue = {
  app: string;
  event?: string;
  rule: string;
  level: "error" | "warn";
};
export type AppEventCheckOpts = {
  /** Khoá flow có trong seed Thư viện (migration hub); vắng ⇒ không kiểm có/không trong seed. */
  seededFlowKeys?: ReadonlySet<string>;
  /** true ⇒ sự kiện `required` thiếu flow mặc định (không khai / không có trong seed) là `error`; mặc định `warn` tới khi
   *  M1 seed FlowDef có `trigger` (bẫy: bật `strict` ở M1). */
  strictDefaultFlow?: boolean;
};

const KINDS: ReadonlySet<string> = new Set(APP_FACT_TYPES);
const badText = (v: string, max: number): boolean => v.trim().length === 0 || v.length > max;
const dupOf = (keys: readonly string[]): boolean => new Set(keys).size !== keys.length;

/** CR-127 · E1 · `schedule.param`: khoá `days`, 1 ≤ min ≤ default ≤ max ≤ 365. */
function scheduleBad(e: AppEventDecl): boolean {
  const p = e.schedule?.param;
  if (!p) return false;
  return (
    p.key !== "days" ||
    !Number.isInteger(p.min) ||
    !Number.isInteger(p.max) ||
    !Number.isInteger(p.default) ||
    p.min < SCHEDULE_DAYS_MIN ||
    p.max > SCHEDULE_DAYS_MAX ||
    p.default < p.min ||
    p.default > p.max
  );
}

/** Luật lỗi của MỘT sự kiện theo thứ tự cố định (mã luật → vi phạm). */
function eventRules(e: AppEventDecl): [string, boolean][] {
  const fk = e.facts.map((f) => f.key);
  const ok = e.outcomes.map((o) => o.key);
  return [
    ["event_key_format", !FLOW_EVENT_KEY_RE.test(e.key)],
    ["label", badText(e.label, EVENT_LABEL_MAX)],
    ["facts_too_many", e.facts.length > EVENT_FACTS_MAX],
    ["fact_key_format", fk.some((k) => !FACT_KEY_RE.test(k))],
    ["fact_key_duplicate", dupOf(fk)],
    ["fact_type_unknown", e.facts.some((f) => !KINDS.has(f.type))],
    ["fact_enum_options", e.facts.some((f) => f.type === "enum" && !f.options?.length)],
    ["fact_label", e.facts.some((f) => badText(f.label, EVENT_LABEL_MAX))],
    ["outcomes_empty", e.outcomes.length === 0],
    ["outcomes_too_many", e.outcomes.length > EVENT_OUTCOMES_MAX],
    ["outcome_key_format", ok.some((k) => !OUTCOME_KEY_RE.test(k))],
    ["outcome_key_duplicate", dupOf(ok)],
    [
      "outcome_text",
      e.outcomes.some((o) => badText(o.label, EVENT_LABEL_MAX) || badText(o.effect, 200)),
    ],
    [
      "default_flow_key_format",
      e.defaultFlowKey !== undefined && !PROCESS_KEY_RE.test(e.defaultFlowKey),
    ],
    ["schedule_param", scheduleBad(e)],
    ["schedule_days_fact", e.schedule !== undefined && !fk.includes("days")],
  ];
}

/** Sự kiện `required` phải có flow mặc định trong seed Thư viện (lưới cuối FLOW2-FR-20). */
function defaultFlowRule(e: AppEventDecl, o: AppEventCheckOpts): string | null {
  if (!e.required) return null;
  if (!e.defaultFlowKey) return "required_no_default_flow";
  if (o.seededFlowKeys && !o.seededFlowKeys.has(e.defaultFlowKey)) return "default_flow_not_seeded";
  return null;
}

/** Mọi vi phạm của tập manifest (không `error` ⇒ hợp lệ). Khoá sự kiện trùng xét trên TOÀN tập (bộ điều phối khớp theo khoá). */
export function appEventIssues(
  manifests: readonly AppManifest[],
  opts: AppEventCheckOpts = {},
): AppEventIssue[] {
  const out: AppEventIssue[] = [];
  const seen = new Set<string>();
  for (const m of manifests) {
    if (m.events.length === 0) out.push({ app: m.key, rule: "no_events", level: "error" });
    for (const e of m.events) {
      out.push(...eventIssues(m.key, e, seen.has(e.key), opts));
      seen.add(e.key);
    }
  }
  return out;
}

function eventIssues(
  app: string,
  e: AppEventDecl,
  duplicate: boolean,
  opts: AppEventCheckOpts,
): AppEventIssue[] {
  const rules = eventRules(e).filter(([, bad]) => bad);
  if (duplicate) rules.push(["event_key_duplicate", true]);
  const out: AppEventIssue[] = rules.map(([rule]) => ({ app, event: e.key, rule, level: "error" }));
  const d = defaultFlowRule(e, opts);
  if (d) out.push({ app, event: e.key, rule: d, level: opts.strictDefaultFlow ? "error" : "warn" });
  return out;
}

export const formatEventIssue = (i: AppEventIssue): string =>
  `${i.level === "error" ? "LỖI" : "cảnh báo"} ${i.app}${i.event ? ` · ${i.event}` : ""}: ${i.rule}`;
