// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-165 · phần DỰNG người của fixture (chỉ `_flows3-stack.ts` chạy dưới bun dùng): cây phòng ban = `deploy/tenants/<key>.yaml` (`readOrg`) + vài nhân viên thêm.
import { readOrg } from "../../tools/scripts/src/tenant-flows.org";
import { CO, type Side, type TenantKey, userOf } from "./_flows3-who";

/** Nhân viên thêm (email giả cùng dạng yaml): đứng dưới trưởng phòng để có «trưởng phòng duyệt». */
export const EXTRA: Record<TenantKey, { email: string; dept: string }[]> = {
  nitigroup: [
    { email: "hoa.tran@nitigroupvn.com", dept: "pb-ke-toan" },
    { email: "lan.vo@nitigroupvn.com", dept: "pb-ke-toan" },
  ],
  evolu: [{ email: "minh.le@evolu.com", dept: "pb-kinh-doanh" }],
  preschool: [],
};

export type SeedPerson = {
  username: string;
  display: string;
  title: string;
  dept: string;
  head: boolean;
  role: "tenant_admin" | "member";
  packRole: "owner" | "editor";
};

/** Người + phòng của một công ty (từ yaml + EXTRA). Trưởng phòng gốc = Toàn quyền + quản trị; còn lại nhân viên. */
export function seedPeople(side: Side): { root: string; depts: string[]; people: SeedPerson[] } {
  const y = CO[side].yaml;
  const org = readOrg(y);
  const people: SeedPerson[] = [];
  const add = (email: string, dept: string): void => {
    const top = email === org.rootHead;
    const u = userOf(email);
    people.push({
      username: u,
      display: u,
      title: u,
      dept,
      head: org.heads.get(dept) === email,
      role: top ? "tenant_admin" : "member",
      packRole: top ? "owner" : "editor",
    });
  };
  for (const [dept, emails] of org.members) for (const e of emails) add(e, dept);
  for (const x of EXTRA[y]) add(x.email, x.dept);
  return { root: org.rootKey, depts: org.deptKeys, people };
}
