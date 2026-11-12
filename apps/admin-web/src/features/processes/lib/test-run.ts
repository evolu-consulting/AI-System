// CR-127 · U3 · BR-17 · M3 «Chạy thử»: ánh xạ THUẦN giữa form (HĐ thử) ⇄ `POST /tenants/:tid/flow-preview` ⇄ hàng hiển thị.
// Không gọi mạng. Luật đi đường nằm ở Hub (một nguồn); đây chỉ dựng yêu cầu và đọc kết quả.
import type { AppEventDecl, AppFactDecl } from "@ai/contracts/app-manifest";
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import { parseSampleValue } from "./library-view";

export type FactValue = string | number | boolean | string[] | null;
export type DecisionResult = "approve" | "return" | "reject";
export type Decision = { step_key: string; result: DecisionResult; actor_user_id?: string | null };

/** Người sẽ nhận việc ở bước Duyệt (Hub trả sẵn, tối đa vài người). */
export type Holder = { user_id: string; name: string; via: string; on_behalf_of?: string | null };
export type ReviewView = {
  need: "one" | "all";
  group_name: string | null;
  who: Holder[];
  who_total: number;
  evidence: "opinion" | "opinion_plus";
  due_h: number | null;
  voters_n: number | null;
};
export type Outcome = { key: string; label: string; effect: string };
export type PathStep = {
  step_key: string;
  name: string;
  kind: "step" | "review" | "if" | "end";
  status: "done" | "waiting" | "skipped";
  reason: string | null;
  branch?: "then" | "else";
  decision?: DecisionResult;
  actor?: { user_id: string; name: string } | null;
  can_act?: boolean | null;
  review?: ReviewView;
  missing?: string[];
  outcome?: Outcome | null;
};
export type Warning = { code: string; step_key: string | null; message: string };
export type PreviewResponse = {
  event: string | null;
  path: PathStep[];
  status: "finished" | "waiting" | "stopped";
  waiting_step: string | null;
  outcome: Outcome | null;
  skipped: { step_key: string; name: string }[];
  warnings: Warning[];
};
export type ScenarioKey = "approve_then" | "approve_else" | "reject" | "return";
export type ScenarioResponse = {
  event: string | null;
  scenarios: {
    key: ScenarioKey;
    label: string;
    facts: Record<string, FactValue>;
    decisions: Decision[];
    result: PreviewResponse;
  }[];
};

// ── Form HĐ thử: ô nhập theo dữ kiện của sự kiện bắt đầu ─────────────────────────────────────────────────────────────

export type FactField = {
  key: string;
  label: string;
  kind: "number" | "text" | "boolean" | "enum";
  options: { value: string; label: string }[];
};
const KIND: Record<AppFactDecl["type"], FactField["kind"]> = {
  number: "number",
  string: "text",
  enum: "enum",
  department: "text",
  boolean: "boolean",
  date: "text",
};

/** Ô nhập của HĐ thử = dữ kiện khai báo ở sự kiện (nhãn nghiệp vụ lấy từ chính sự kiện). Không có sự kiện ⇒ chưa có ô. */
export const factFieldsOf = (ev: Pick<AppEventDecl, "facts"> | undefined): FactField[] =>
  (ev?.facts ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    kind: KIND[f.type] ?? "text",
    options: (f.options ?? []).map((o) => ({ value: o.value, label: o.label })),
  }));

type Parsed = { value: FactValue | undefined; bad: boolean };
function parseFact(f: FactField, v: string): Parsed {
  if (f.kind === "boolean") return { value: v === "true", bad: false };
  if (f.kind !== "number") return { value: v, bad: false };
  const n = parseSampleValue(v);
  return n === "invalid" ? { value: undefined, bad: true } : { value: n ?? undefined, bad: false };
}

