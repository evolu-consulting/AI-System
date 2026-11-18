// CR-182 · cr182-migrate · luật THUẦN của bản xem trước migration hub 0160 (điền vai + giao việc): đếm quy trình / bước / công ty sẽ được điền vai,
// trường hợp mơ hồ (Ký nhiều người, Ký ở mẫu Thư viện, nhóm không còn / công ty thiếu nhóm cùng mã ⇒ «Chưa giao người»). Không I/O; khớp luật SQL 0160.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const SIGNER = /^(user|group):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PreviewDef = { id: string; tenant_id: string | null; key: string; stages: unknown };
export type PreviewIn = {
  defs: readonly PreviewDef[];
  /** `tenant_id:group_id` và `tenant_id:key` của mọi nhóm. */
  groupIds: ReadonlySet<string>;
  groupKeys: ReadonlySet<string>;
  /** Công ty được gán def Thư viện: flow_id → tenant_id[]. */
  assigned: ReadonlyMap<string, readonly string[]>;
  /** Lượt chưa kết thúc theo def. */
  activeRuns: ReadonlyMap<string, number>;
};
export type PreviewOut = {
  defs: number;
  stages: number;
  tenants: string[];
  ambiguous: string[];
  unassigned: string[];
  activeRuns: number;
};

type Ref = { kind: "group_id" | "group_key" | "user"; ref: string };
const refOf = (o: Obj, withUser: boolean): Ref | null => {
  if (s(o.group_id)) return { kind: "group_id", ref: s(o.group_id) };
  if (s(o.group_key)) return { kind: "group_key", ref: s(o.group_key) };
  if (withUser && s(o.approver_user_id)) return { kind: "user", ref: s(o.approver_user_id) };
  if (withUser && s(o.user_id)) return { kind: "user", ref: s(o.user_id) };
  return null;
};

type Slots = { refs: Ref[]; sign: "none" | "one" | "many"; signRef: string };

/** Nhóm/người CHƯA có vai trong phần Duyệt (chính, cùng duyệt, chuyển cấp). */
function reviewRefs(a: Obj): Ref[] {
  const out: (Ref | null)[] = [isObj(a.role) ? null : refOf(a, true)];
  const gs = isObj(a.parallel) && Array.isArray(a.parallel.groups) ? a.parallel.groups : [];
  for (const g of gs) out.push(!isObj(g) || isObj(g.role) ? null : refOf(g, false));
  if (isObj(a.escalate) && !isObj(a.escalate.role)) out.push(refOf(a.escalate, true));
  return out.filter((r): r is Ref => r !== null);
}

/** Bước Ký chưa có `signer_role`: không có / đúng một / nhiều mục `company_signers`. */
function signOf(st: unknown): Pick<Slots, "sign" | "signRef"> {
  const e = isObj(st) ? st.executor : null;
  const args =
    isObj(e) && e.kind === "tool" && e.tool_key === "contracts-esign-send" && isObj(e.args)
      ? e.args
      : null;
  const cs =
    args &&
    !isObj(args.signer_role) &&
    isObj(args.company_signers) &&
    args.company_signers.from === "const"
      ? s(args.company_signers.value).trim()
      : "";
  if (!cs) return { sign: "none", signRef: "" };
  const parts = cs.split(/s*,s*/);
  const one = parts.length === 1 && SIGNER.test(parts[0] ?? "");
  return { sign: one ? "one" : "many", signRef: one ? (parts[0] ?? "") : "" };
}

const slotsOf = (st: unknown): Slots => ({
  refs: isObj(st) && isObj(st.after) && st.after.kind === "review" ? reviewRefs(st.after) : [],
  ...signOf(st),
});

function missing(i: PreviewIn, key: string, tenant: string, x: Slots, signs: boolean): string[] {
  const out: string[] = [];
  for (const r of x.refs) {
    const ok =
      r.kind === "group_id"
        ? i.groupIds.has(`${tenant}:${r.ref}`)
        : r.kind === "group_key"
          ? i.groupKeys.has(`${tenant}:${r.ref}`)
          : true;
    if (!ok) out.push(`${key} · công ty ${tenant}: nhóm ${r.ref} không có ⇒ «Chưa giao người»`);
  }
  const [kind, id] = x.signRef.split(":");
  if (signs && kind?.toLowerCase() === "group" && !i.groupIds.has(`${tenant}:${id}`))
    out.push(`${key} · công ty ${tenant}: nhóm ký ${id} không có ⇒ «Chưa giao người»`);
  return out;
}

/** Một def: số bước được điền vai + dòng mơ hồ / chưa giao. */
function planDef(i: PreviewIn, d: PreviewDef, forTenants: readonly string[]) {
  const ambiguous: string[] = [];
  const unassigned: string[] = [];
  let touched = 0;
  for (const [n, st] of (d.stages as unknown[]).entries()) {
    const x = slotsOf(st);
    const at = `${d.key} · bước ${n + 1}`;
    if (x.sign === "many") ambiguous.push(`${at}: Ký nhiều người/nhóm (giữ cấu hình cũ)`);
    if (x.sign === "one" && !d.tenant_id)
      ambiguous.push(`${at}: Ký ở mẫu Thư viện (giữ cấu hình cũ)`);
    const signs = x.sign === "one" && d.tenant_id !== null;
    if (x.refs.length === 0 && !signs) continue;
    touched++;
    for (const t of forTenants) unassigned.push(...missing(i, d.key, t, x, signs));
  }
  return { touched, ambiguous, unassigned };
}

export function previewPlan(i: PreviewIn): PreviewOut {
  const tenants = new Set<string>();
  const ambiguous: string[] = [];
  const unassigned = new Set<string>();
  let defs = 0;
  let stages = 0;
  let runs = 0;
  for (const d of i.defs) {
    if (!Array.isArray(d.stages)) continue;
    const forTenants = d.tenant_id ? [d.tenant_id] : [...(i.assigned.get(d.id) ?? [])];
    const r = planDef(i, d, forTenants);
    ambiguous.push(...r.ambiguous);
    for (const l of r.unassigned) unassigned.add(l);
    if (r.touched === 0) continue;
    defs++;
    stages += r.touched;
    runs += i.activeRuns.get(d.id) ?? 0;
    for (const t of forTenants) tenants.add(t);
  }
  return {
    defs,
    stages,
    tenants: [...tenants].sort(),
    ambiguous,
    unassigned: [...unassigned],
    activeRuns: runs,
  };
}
