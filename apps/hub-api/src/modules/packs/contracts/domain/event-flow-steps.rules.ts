// CR-125 · S2 · stage của flow theo sự kiện (`company_flows`, def FlowDef) ⇒ các bước người dùng thấy ở Cài đặt (Duyệt / Ký số / Thông báo).
// Thuần (lớp 1). Bước kỹ thuật (Kết thúc, Chờ ký xong, Ghi giá trị…) bỏ đi; node Nếu ⇒ `branches = true` (Cài đặt nói "có rẽ nhánh,
// xem sơ đồ ở trang Quy trình" thay vì liệt kê sai đường đi).

export type EventStep = {
  name: string;
  kind: "review" | "esign" | "notify";
  /** Phòng/nhóm duyệt: theo id Group của công ty (`group_id`) hoặc theo mã Thư viện (`group_key`); null khi bước không có nhóm. */
  groupId: string | null;
  groupKey: string | null;
};
export type EventSteps = { steps: EventStep[]; branches: boolean };

type Stage = {
  name?: unknown;
  step?: unknown;
  node?: unknown;
  executor?: { kind?: unknown; tool_key?: unknown } | null;
  after?: { kind?: unknown; group_id?: unknown; group_key?: unknown } | null;
  outcome?: unknown;
};
const str = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x : null);
const isObj = (x: unknown): x is Stage => typeof x === "object" && x !== null;

function stepOf(s: Stage): EventStep | null {
  const name = str(s.name) ?? "";
  const kind = s.executor?.kind;
  if (kind === "approve") {
    const a = s.after;
    return {
      name,
      kind: "review",
      groupId: a?.kind === "review" ? str(a.group_id) : null,
      groupKey: a?.kind === "review" ? str(a.group_key) : null,
    };
  }
  if (kind === "tool" && s.executor?.tool_key === "contracts-esign-send")
    return { name, kind: "esign", groupId: null, groupKey: null };
  if (kind === "notify") return { name, kind: "notify", groupId: null, groupKey: null };
  return null;
}

/** Các bước theo thứ tự `step` (stage cùng `step` giữ thứ tự mảng). */
export function stepsOfStages(stages: readonly unknown[]): EventSteps {
  const list = stages.filter(isObj).filter((s) => s.outcome === undefined);
  const ordered = list
    .map((s, i) => ({ s, i, n: typeof s.step === "number" ? s.step : i }))
    .sort((a, b) => a.n - b.n || a.i - b.i);
  const steps = ordered.flatMap(({ s }) => stepOf(s) ?? []);
  const branches = list.some((s) => s.executor?.kind === "if");
  return { steps, branches };
}
