// CR-182 · R1/R2 · luật DUY NHẤT «vai ⇒ người làm»: quản trị công ty giao NHÓM hoặc MỘT NGƯỜI cho từng vai (`hub.process_role_assignments`);
// `withRoles` điền `group_id` / `approver_user_id` (Duyệt), `parallel.groups[].group_id`, `escalate.group_id|user_id`, `args.company_signers` (Ký)
// vào bản chụp stage. Thuần, không I/O; mọi điểm giải vai (bắt đầu lượt, xem trước, đường nháp, màn xem) gọi hàm này.
// Vai CHƯA giao ⇒ để trống + liệt kê ở `unassigned` (engine dừng chờ / UI viền vàng). Stage không có vai: giữ nguyên.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Một hàng giao việc: đúng một trong hai `group_id` / `user_id`. */
export type RoleAssignment = {
  role_key: string;
  group_id: string | null;
  user_id: string | null;
};
export type RoleSlot = "review" | "parallel" | "escalate" | "sign";
export type UnassignedRole = {
  /** Vị trí stage trong mảng. */
  stage: number;
  slot: RoleSlot;
  role_key: string;
  label: string;
  /** false = chuyển cấp: thiếu đích ⇒ engine dùng mặc định Toàn quyền, KHÔNG chặn lượt. */
  blocking: boolean;
};
export type WithRolesOut = { stages: unknown[]; unassigned: UnassignedRole[] };

export const ESIGN_TOOL_KEY = "contracts-esign-send";
const SIGNER_ARG = "signer_role";
const SIGNERS_ARG = "company_signers";
const PROVIDER_ARG = "provider";
/** CR-182 · R3 · giá trị «Ký qua» = ký trên tài liệu (cùng `ESIGN_NODE_ONDOC` của pack-contracts; lặp ở đây để `flow` không import gói). */
export const ONDOC_PROVIDER = "ondoc";

/** Vai của một chỗ (`{key,label}`), null nếu không có / sai dạng. */
function roleOf(v: unknown): { key: string; label: string } | null {
  if (!isObj(v)) return null;
  const key = str(v.key);
  return key ? { key, label: str(v.label) ?? key } : null;
}
const constOf = (args: unknown, k: string): string | null => {
  const v = isObj(args) ? args[k] : null;
  return isObj(v) && v.from === "const" ? str(v.value) : null;
};

/** Khoá vai người ký của stage Ký (`args.signer_role` dạng hằng); stage khác ⇒ null. */
export function signerRoleOf(stage: unknown): string | null {
  const e = isObj(stage) ? stage.executor : null;
  if (!isObj(e) || e.kind !== "tool" || e.tool_key !== ESIGN_TOOL_KEY) return null;
  return constOf(e.args, SIGNER_ARG);
}

/** Có bước Ký dùng vai (cần biết công tắc `on_doc_enabled` của công ty). */
export const hasSignerRole = (stages: readonly unknown[]): boolean =>
  stages.some((s) => signerRoleOf(s) !== null);

const groupsOf = (a: Obj): unknown[] =>
  isObj(a.parallel) && Array.isArray(a.parallel.groups) ? a.parallel.groups : [];

/** Mọi khoá vai MỘT stage dùng (Duyệt, nhóm cùng duyệt, chuyển cấp, Ký). */
function stageRoleKeys(s: unknown): string[] {
  if (!isObj(s)) return [];
  const a = isObj(s.after) ? s.after : null;
  const roles = a
    ? [roleOf(a.role), ...groupsOf(a).map((g) => (isObj(g) ? roleOf(g.role) : null))]
    : [];
  if (a && isObj(a.escalate)) roles.push(roleOf(a.escalate.role));
  const keys = roles.flatMap((r) => (r ? [r.key] : []));
  const sr = signerRoleOf(s);
  return sr ? [...keys, sr] : keys;
}

/** Mọi khoá vai của một mảng stage (bỏ trùng, theo thứ tự xuất hiện) — để tra giao việc đúng một lần. */
export function roleKeysOf(stages: readonly unknown[]): string[] {
  return [...new Set(stages.flatMap(stageRoleKeys))];
}

type By = ReadonlyMap<string, RoleAssignment>;
/** `keep` = vai chưa giao thì GIỮ nguyên giá trị đang có trong stage (làm mới lúc mở bước), không xoá và không báo unassigned. */
type Keep = boolean;
/** `ondoc` = công ty BẬT ký trên tài liệu ⇒ bước Ký có vai chạy `ondoc` (bỏ `provider` cũ); TẮT ⇒ giữ `provider` / `company_signers` như cũ. */
type Ondoc = boolean;

