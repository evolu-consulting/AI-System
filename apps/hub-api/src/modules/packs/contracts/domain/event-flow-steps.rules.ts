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

// CR-146 · khối chỉ xem «Ký và đối tác của quy trình này»: đọc args HẰNG của stage Ký số / Gửi đối tác của CHÍNH flow.
export type EsignView = {
  signers: { kind: "user" | "group"; id: string }[];
  partnerSigns: boolean | null;
  order: "parallel" | "sequential" | null;
  /** CR-181 · «Ký qua» của bước (khoá nhà cung cấp / `upload` / `ondoc`); vắng ⇒ null. */
  provider?: string | null;
};
export type SignPartnerView = { esign: EsignView | null; partnerSend: boolean };

const ESIGN_TOOL = "contracts-esign-send";
const PARTNER_TOOL = "contracts-partner-send";
type ToolStage = { executor?: { kind?: unknown; tool_key?: unknown; args?: unknown } | null };
const SIGNER = /^(user|group):([0-9a-f-]{36})$/i;

export function constArgs(args: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (typeof args !== "object" || args === null) return out;
  for (const [k, v] of Object.entries(args)) {
    const c = v as { from?: unknown; value?: unknown } | null;
    if (c?.from === "const" && ["string", "number", "boolean"].includes(typeof c.value))
      out[k] = c.value as string | number | boolean;
  }
  return out;
}

export function signPartnerOf(stages: readonly unknown[]): SignPartnerView {
  const tools = stages.filter(isObj).map((s) => (s as ToolStage).executor);
  const es = tools.find((e) => e?.kind === "tool" && e.tool_key === ESIGN_TOOL);
  const partnerSend = tools.some((e) => e?.kind === "tool" && e.tool_key === PARTNER_TOOL);
  if (!es) return { esign: null, partnerSend };
  const a = constArgs(es.args);
  const signers = String(a.company_signers ?? "")
    .split(",")
    .flatMap((x) => {
      const m = SIGNER.exec(x.trim());
      return m ? [{ kind: m[1] as "user" | "group", id: m[2] as string }] : [];
    });
  const order = a.order === "parallel" || a.order === "sequential" ? a.order : null;
  const ps =
    a.partner_signs === true || a.partner_signs === "true"
      ? true
      : a.partner_signs === false || a.partner_signs === "false"
        ? false
        : null;
  const provider = typeof a.provider === "string" && a.provider !== "" ? a.provider : null;
  return { esign: { signers, partnerSigns: ps, order, provider }, partnerSend };
}
