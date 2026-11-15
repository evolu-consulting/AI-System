// CR-159 · cây phòng ban + người của một công ty, đọc từ `deploy/tenants/<key>.yaml` (nguồn duy nhất; script không tự khai lại). Luật THUẦN trừ `readOrg`.
// Luật duyệt chung: duyệt đầu = trưởng phòng của người tạo; người tạo là trưởng / phòng không trưởng ⇒ lên trưởng phòng cha (engine `starter_head`
// làm sẵn: `pickStarterHead`). Hàm `chainOf` dùng ĐÚNG luật đó để int test kiểm chuỗi người duyệt của từng người tạo.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Dept,
  pickStarterHead,
} from "../../../apps/hub-api/src/modules/processes/domain/tasks/starter-head.rules";

export type Org = {
  /** email người dùng khai ở `users:` */
  users: string[];
  rootKey: string;
  rootHead: string | null;
  /** phòng không phải gốc (phẳng, cha = gốc) */
  deptKeys: string[];
  /** phòng → email thành viên (trưởng cũng là thành viên, như tenant-onboard) */
  members: Map<string, string[]>;
  /** phòng → email trưởng (vắng ⇒ không có) */
  heads: Map<string, string | null>;
};

type Raw = { email?: string; head?: string; members?: string[]; key: string };
export function parseOrg(text: string): Org {
  const y = Bun.YAML.parse(text) as { users?: Raw[]; root: Raw; departments?: Raw[] };
  const depts = y.departments ?? [];
  const entry = (d: Raw): [string, string[]] => [
    d.key,
    [...new Set([...(d.head ? [d.head] : []), ...(d.members ?? [])].map((e) => e.toLowerCase()))],
  ];
  return {
    users: (y.users ?? []).map((u) => String(u.email).toLowerCase()),
    rootKey: y.root.key,
    rootHead: y.root.head?.toLowerCase() ?? null,
    deptKeys: depts.map((d) => d.key),
    members: new Map([entry(y.root), ...depts.map(entry)]),
    heads: new Map([y.root, ...depts].map((d) => [d.key, d.head?.toLowerCase() ?? null])),
  };
}
export const readOrg = (key: string, dir = join(import.meta.dir, "../../../deploy/tenants")): Org =>
  parseOrg(readFileSync(join(dir, `${key}.yaml`), "utf8"));

/** Phòng của người (trực tiếp) + toàn bộ phòng cha (đúng cách engine leo cấp ở `headOfCreator`). */
export function departmentsOf(org: Org, email: string): string[] {
  const own = [...org.members].filter(([, m]) => m.includes(email)).map(([k]) => k);
  return own.length > 0 && !own.includes(org.rootKey) ? [...own, org.rootKey] : own;
}

/** Trưởng phòng của người tạo theo ĐÚNG luật engine (leo cấp, bỏ trưởng = người tạo); null ⇒ không ai (engine giao đích dự phòng). */
export function headOfCreator(org: Org, email: string): string | null {
  const depts = new Map<string, Dept>([
    [org.rootKey, { parent: null, head: org.rootHead }],
    ...org.deptKeys.map((k): [string, Dept] => [
      k,
      { parent: org.rootKey, head: org.heads.get(k) ?? null },
    ]),
  ]);
  return pickStarterHead(depts, departmentsOf(org, email), email, () => true);
}

/**
 * Cách dựng bước duyệt đầu (CR-160, MỘT luật cho mọi người tạo, không rẽ theo phòng):
 *  `none`   — không còn ai ngoài trưởng gốc (preschool) ⇒ không bước duyệt;
 *  `tiered` — còn người khác ⇒ nhánh `if starter_is_top` (Đúng ⇒ bỏ duyệt) rồi trưởng phòng của người tạo (`starter_head`, tự leo cấp).
 */
export type Shape = "none" | "tiered";
export const shapeOf = (org: Org): Shape =>
  org.users.some((e) => e !== org.rootHead) ? "tiered" : "none";
