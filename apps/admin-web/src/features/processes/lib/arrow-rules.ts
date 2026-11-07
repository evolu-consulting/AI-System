// CR-123 · u12 · luật MỘT nguồn cho mũi tên giữa các bước (kéo cổng ra, nối lại đầu đích, "Bắt đầu khi", lưu): người dùng không thấy
// "thứ tự bước" bên trong ⇒ luật là "không tạo VÒNG LẶP", không phải "đích có số bước lớn hơn". Đích nằm trước nguồn mà không phải tổ tiên
// của nguồn ⇒ sắp lại các bước (thứ tự tô-pô ổn định) để bản nháp vẫn hợp lệ (mọi đích đều ở bước SAU). Thuần.
// Đồ thị = các "ô" (một cột, hoặc cụm node module nhiều cột liên tiếp như Ký số) + cạnh theo `remapStepRefs` (goto / Đúng-Sai / Từ chối-Trả lại /
// nextStep / ghi giá trị / nhánh chờ) + cạnh ngầm "bước kế". Kiểm vòng dùng `getOutgoers` của React Flow (mẫu "prevent cycles" trong tài liệu).

import { newRealViolation } from "@ai/contracts/hub-admin";
import { getOutgoers } from "@xyflow/react";
import { type ConnectError, connectPatch } from "./canvas-connect";
import type { StageDraft } from "./draft-types";
import { clearFree, connectToTrigger, isFree, placeAfter, placeAfterSource } from "./free-nodes";
import { moduleClusters } from "./module-cluster";
import { remapStepRefs } from "./step-refs";

export type ArrowResult = { ok: true; stages: StageDraft[] } | { ok: false; error: "loop" };

type Unit = { id: string; steps: number[] };
type G = { id: string; position: { x: number; y: number }; data: Record<string, unknown> };
type E = { id: string; source: string; target: string };

/** Đích (bước 0-based) mà stage trỏ tới bằng ô cấu hình — cùng bộ trường với `remapOne`. */
function explicitTargets(s: StageDraft): number[] {
  const out: (number | null | undefined)[] = [
    ...s.branch.map((r) => (r.goto === null ? null : r.goto - 1)),
    s.ifx.yes === null ? null : s.ifx.yes - 1,
    s.ifx.no === null ? null : s.ifx.no - 1,
    s.approve?.reject,
    s.approve?.ret,
    s.nextStep,
    ...s.set.rows.map((r) => r.step),
    ...(s.wait.branches ?? []).map((b) => b.step),
  ];
  return out.filter((x): x is number => typeof x === "number");
}

/** Có cạnh ngầm "đi tiếp bước kế" (không phải Nếu / Kết thúc / chờ sự kiện không thuộc node module / node đứng riêng). */
const flowsOn = (s: StageDraft): boolean =>
  s.free !== true &&
  s.nextStep === undefined &&
  s.executor !== "if" &&
  s.outcome === undefined &&
  !(s.executor === "wait_event" && !s.node);

/** Các ô: cột nào có stage thuộc cùng cụm node module thì gộp thành một ô (cụm không bị tách / xen). */
function unitsOf(stages: readonly StageDraft[]): Unit[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    return p === x ? x : find(p);
  };
  for (const s of stages) parent.set(s.step, s.step);
  for (const c of moduleClusters(stages.map((s) => ({ node: s.node, executor: s.executor })))) {
    const first = (stages[c.start] as StageDraft).step;
    for (let i = c.start + 1; i < c.end; i++)
      parent.set(find((stages[i] as StageDraft).step), find(first));
  }
  const groups = new Map<number, number[]>();
  for (const step of [...new Set(stages.map((s) => s.step))].sort((a, b) => a - b)) {
    const root = find(step);
    groups.set(root, [...(groups.get(root) ?? []), step]);
  }
  return [...groups.values()]
    .sort((a, b) => (a[0] as number) - (b[0] as number))
    .map((steps, i) => ({ id: `u${i}`, steps }));
}

function edgesOf(stages: readonly StageDraft[], units: readonly Unit[]): E[] {
  const at = new Map<number, string>(
    units.flatMap((u) => u.steps.map((st) => [st, u.id] as const)),
  );
  const seen = new Set<string>();
  const out: E[] = [];
  for (const s of stages) {
    if (s.free === true) continue;
    const to = [...explicitTargets(s), ...(flowsOn(s) ? [s.step + 1] : [])];
    for (const t of to) {
      const a = at.get(s.step);
      const b = at.get(t);
      if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      out.push({ id: `${a}>${b}`, source: a, target: b });
    }
  }
  return out;
}

/** Mẫu "prevent cycles" của React Flow: từ `from` đi theo cạnh ra có tới được `to` không (cả `from === to`). */
function reaches(nodes: G[], edges: E[], from: G, to: G, seen = new Set<string>()): boolean {
  if (from.id === to.id) return true;
  if (seen.has(from.id)) return false;
  seen.add(from.id);
  return getOutgoers(from, nodes, edges).some((o) => reaches(nodes, edges, o, to, seen));
}

