// CR-184 · đồ thị ĐẦY ĐỦ của flow đang chạy cho Sổ Hợp Tác vẽ CÙNG sơ đồ với trang quản trị (chỉ xem): MỌI stage (kể cả Nếu, Gửi đối tác,
// Kết thúc, chờ) theo thứ tự mảng, kèm trường để dựng cạnh (`step`, `yes`/`no`, `branch`, `back_to`, `next_step`). Thuần (lớp 1).
// Chỉ ĐỌC dữ liệu lưu; không đổi `stepsOfStages` (danh sách bước cũ giữ nguyên).

export type GraphKind =
  | "review"
  | "esign"
  | "notify"
  | "if"
  | "partner_send"
  | "wait"
  | "end"
  | "other";
export type GraphStage = {
  key: string;
  step: number;
  name: string;
  kind: GraphKind;
  /** Mã nhóm duyệt (id Group hoặc mã Thư viện) — use case đổi thành TÊN phòng. */
  groupId: string | null;
  groupKey: string | null;
  /** «Ký qua» của bước Ký (khoá nhà cung cấp / `upload` / `ondoc`); bước khác ⇒ null. */
  provider: string | null;
  after: "review" | "auto";
  backTo: number[];
  /** Đích (0-based) của từng luật rẽ nhánh `after.branch`; null = chưa chọn. */
  branch: (number | null)[];
  /** Node Nếu: bước Đúng / Sai (0-based); stage khác ⇒ null. */
  ifs: { yes: number | null; no: number | null } | null;
  nextStep: number | null;
  /** Điểm cuối (Kết thúc / chờ sự kiện thường): không có cạnh đi tiếp. */
  terminal: boolean;
};

type Raw = {
  key?: unknown;
  name?: unknown;
  step?: unknown;
  node?: unknown;
  next_step?: unknown;
  outcome?: unknown;
  executor?: {
    kind?: unknown;
    tool_key?: unknown;
    args?: unknown;
    then_step?: unknown;
    else_step?: unknown;
  } | null;
  after?: {
    kind?: unknown;
    group_id?: unknown;
    group_key?: unknown;
    back_to_steps?: unknown;
    branch?: unknown;
  } | null;
};
const str = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x : null);
const num = (x: unknown): number | null =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null;
const isObj = (x: unknown): x is Raw => typeof x === "object" && x !== null;

function kindOf(s: Raw): GraphKind {
  if (s.outcome !== undefined) return "end";
  const e = s.executor;
  if (e?.kind === "approve") return "review";
  if (e?.kind === "if") return "if";
  if (e?.kind === "notify") return "notify";
  if (e?.kind === "wait_event" || e?.kind === "wait_until") return "wait";
  if (e?.kind === "tool" && e.tool_key === "contracts-esign-send") return "esign";
  if (e?.kind === "tool" && e.tool_key === "contracts-partner-send") return "partner_send";
  return "other";
}

/** Giá trị HẰNG của một arg (`{from:"const", value}`) — dạng lưu của bước Ký. */
function constString(args: unknown, k: string): string | null {
  const c = (args as Record<string, { from?: unknown; value?: unknown } | undefined> | null)?.[k];
  return c?.from === "const" && typeof c.value === "string" && c.value !== "" ? c.value : null;
}

const idxList = (x: unknown): number[] => (Array.isArray(x) ? x.flatMap((n) => num(n) ?? []) : []);

/** Mã nhóm duyệt của bước Duyệt (id Group hoặc mã Thư viện); bước khác ⇒ rỗng. */
function groupOf(s: Raw, kind: GraphKind): { groupId: string | null; groupKey: string | null } {
  const a = s.after;
  const on = kind === "review" && a?.kind === "review";
  return { groupId: on ? str(a.group_id) : null, groupKey: on ? str(a.group_key) : null };
}

/** Luật rẽ nhánh `after.branch` của bước thường (Nếu có Đúng/Sai riêng, không có luật). */
const branchOf = (s: Raw, kind: GraphKind): (number | null)[] =>
  kind !== "if" && Array.isArray(s.after?.branch)
    ? s.after.branch.map((b) => num((b as { goto_step?: unknown } | null)?.goto_step))
    : [];

function toGraphStage(s: Raw, i: number): GraphStage {
  const kind = kindOf(s);
  const e = s.executor;
  return {
    key: str(s.key) ?? `s${i}`,
    step: num(s.step) ?? i,
    name: str(s.name) ?? "",
    kind,
    ...groupOf(s, kind),
    provider: kind === "esign" ? constString(e?.args, "provider") : null,
    after: s.after?.kind === "review" ? "review" : "auto",
    backTo: idxList(s.after?.back_to_steps),
    branch: branchOf(s, kind),
    ifs: kind === "if" ? { yes: num(e?.then_step), no: num(e?.else_step) } : null,
    nextStep: num(s.next_step),
    terminal: kind === "end" || (e?.kind === "wait_event" && str(s.node) === null),
  };
}

export const graphOfStages = (stages: readonly unknown[]): GraphStage[] =>
  stages.filter(isObj).map(toGraphStage);