/** Chữ người nhập ⇒ dữ kiện: số "650.000.000" ⇒ 650000000; trống ⇒ bỏ (Hub coi là "chưa có dữ liệu"); số sai ⇒ liệt kê khoá lỗi. */
export function buildFacts(fields: readonly FactField[], raw: Readonly<Record<string, string>>) {
  const facts: Record<string, FactValue> = {};
  const invalid: string[] = [];
  for (const f of fields) {
    const v = (raw[f.key] ?? "").trim();
    if (v === "") continue;
    const p = parseFact(f, v);
    if (p.bad) invalid.push(f.key);
    else if (p.value !== undefined) facts[f.key] = p.value;
  }
  return { facts, invalid };
}

export type RunSource = {
  /** Bản nháp đang mở (chưa lưu cũng chạy được); `event` null ⇒ quy trình chưa chọn khi nào bắt đầu. */
  draft: { event: string | null; stages: ProcessStageDef[] };
};
export type RunRequest = {
  draft: { event?: string | null; stages: ProcessStageDef[] };
  facts: Record<string, FactValue>;
  starter_user_id?: string | null;
  decisions?: Decision[];
};
export function buildRequest(
  src: RunSource,
  facts: Record<string, FactValue>,
  starterId: string,
  decisions: readonly Decision[] = [],
): RunRequest {
  return {
    draft: { event: src.draft.event, stages: src.draft.stages },
    facts,
    starter_user_id: starterId === "" ? null : starterId,
    decisions: [...decisions],
  };
}
/** Yêu cầu "Thử nhanh 4 trường hợp": Hub tự dựng dữ kiện + quyết định từ ngưỡng của node Nếu ⇒ không gửi `decisions`. */
export const toScenarioRequest = (r: RunRequest): Omit<RunRequest, "decisions"> => ({
  draft: r.draft,
  facts: r.facts,
  starter_user_id: r.starter_user_id ?? null,
});

// ── Đóng vai: chuỗi quyết định ───────────────────────────────────────────────────────────────────────────────────────

/** Thêm quyết định cho bước đang chờ; quyết định cũ của bước đó (nếu có) bị thay — mỗi bước một quyết định. */
export const decide = (
  prev: readonly Decision[],
  stepKey: string,
  result: DecisionResult,
  actorId: string | null,
): Decision[] => [
  ...prev.filter((d) => d.step_key !== stepKey),
  { step_key: stepKey, result, actor_user_id: actorId },
];

// ── Hàng hiển thị ────────────────────────────────────────────────────────────────────────────────────────────────────

export type RowState = "done" | "waiting" | "end";
export type Row = {
  key: string;
  stepKey: string;
  n: number;
  state: RowState;
  title: string;
  /** Câu nói rõ "vì sao đi đường này" (nhánh, ai đóng vai, kết quả). */
  note: string;
  /** Chỉ hàng đang chờ: người sẽ nhận việc lúc chạy thật + cần nộp gì + hạn. */
  holders: string | null;
  holdersRule: string | null;
  needs: string | null;
  holderOptions: { value: string; label: string }[];
  /** Người đóng vai bị chặn (không có quyền) ⇒ câu lý do. */
  blocked: string | null;
};

const VERB: Record<DecisionResult, string> = {
  approve: "Duyệt",
  return: "Trả lại",
  reject: "Từ chối",
};
const branchText = (b: "then" | "else"): string => (b === "else" ? "Sai" : "Đúng");

function ruleOf(r: ReviewView): string {
  const g = r.group_name ? `${r.group_name}, ` : "";
  const due = r.due_h ? `. Hạn ${r.due_h} giờ` : "";
  const rule =
    r.need === "all" ? `cần cả ${r.voters_n ?? r.who_total} người duyệt` : "1 người quyết là đủ";
  return g + rule + due;
}
const needsOf = (r: ReviewView): string | null =>
  r.evidence === "opinion_plus" ? "ý kiến + (chữ ký điện tử hoặc tệp đính kèm)" : null;