function mainRole(a: Obj, i: number, by: By, un: UnassignedRole[], keep: Keep): Obj {
  const r = roleOf(a.role);
  if (!r) return a;
  const x = by.get(r.key);
  const { group_id: _g, group_key: _k, approver_user_id: _u, ...rest } = a;
  if (x?.group_id) return { ...rest, group_id: x.group_id };
  if (x?.user_id) return { ...rest, group_id: null, approver_user_id: x.user_id };
  if (keep) return a;
  un.push({ stage: i, slot: "review", role_key: r.key, label: r.label, blocking: true });
  return { ...rest, group_id: null };
}

function parallelRoles(a: Obj, i: number, by: By, un: UnassignedRole[], keep: Keep): Obj {
  const groups = groupsOf(a);
  if (groups.length === 0 || !isObj(a.parallel)) return a;
  const next = groups.map((g) => {
    const gr = isObj(g) ? roleOf(g.role) : null;
    if (!isObj(g) || !gr) return g;
    const gid = by.get(gr.key)?.group_id ?? null; // nhánh «cùng duyệt» chỉ nhận NHÓM (không có người)
    if (!gid && keep) return g;
    const { group_id: _gi, group_key: _gk, ...rest } = g;
    if (!gid)
      un.push({ stage: i, slot: "parallel", role_key: gr.key, label: gr.label, blocking: true });
    return { ...rest, group_id: gid };
  });
  return { ...a, parallel: { ...a.parallel, groups: next } };
}

function escalateRole(a: Obj, i: number, by: By, un: UnassignedRole[], keep: Keep): Obj {
  const e = isObj(a.escalate) ? a.escalate : null;
  const r = e ? roleOf(e.role) : null;
  if (!e || !r) return a;
  const x = by.get(r.key);
  const { group_id: _a, group_key: _b, user_id: _c, ...rest } = e;
  if (x?.group_id) return { ...a, escalate: { ...rest, group_id: x.group_id } };
  if (x?.user_id) return { ...a, escalate: { ...rest, user_id: x.user_id } };
  if (keep) return a;
  if (keep) return a;
  un.push({ stage: i, slot: "escalate", role_key: r.key, label: r.label, blocking: false });
  return { ...a, escalate: null }; // không đích ⇒ mặc định Toàn quyền
}

function review(s: Obj, a: Obj, i: number, by: By, un: UnassignedRole[], keep: Keep): Obj {
  const next = escalateRole(
    parallelRoles(mainRole(a, i, by, un, keep), i, by, un, keep),
    i,
    by,
    un,
    keep,
  );
  return next === a ? s : { ...s, after: next };
}

function sign(s: Obj, i: number, by: By, un: UnassignedRole[], keep: Keep, ondoc: Ondoc): Obj {
  const key = signerRoleOf(s);
  if (!key) return s;
  const e = s.executor as Obj;
  const x = by.get(key);
  const { [SIGNERS_ARG]: _drop, ...args } = isObj(e.args) ? e.args : ({} as Obj);
  const id = x?.group_id ? `group:${x.group_id}` : x?.user_id ? `user:${x.user_id}` : null;
  if (!id) {
    if (keep) return s;
    un.push({ stage: i, slot: "sign", role_key: key, label: str(s.name) ?? key, blocking: true });
    return { ...s, executor: { ...e, args } };
  }
  return {
    ...s,
    executor: {
      ...e,
      args: {
        ...args,
        [SIGNERS_ARG]: { from: "const", value: id },
        ...(ondoc ? { [PROVIDER_ARG]: { from: "const", value: ONDOC_PROVIDER } } : {}),
      },
    },
  };
}

/**
 * Điền người làm theo vai vào bản chụp stage. Không đổi mảng vào. `assignments` của MỘT quy trình (`role_key` duy nhất);
 * vai nhiều bước ⇒ cùng một hàng giao. Vai chưa giao ⇒ trống + `unassigned`.
 */
export function withRoles(
  stages: readonly unknown[],
  assignments: readonly RoleAssignment[],
  opts: { keepUnassigned?: boolean; ondoc?: boolean } = {},
): WithRolesOut {
  const keep = opts.keepUnassigned === true;
  const ondoc = opts.ondoc === true;
  const by: By = new Map(assignments.map((x) => [x.role_key, x]));
  const unassigned: UnassignedRole[] = [];
  const out = stages.map((s, i) => {
    if (!isObj(s)) return s;
    const a = isObj(s.after) && s.after.kind === "review" ? s.after : null;
    const r = a ? review(s, a, i, by, unassigned, keep) : s;
    return sign(r, i, by, unassigned, keep, ondoc);
  });
  return { stages: out, unassigned };
}
