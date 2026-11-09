// CR-126 · «nhóm phụ trách» của node module — MỘT cơ chế cho mọi node app có stage người làm (form/duyệt) bên trong: nhóm chọn ở cấu hình node
// (`args.assignee_group` của stage tool trong cụm, ô `group` của panel) là NGUỒN; `after.group_id` / `after.group_key` của stage người làm trong
// cùng cụm là bản DẪN XUẤT, tính lại mỗi lần lưu (`applyNodeAssignee`) ⇒ engine giao task theo đường cũ (`after.group_id`, đổi mã → id lúc mở
// lượt), không đổi khoá/thứ tự khoá. Thiếu nhóm ⇒ `nodeAssigneeNeeds` báo bước chưa sẵn sàng («Chọn <nhãn ô>»). Thuần, O(số stage), không I/O.
import { featureNodeByKey } from "./modules.rules";
import type { FeatureModule, FeatureNodeDecl } from "./types";

export const NODE_ASSIGNEE_ARG = "assignee_group";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Executor có người làm (task review) — stage của chúng nhận nhóm phụ trách của node. */
const HUMAN = new Set(["form"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const kindOf = (s: Obj): string | undefined =>
  typeof s.executor === "string"
    ? s.executor
    : isObj(s.executor)
      ? (s.executor.kind as string)
      : undefined;

/** Node có ô `assignee_group` trong cổng cấu hình. */
export function hasNodeAssignee(decl: FeatureNodeDecl | undefined): boolean {
  const shape = (decl?.configPort?.schema as { shape?: Obj } | undefined)?.shape;
  return !!shape && NODE_ASSIGNEE_ARG in shape;
}

/** Nhãn nghiệp vụ của ô (`.describe()`), vd "Nhóm phụ trách gửi đối tác". */
export function nodeAssigneeLabel(decl: FeatureNodeDecl): string {
  const f = (decl.configPort?.schema as { shape?: Obj } | undefined)?.shape?.[NODE_ASSIGNEE_ARG];
  const d = (f as { description?: string } | undefined)?.description;
  return d?.trim() ? d : "Nhóm phụ trách";
}

type Cluster = { decl: FeatureNodeDecl; start: number; end: number };

/** Cụm stage liên tiếp cùng `node` (cắt theo số stage của khai báo) của các node có `assignee_group`. */
function clustersOf(stages: readonly unknown[], mods: readonly FeatureModule[]): Cluster[] {
  const out: Cluster[] = [];
  let i = 0;
  while (i < stages.length) {
    const s = stages[i];
    const key = isObj(s) && typeof s.node === "string" ? s.node : undefined;
    const decl = key ? featureNodeByKey(mods, key) : undefined;
    if (!decl || !hasNodeAssignee(decl) || decl.stages.length === 0) {
      i++;
      continue;
    }
    const m = decl.stages.length;
    let j = i;
    while (j < stages.length && (stages[j] as Obj | undefined)?.node === key) j++;
    for (let p = i; p < j; p += m) out.push({ decl, start: p, end: Math.min(p + m, j) });
    i = j;
  }
  return out;
}

/** Giá trị nhóm cấu hình ở stage tool của cụm (`{from:"const", value}` hoặc chuỗi trần); trống ⇒ null. */
function assigneeOf(stages: readonly unknown[], c: Cluster): string | null {
  for (let k = c.start; k < c.end; k++) {
    const s = stages[k];
    if (!isObj(s) || !isObj(s.executor) || s.executor.kind !== "tool") continue;
    const args = isObj(s.executor.args) ? s.executor.args : {};
    const raw = args[NODE_ASSIGNEE_ARG];
    const v = isObj(raw) ? raw.value : raw;
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

const groupFields = (g: string | null): Obj =>
  g === null
    ? { group_id: null }
    : UUID.test(g)
      ? { group_id: g }
      : { group_id: null, group_key: g };

/** Ghi nhóm phụ trách của node vào `after` của stage người làm trong cụm (luôn tính lại — nguồn là cấu hình node). */
export function applyNodeAssignee<S>(stages: readonly S[], mods: readonly FeatureModule[]): S[] {
  const out = [...stages];
  for (const c of clustersOf(stages, mods)) {
    const g = assigneeOf(stages, c);
    for (let k = c.start; k < c.end; k++) {
      const s = out[k] as unknown;
      if (isObj(s) && HUMAN.has(kindOf(s) ?? ""))
        out[k] = { ...s, after: humanAfter(s.after, g) } as S;
    }
  }
  return out;
}

/** `after` của stage người làm: giữ cấu hình review có sẵn (nhắc, chuyển cấp…), chỉ thay nhóm; chưa review ⇒ review mặc định. */
function humanAfter(raw: unknown, g: string | null): Obj {
  const after = isObj(raw) ? raw : {};
  const base: Obj =
    after.kind === "review"
      ? after
      : {
          kind: "review",
          back_to_steps: [],
          remind_every_h: null,
          escalate: null,
          exclude_starter: false,
          ...(after.branch === undefined ? {} : { branch: after.branch }),
        };
  const { group_key: _k, ...rest } = base;
  return { ...rest, ...groupFields(g) };
}

export type NodeAssigneeNeed = {
  /** Tên bước (stage đầu cụm). */
  stage: string;
  node: string;
  /** Nhóm đã chọn (id hoặc mã); null = chưa chọn. */
  group: string | null;
  /** Nhãn ô, vd "Nhóm phụ trách gửi đối tác". */
  label: string;
};

/** Mỗi cụm node có stage người làm ⇒ nhóm phụ trách nó cần (để readiness kiểm có / có ở công ty). */
export function nodeAssigneeNeeds(
  stages: readonly unknown[],
  mods: readonly FeatureModule[],
): NodeAssigneeNeed[] {
  return clustersOf(stages, mods).flatMap((c) => {
    const human = stages.slice(c.start, c.end).some((s) => isObj(s) && HUMAN.has(kindOf(s) ?? ""));
    if (!human) return [];
    const head = stages[c.start] as Obj;
    const stage =
      typeof head.name === "string" && head.name ? head.name : String(head.key ?? c.decl.key);
    return [
      { stage, node: c.decl.key, group: assigneeOf(stages, c), label: nodeAssigneeLabel(c.decl) },
    ];
  });
}

/** Câu nghiệp vụ khi thiếu nhóm: «Chọn nhóm phụ trách gửi đối tác». */
export const nodeAssigneeMessage = (label: string): string =>
  `Chọn ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