/** Thứ tự tô-pô ỔN ĐỊNH: luôn lấy ô có vị trí gốc nhỏ nhất trong số ô đã đủ điều kiện ⇒ chỉ ô bị ép mới dời chỗ. null ⇒ có vòng. */
function stableOrder(n: number, edges: readonly E[]): number[] | null {
  const idx = (id: string) => Number(id.slice(1));
  const indeg = Array.from({ length: n }, () => 0);
  for (const e of edges) indeg[idx(e.target)] = (indeg[idx(e.target)] as number) + 1;
  const done = new Set<number>();
  const order: number[] = [];
  while (order.length < n) {
    const next = indeg.findIndex((d, i) => d === 0 && !done.has(i));
    if (next < 0) return null;
    done.add(next);
    order.push(next);
    for (const e of edges)
      if (idx(e.source) === next) indeg[idx(e.target)] = (indeg[idx(e.target)] as number) - 1;
  }
  return order;
}

/** Cạnh ngầm → tường minh (`nextStep`) để dời ô không làm đổi "bước kế" của stage nào. Trả cả tập uid đã thêm. */
function materialize(stages: readonly StageDraft[], units: readonly Unit[]) {
  const unitOf = new Map<number, string>(
    units.flatMap((u) => u.steps.map((st) => [st, u.id] as const)),
  );
  const columns = new Set(stages.map((s) => s.step));
  const added = new Set<string>();
  const out = stages.map((s) => {
    if (!flowsOn(s) || !columns.has(s.step + 1) || unitOf.get(s.step) === unitOf.get(s.step + 1))
      return s;
    added.add(s.uid);
    return { ...s, nextStep: s.step + 1 };
  });
  return { out, added };
}

/** Đánh số lại bước theo thứ tự ô mới; đích của mọi stage theo `remapStepRefs`, `backTo` đổi số theo cột rồi bỏ đích không còn đứng trước. */
function rebuild(
  base: readonly StageDraft[],
  units: readonly Unit[],
  order: readonly number[],
  added: ReadonlySet<string>,
): StageDraft[] {
  const map = new Map<number, number>();
  let next = 0;
  for (const i of order) for (const st of (units[i] as Unit).steps) map.set(st, next++);
  const moved = base
    .map((s) => {
      const step = map.get(s.step) as number;
      const backTo = s.backTo.flatMap((t) => {
        const r = map.get(t);
        return r !== undefined && r < step ? [r] : [];
      });
      return { ...s, step, backTo: [...new Set(backTo)].sort((a, b) => a - b) };
    })
    .sort((a, b) => a.step - b.step);
  return remapStepRefs(base, moved).map((s) => {
    if (!added.has(s.uid) || s.nextStep !== s.step + 1) return s;
    const { nextStep: _seq, ...rest } = s;
    return rest;
  });
}

/**
 * Mũi tên `source → target`: bảo đảm ô của đích đứng SAU ô của nguồn.
 *  - đã sau ⇒ trả nguyên bản nháp; trước mà KHÔNG phải tổ tiên của nguồn ⇒ sắp lại (đích dời ra sau nguồn, phần còn lại giữ thứ tự);
 *  - đích là tổ tiên / chính nguồn / bước đầu tiên (đã nối từ "Bắt đầu khi") ⇒ `loop` (không đổi gì).
 */
export function arrowOrder(
  stages: readonly StageDraft[],
  source: string,
  target: string,
): ArrowResult {
  const s = stages.find((x) => x.uid === source);
  const d = stages.find((x) => x.uid === target);
  if (!s || !d) return { ok: true, stages: [...stages] };
  const units = unitsOf(stages);
  const unitAt = (step: number) => units.findIndex((u) => u.steps.includes(step));
  const [si, di] = [unitAt(s.step), unitAt(d.step)];
  if (si === di) return { ok: false, error: "loop" };
  if (di > si) return { ok: true, stages: [...stages] };
  const nodes: G[] = units.map((u) => ({ id: u.id, position: { x: 0, y: 0 }, data: {} }));
  const edges = edgesOf(stages, units);
  const [from, to] = [nodes[di] as G, nodes[si] as G];
  if (di === 0 || reaches(nodes, edges, from, to)) return { ok: false, error: "loop" };
  const order = stableOrder(nodes.length, [
    ...edges,
    { id: "new", source: `u${si}`, target: `u${di}` },
  ]);
  if (!order) return { ok: false, error: "loop" };
  const { out, added } = materialize(stages, units);
  return { ok: true, stages: rebuild(out, units, order, added) };
}