function noteOf(s: PathStep): string {
  const parts: string[] = [];
  if (s.kind === "if" && s.branch)
    parts.push(`${s.reason ?? "Điều kiện"} ⇒ ${branchText(s.branch)}`);
  else if (s.reason) parts.push(s.reason);
  if (s.decision) {
    const who = s.actor ? `bạn đóng vai ${s.actor.name} · ` : "";
    parts.push(`${who}${VERB[s.decision]}`);
  }
  if (s.missing?.length) parts.push(`chưa có dữ liệu: ${s.missing.join(", ")}`);
  if (s.kind === "end" && s.outcome) parts.push(s.outcome.label);
  return parts.join(" · ");
}

function holdersOf(rv: ReviewView | undefined): string | null {
  if (!rv || rv.who.length === 0) return null;
  const names = rv.who.map((h) => (h.on_behalf_of ? `${h.name} (thay)` : h.name)).join(", ");
  return rv.who_total > rv.who.length
    ? `${names} và ${rv.who_total - rv.who.length} người khác`
    : names;
}

const WAIT_ACTOR_OFF = "Người này không có quyền quyết ở bước này.";
const stateOf = (s: PathStep): RowState =>
  s.kind === "end" ? "end" : s.status === "waiting" ? "waiting" : "done";

function rowOf(s: PathStep, i: number): Row {
  const waiting = s.status === "waiting";
  const rv = waiting ? s.review : undefined;
  return {
    key: `${s.step_key}:${i}`,
    stepKey: s.step_key,
    n: i + 1,
    state: stateOf(s),
    title: s.name,
    note: waiting ? "đang chờ" : noteOf(s),
    holders: holdersOf(rv),
    holdersRule: rv ? ruleOf(rv) : null,
    needs: rv ? needsOf(rv) : null,
    holderOptions: rv ? rv.who.map((h) => ({ value: h.user_id, label: h.name })) : [],
    blocked: s.can_act === false ? WAIT_ACTOR_OFF : null,
  };
}

/** Đường đi Hub trả ⇒ danh sách hàng theo thứ tự; bước Duyệt đang chờ có người nhận + hạn. */
export const rowsOf = (res: Pick<PreviewResponse, "path">): Row[] =>
  res.path.filter((s) => s.status !== "skipped").map(rowOf);

export type Summary = { tone: "ok" | "wait" | "stop"; text: string };
/** Dòng kết luận cuối đường đi. */
export function summaryOf(res: Pick<PreviewResponse, "status" | "outcome">): Summary {
  if (res.status === "waiting")
    return {
      tone: "wait",
      text: "Đang chờ người duyệt. Bấm Duyệt thử, Trả lại thử hoặc Từ chối thử.",
    };
  if (res.status === "stopped")
    return {
      tone: "stop",
      text: "Dừng ở đây: quy trình chưa nói bước tiếp theo sau khi từ chối hoặc trả lại.",
    };
  const o = res.outcome;
  return { tone: "ok", text: o ? `Kết thúc: ${o.label}. ${o.effect}` : "Kết thúc quy trình." };
}

export type WarnRow = { key: string; ok: boolean; text: string };
/** "Kiểm tra trước khi áp dụng": mỗi cảnh báo một dòng; không cảnh báo ⇒ một dòng xanh. */
export function warningRows(ws: readonly Warning[]): WarnRow[] {
  if (ws.length === 0)
    return [{ key: "ok", ok: true, text: "Không thấy vấn đề với hợp đồng thử này" }];
  return ws.map((w, i) => ({
    key: `${w.code}:${w.step_key ?? ""}:${i}`,
    ok: false,
    text: w.message,
  }));
}

export type ScenarioRow = {
  key: ScenarioKey;
  label: string;
  verdict: string;
  steps: number;
  tone: Summary["tone"];
};
/** "Thử nhanh 4 trường hợp": nhãn + kết quả cuối + số bước đi qua. */
export function scenarioRowsOf(res: ScenarioResponse): ScenarioRow[] {
  return res.scenarios.map((s) => ({
    key: s.key,
    label: s.label,
    verdict: s.result.outcome?.label ?? (s.result.status === "waiting" ? "Đang chờ" : "Dừng"),
    steps: s.result.path.filter((p) => p.status !== "skipped").length,
    tone: summaryOf(s.result).tone,
  }));
}
