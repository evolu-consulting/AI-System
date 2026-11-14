// CR-150b · I/O của sơ đồ tổ chức evolu (đọc trạng thái qua API admin, áp `planOrg`). Chỉ THÊM; mật khẩu người mới từ `UAT_EVOLU_PW` (không in).
import { hashPassword } from "@ai/db";
import type { Sql } from "postgres";
import { type Api, call, type Json } from "../../hub-dev/src/fixture";
import {
  createdUserId,
  ORG_PEOPLE,
  type OrgAction,
  type OrgState,
  orgEmail,
  planOrg,
} from "./seed-demo-partner.org";

const fail = (m: string): never => {
  throw new Error(m);
};
const items = (j: unknown): Json[] => ((j as { items?: Json[] }).items ?? []) as Json[];

type Read = { state: OrgState; gid: Map<string, string>; uid: Map<string, string> };
async function orgState(api: Api, tid: string): Promise<Read> {
  const gid = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  const wanted = new Set([
    ...ORG_PEOPLE.map((p) => p.dept),
    "uat-nhan-ky",
    "contracts-owner",
    "contracts-editor",
  ]);
  for (const g of items(await call(api, "GET", `/admin/groups?tenant_id=${tid}&limit=200`))) {
    gid.set(String(g.key), String(g.id));
    if (!wanted.has(String(g.key))) continue;
    const mem = await call(api, "GET", `/admin/groups/${String(g.id)}/members?limit=200`);
    groups.set(String(g.key), new Set(items(mem).map((m) => String(m.username))));
  }
  const org = await call(api, "GET", `/admin/org?tenant_id=${tid}`);
  const members = (org.members as Json[] | undefined) ?? [];
  const depts = (org.departments as Json[] | undefined) ?? [];
  const uid = new Map(members.map((m) => [String(m.username), String(m.user_id)]));
  const name = new Map(members.map((m) => [String(m.user_id), String(m.username)]));
  const keyOf = new Map(depts.map((d) => [String(d.group_id), String(d.key)]));
  const nameOf = (id: unknown): string | null => (id ? (name.get(String(id)) ?? "?") : null);
  const state: OrgState = {
    users: new Set(uid.keys()),
    groups,
    depts: new Map(
      depts.map((d) => [
        String(d.key),
        {
          head: nameOf(d.head_user_id),
          parent: d.parent_group_id ? (keyOf.get(String(d.parent_group_id)) ?? "?") : null,
        },
      ]),
    ),
    managers: new Map(members.map((m) => [String(m.username), nameOf(m.manager_id)])),
    titles: new Map(
      members.map((m) => [String(m.username), (m.job_title as string | null | undefined) ?? null]),
    ),
  };
  return { state, gid, uid };
}

async function apply(api: Api, tid: string, r: Read, a: OrgAction): Promise<void> {
  const need = (m: Map<string, string>, k: string): string => m.get(k) ?? fail(`thiếu ${k}`);
  const q = `tenant_id=${tid}`;
  if (a.op === "create_user") {
    const u = await call(api, "POST", `/admin/users?${q}`, {
      username: a.username,
      display_name: a.name,
      role: "member",
      locale: "vi",
      email: orgEmail(a.username),
    });
    r.uid.set(a.username, createdUserId(u));
  } else if (a.op === "create_group") {
    const g = await call(api, "POST", `/admin/groups?${q}`, { key: a.key, name: { vi: a.name } });
    r.gid.set(a.key, String(g.id));
  } else if (a.op === "add_member") {
    await call(api, "POST", `/admin/groups/${need(r.gid, a.group)}/members`, {
      usernames: [a.username],
    });
  } else if (a.op === "set_dept") {
    await call(api, "PUT", `/admin/org/departments/${need(r.gid, a.key)}?${q}`, {
      head_user_id: need(r.uid, a.head),
      parent_group_id: a.parent === null ? null : need(r.gid, a.parent),
    });
  } else if (a.op === "set_manager") {
    await call(api, "PUT", `/admin/org/managers/${need(r.uid, a.username)}?${q}`, {
      manager_id: need(r.uid, a.manager),
    });
  } else {
    await call(api, "PUT", `/admin/org/members/${need(r.uid, a.username)}/title?${q}`, {
      job_title: a.title,
    });
  }
}

export async function evoluOrg(api: Api, sql: Sql, tid: string): Promise<void> {
  const r = await orgState(api, tid);
  const plan = planOrg(r.state);
  if (plan.missingPackGroups.length)
    fail(`evolu chưa có nhóm gói: ${plan.missingPackGroups.join(", ")}`);
  for (const a of plan.actions) await apply(api, tid, r, a);
  const fresh = plan.actions.flatMap((a) => (a.op === "create_user" ? [a.username] : []));
  if (fresh.length) {
    const pw = process.env.UAT_EVOLU_PW || fail("thiếu UAT_EVOLU_PW");
    const hash = await hashPassword(pw);
    await sql`update admin.users set password_hash = ${hash}, must_change_password = false, locale = 'vi', updated_at = now()
      where tenant_id = ${tid}::uuid and username = any(${fresh}::text[])`;
  }
  console.log(
    `seed-demo-partner: evolu — sơ đồ tổ chức ${plan.actions.length} thao tác THÊM (${fresh.length} người mới)`,
  );
}