/** Mũi tên từ "Bắt đầu khi": cùng luật Ký số như mọi mũi tên (`realNeeds`) rồi mới tới luật "bước đầu / node đứng riêng" (`notFirst`). */
export function triggerArrow(
  stages: readonly StageDraft[],
  target: string,
): { stages: StageDraft[] } | { error: "realNeeds" | "notFirst" } {
  const refused = connectPatch(stages, { source: "trigger", target });
  if (refused && !refused.ok) return { error: "realNeeds" };
  return connectToTrigger(stages, target);
}

/**
 * Đích không đứng sau nguồn: node đứng riêng ⇒ đặt ngay sau nguồn; cùng cột song song với nguồn ⇒ tách đích ra bước mới ngay sau nguồn
 * (hai bước cùng cột KHÔNG phải vòng lặp); bước đã nối ở trước ⇒ sắp lại nếu không tạo vòng; còn lại `loop`.
 */
export function laterTarget(
  stages: readonly StageDraft[],
  source: string,
  target: string,
): { stages: StageDraft[] } | { error: "loop" } {
  const moved = placeAfterSource(stages, source, target);
  if (moved) return { stages: moved };
  const s = stages.find((x) => x.uid === source);
  const d = stages.find((x) => x.uid === target);
  if (s && d && s.uid !== d.uid && s.step === d.step && !sameCluster(stages, s.uid, d.uid))
    return { stages: placeAfter(stages, target, s.step) };
  const o = arrowOrder(stages, source, target);
  return o.ok ? { stages: o.stages } : { error: o.error };
}

const sameCluster = (stages: readonly StageDraft[], a: string, b: string): boolean =>
  moduleClusters(stages.map((s) => ({ node: s.node, executor: s.executor }))).some((c) => {
    const uids = stages.slice(c.start, c.end).map((s) => s.uid);
    return uids.includes(a) && uids.includes(b);
  });

/** Bước Duyệt phải ĐỨNG MỘT MÌNH trong bước (hub: APPROVE_INVALID): bước Duyệt đang chung cột với bước khác ⇒ tách ra cột riêng ngay sau cột đó. */
export function isolateApprovals(stages: readonly StageDraft[]): StageDraft[] {
  let out = [...stages];
  for (let guard = 0; guard < out.length; guard++) {
    const shared = out.find(
      (s) => s.executor === "approve" && out.some((o) => o.uid !== s.uid && o.step === s.step),
    );
    if (!shared) break;
    out = placeAfter(out, shared.uid, shared.step);
  }
  return out;
}

export type ConnectOutcome =
  | { stages: StageDraft[]; field: "yes" | "no" | "next" | "exit" }
  | { error: ConnectError | "loop" | "real" };

/**
 * MỘT hàm cho mọi mũi tên giữa hai bước (kéo cổng ra, nối lại đầu đích): node vừa thả (đứng riêng) luôn thành bước MỚI ngay sau nguồn (không dính
 * cột của bước khác); đích nằm trước / cùng cột ⇒ `laterTarget`; xong mọi bước Duyệt đều đứng một mình. `null` ⇒ không làm gì (thả lên chính nó…).
 */
export function applyConnect(
  stages: readonly StageDraft[],
  c: { source: string; target: string; sourceHandle?: string | null },
): ConnectOutcome | null {
  if (c.source === c.target) return null;
  let st: readonly StageDraft[] = stages;
  let r = connectPatch(st, c);
  const dst = st.find((s) => s.uid === c.target);
  const needMove = dst !== undefined && isFree(dst);
  if (needMove || (r && !r.ok && r.error === "notLater")) {
    const fix = laterTarget(st, c.source, c.target);
    if ("error" in fix) return { error: fix.error };
    st = fix.stages;
    r = connectPatch(st, c);
  }
  if (!r) return null;
  if (!r.ok) return { error: r.error };
  const patched = st.map((s, i) =>
    i === r.index ? { ...s, ...(r.patch as Partial<StageDraft>) } : s,
  );
  if (newRealViolation(st, patched)) return { error: "real" };
  return { stages: isolateApprovals(clearFree(patched, c.target)), field: r.field };
}

/**
 * Các bước (0-based) mà stage `uid` nối tới được — cùng luật với kéo mũi tên: mọi bước KHÔNG phải tổ tiên / chính nó
 * (đích sau nguồn ⇒ nối thẳng; đích trước ⇒ `arrowOrder` sắp lại). Ô chọn "Gộp tới" dùng đúng danh sách này.
 */
export function linkableSteps(stages: readonly StageDraft[], uid: string): number[] {
  const s = stages.find((x) => x.uid === uid);
  if (!s) return [];
  const firstAt = (step: number) => stages.find((x) => x.step === step);
  return [...new Set(stages.map((x) => x.step))]
    .filter((step) => step !== s.step)
    .sort((a, b) => a - b)
    .filter((step) => {
      const to = firstAt(step);
      return !!to && (step > s.step || arrowOrder(stages, uid, to.uid).ok);
    });
}
