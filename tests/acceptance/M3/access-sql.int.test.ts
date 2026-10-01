// ADM-FR-36, ADM-BR-11 · đối chiếu BA ba nguồn: hàm thuần computeEffectiveAccess ↔ SQL tham chiếu (plan §3.2, chạy bằng
// hub_ro như Hub) ↔ API effective-access, trên 68 tổ hợp dựng TẤT ĐỊNH bằng owner SQL (không ngẫu nhiên, không đồng hồ).
// Họ A: status{on,off,beta} × entitled × grant{không,user,group} × thành viên beta = 36. Họ B: user.active ×
// locked_by_tenant × tenant.active × command.enabled × workflow.enabled = 32 (feature on + entitled + grant group).
// Chỉ đọc sau khi dựng một lần (beforeAll). Test-plan I-SQL; M3-AC04.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { EffectiveAccessSchema } from "@ai/contracts";
import { callerOf, createM3Env, hubVisible, ID, type M3Env } from "./_fixtures";
import { loadAccessRules } from "./_modules";

type Status = "on" | "off" | "beta";
type Grant = "none" | "user" | "group";
type Combo = {
  i: number;
  fam: "A" | "B";
  status: Status;
  entitled: boolean;
  grant: Grant;
  beta: boolean;
  userActive: boolean;
  locked: boolean;
  tenantActive: boolean;
  cmdEnabled: boolean;
  wfEnabled: boolean;
};

const BOOL = [true, false] as const;
/** Tích Descartes tất định của các chiều (thứ tự: chiều đầu đổi chậm nhất). */
function product<T extends Record<string, readonly unknown[]>>(
  dims: T,
): Array<{ [K in keyof T]: T[K][number] }> {
  let acc: Array<Record<string, unknown>> = [{}];
  for (const [k, vals] of Object.entries(dims)) {
    acc = acc.flatMap((o) => vals.map((v) => ({ ...o, [k]: v })));
  }
  return acc as Array<{ [K in keyof T]: T[K][number] }>;
}
function combos(): Combo[] {
  const base = {
    userActive: true,
    locked: false,
    tenantActive: true,
    cmdEnabled: true,
    wfEnabled: true,
  };
  const a = product({
    status: ["on", "off", "beta"] as Status[],
    entitled: BOOL,
    grant: ["none", "user", "group"] as Grant[],
    beta: BOOL,
  }).map((d) => ({ ...base, ...d, fam: "A" as const }));
  const b = product({
    userActive: BOOL,
    locked: BOOL,
    tenantActive: BOOL,
    cmdEnabled: BOOL,
    wfEnabled: BOOL,
  }).map((d) => ({
    ...d,
    fam: "B" as const,
    status: "on" as Status,
    entitled: true,
    grant: "group" as Grant,
    beta: false,
  }));
  return [...a, ...b].map((c, i) => ({ ...c, i }));
}
const COMBOS = combos();
const uid = (kind: number, i: number) =>
  `01900000-0000-7000-8000-${String(kind * 1000 + i).padStart(12, "0")}`;
const T = (i: number) => uid(5, i);
const U = (i: number) => uid(6, i);
const F = (i: number) => uid(7, i);
const W = (i: number) => uid(8, i);
const C = (i: number) => uid(9, i);
const G = (i: number) => uid(4, i);

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
const betaOf = new Map<string, string>();

beforeAll(async () => {
  env = await createM3Env({ perms: {} });
  admin = callerOf(env, "platform", "admin");
  const o = env.owner;
  const n = COMBOS.length;
  const idx = COMBOS.map((c) => c.i);
  await o`insert into admin.tenants (id, key, name, active)
    select * from unnest(${idx.map(T)}::uuid[], ${idx.map((i) => `cmb${i}`)}::text[],
      ${idx.map((i) => `Combo ${i}`)}::text[], ${COMBOS.map((c) => c.tenantActive)}::boolean[])`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, active, locked_by_tenant)
    select * from unnest(${idx.map(U)}::uuid[], ${idx.map(T)}::uuid[], ${idx.map((i) => `user${i}`)}::text[],
      ${idx.map(() => "h")}::text[], ${idx.map((i) => `User ${i}`)}::text[], ${idx.map(() => "member")}::text[],
      ${COMBOS.map((c) => c.userActive)}::boolean[], ${COMBOS.map((c) => c.locked)}::boolean[])`;
  await o`insert into admin.features (id, key, name, status)
    select f, k, jsonb_build_object('vi', k), s from unnest(${idx.map(F)}::uuid[], ${idx.map((i) => `fx${i}`)}::text[],
      ${COMBOS.map((c) => c.status)}::text[]) as t(f, k, s)`;
  await o`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, enabled)
    select w, k, k, 'Workflow tổ hợp dùng để đối chiếu hiệu lực', 'workflow', 'https://dify.example.com/v1', ${ID.secret.translate}, e
    from unnest(${idx.map(W)}::uuid[], ${idx.map((i) => `wx${i}`)}::text[], ${COMBOS.map((c) => c.wfEnabled)}::boolean[]) as t(w, k, e)`;
  await o`insert into admin.commands (id, name, description, workflow_id, output, enabled)
    select c, k, jsonb_build_object('vi', k), w, '{"field":"text","render":"text"}'::jsonb, e
    from unnest(${idx.map(C)}::uuid[], ${idx.map((i) => `cx${i}`)}::text[], ${idx.map(W)}::uuid[],
      ${COMBOS.map((c) => c.cmdEnabled)}::boolean[]) as t(c, k, w, e)`;
  await o`insert into admin.command_names (name, command_id)
    select * from unnest(${idx.map((i) => `cx${i}`)}::text[], ${idx.map(C)}::uuid[])`;
  await o`insert into admin.feature_commands (feature_id, command_id)
    select * from unnest(${idx.map(F)}::uuid[], ${idx.map(C)}::uuid[])`;
  const ent = COMBOS.filter((c) => c.entitled).map((c) => c.i);
  await o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select * from unnest(${ent.map(F)}::uuid[], ${ent.map(T)}::uuid[])`;
  for (const r of await o<
    { id: string; tenant_id: string }[]
  >`select id, tenant_id from admin.groups
    where key = 'beta-testers'`) {
    betaOf.set(r.tenant_id, r.id);
  }
  const grp = COMBOS.filter((c) => c.grant === "group").map((c) => c.i);
  await o`insert into admin.groups (id, tenant_id, key, name)
    select g, t, 'gx', '{"vi":"gx"}'::jsonb from unnest(${grp.map(G)}::uuid[], ${grp.map(T)}::uuid[]) as x(g, t)`;
  await o`insert into admin.group_members (tenant_id, group_id, user_id)
    select * from unnest(${grp.map(T)}::uuid[], ${grp.map(G)}::uuid[], ${grp.map(U)}::uuid[])`;
  const gu = COMBOS.filter((c) => c.grant === "user").map((c) => c.i);
  await o`insert into admin.feature_grants (tenant_id, feature_id, user_id)
    select * from unnest(${gu.map(T)}::uuid[], ${gu.map(F)}::uuid[], ${gu.map(U)}::uuid[])`;
  await o`insert into admin.feature_grants (tenant_id, feature_id, group_id)
    select * from unnest(${grp.map(T)}::uuid[], ${grp.map(F)}::uuid[], ${grp.map(G)}::uuid[])`;
  const bm = COMBOS.filter((c) => c.beta).map((c) => c.i);
  await o`insert into admin.group_members (tenant_id, group_id, user_id)
    select * from unnest(${bm.map(T)}::uuid[], ${bm.map((i) => betaOf.get(T(i)) as string)}::uuid[], ${bm.map(U)}::uuid[])`;
  expect(n).toBe(68);
});
afterAll(async () => {
  await env.close();
});

/** AccessInput suy ra từ chính tổ hợp (plan §4). */
function inputOf(c: Combo) {
  const betaId = betaOf.get(T(c.i)) as string;
  const groupIds = [...(c.grant === "group" ? [G(c.i)] : []), ...(c.beta ? [betaId] : [])];
  return {
    user: {
      id: U(c.i),
      active: c.userActive,
      lockedByTenant: c.locked,
      tenantActive: c.tenantActive,
      groupIds,
    },
    betaGroupId: betaId,
    features: [
      {
        id: F(c.i),
        key: `fx${c.i}`,
        status: c.status,
        entitled: c.entitled,
        grantGroupIds: c.grant === "group" ? [G(c.i)] : [],
        grantUser: c.grant === "user",
      },
    ],
    commands: [
      { id: C(c.i), enabled: c.cmdEnabled, workflowEnabled: c.wfEnabled, featureIds: [F(c.i)] },
    ],
  };
}
const fnResult = async (c: Combo) => (await loadAccessRules()).computeEffectiveAccess(inputOf(c));
type Loose = Record<string, unknown>;

/** BR-11 viết lại độc lập bằng công thức nguyên văn (không dùng hàm sản phẩm). */
function oracleVisible(c: Combo): boolean {
  const userOk = c.userActive && !c.locked && c.tenantActive;
  const featureOn = c.status === "on" || (c.status === "beta" && c.beta);
  const granted = c.grant !== "none";
  return userOk && featureOn && c.entitled && granted && c.cmdEnabled && c.wfEnabled;
}

describe("ADM-BR-11 · ba nguồn khớp nhau trên 68 tổ hợp (M3-R11)", () => {
  it("ADM-BR-11 · M3-R11 · hàm thuần computeEffectiveAccess = công thức BA nguyên văn cho cả 68 tổ hợp (visible của command)", async () => {
    const bad: string[] = [];
    for (const c of COMBOS) {
      const r = await fnResult(c);
      if ((r.commands[0] as Loose).visible !== oracleVisible(c)) bad.push(`#${c.i}`);
    }
    expect(bad).toEqual([]);
  });

  it("ADM-BR-11 · M3-R11 · tập command thấy được: SQL tham chiếu (hub_ro) = hàm thuần, cả 68 tổ hợp", async () => {
    const bad: string[] = [];
    for (const c of COMBOS) {
      const sqlSet = (await hubVisible(env.owner, U(c.i))).filter((n) => n === `cx${c.i}`);
      const fnVisible = (await fnResult(c)).commands
        .filter((x: Loose) => x.visible)
        .map(() => `cx${c.i}`);
      if (JSON.stringify(sqlSet) !== JSON.stringify(fnVisible)) bad.push(`#${c.i}`);
    }
    expect(bad).toEqual([]);
  });

  it("ADM-FR-36 · M3-R12 · API effective-access = hàm thuần về visible, effective, missing, mã lý do của feature, cả 68 tổ hợp", async () => {
    const bad: string[] = [];
    for (const c of COMBOS) {
      const res = await admin("GET", `/admin/users/${U(c.i)}/effective-access?command=cx${c.i}`);
      if (res.status !== 200) {
        bad.push(`#${c.i}: HTTP ${res.status}`);
        continue;
      }
      const a = EffectiveAccessSchema.parse(res.json);
      const f = a.features.find((x) => x.feature.key === `fx${c.i}`);
      const cm = a.commands.find((x) => x.name === `cx${c.i}`);
      const r = await fnResult(c);
      const rf = r.features[0] as Loose;
      const rc = r.commands[0] as Loose;
      const same =
        f?.effective === rf.effective &&
        JSON.stringify(f?.missing) === JSON.stringify(rf.missing) &&
        JSON.stringify(f?.reasons.map((x) => x.code)) ===
          JSON.stringify((rf.reasons as Loose[]).map((x) => x.code)) &&
        cm?.visible === rc.visible &&
        JSON.stringify(cm?.missing) === JSON.stringify(rc.missing);
      if (!same) bad.push(`#${c.i}`);
    }
    expect(bad).toEqual([]);
  });

  it("ADM-FR-34 · M3-R11 · họ A (36): status × entitled × grant × beta member khớp bảng chân trị BA (đếm số tổ hợp thấy được = 6)", async () => {
    const famA = COMBOS.filter((c) => c.fam === "A");
    expect(famA).toHaveLength(36);
    const seen = famA.filter((c) => oracleVisible(c));
    // on: entitled × (user|group) × beta{2} = 4; beta: entitled × (user|group) × member = 2; off: 0
    expect(seen).toHaveLength(6);
    for (const c of famA)
      expect([c.i, ((await fnResult(c)).commands[0] as Loose).visible]).toEqual([
        c.i,
        oracleVisible(c),
      ]);
  });

  it("ADM-FR-36 · M3-R11 · họ B (32): chỉ tổ hợp user active, không khoá, tenant active, command bật, workflow bật thấy được (đúng 1/32)", async () => {
    const famB = COMBOS.filter((c) => c.fam === "B");
    expect(famB).toHaveLength(32);
    const seen = famB.filter((c) => oracleVisible(c));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      userActive: true,
      locked: false,
      tenantActive: true,
      cmdEnabled: true,
      wfEnabled: true,
    });
    for (const c of famB) {
      const sqlSeen = (await hubVisible(env.owner, U(c.i))).includes(`cx${c.i}`);
      expect([c.i, sqlSeen]).toEqual([c.i, oracleVisible(c)]);
    }
  });
});

describe("ADM-FR-24 · visible_user_count bằng SQL (M3-R14)", () => {
  it("ADM-FR-24 · M3-R14 · tenant nhiều user: count(distinct u.id) theo SQL tham chiếu = số user mà SQL từng-user cho thấy command", async () => {
    // dựng thêm tenant `cnt`: 6 user (3 hợp lệ trong group; 1 inactive; 1 locked_by_tenant; 1 không trong group)
    const o = env.owner;
    const tid = uid(5, 900);
    const fid = uid(7, 900);
    const cid = uid(9, 900);
    const wid = uid(8, 900);
    const gid = uid(4, 900);
    await o`insert into admin.tenants (id, key, name) values (${tid}, 'cnt', 'Count')`;
    const us = [
      ["ok1", true, false, true],
      ["ok2", true, false, true],
      ["ok3", true, false, true],
      ["off", false, false, true],
      ["lck", true, true, true],
      ["out", true, false, false],
    ] as const;
    for (const [i, [name, active, locked]] of us.entries()) {
      await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, active, locked_by_tenant)
        values (${uid(6, 900 + i)}, ${tid}, ${name}, 'h', ${name}, 'member', ${active}, ${locked})`;
    }
    await o`insert into admin.features (id, key, name, status) values (${fid}, 'fcnt', '{"vi":"f"}'::jsonb, 'on')`;
    await o`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
      values (${wid}, 'wcnt', 'w', 'Workflow đếm số user thấy được command', 'workflow', 'https://dify.example.com/v1', ${ID.secret.translate})`;
    await o`insert into admin.commands (id, name, description, workflow_id, output)
      values (${cid}, 'ccnt', '{"vi":"c"}'::jsonb, ${wid}, '{"field":"text","render":"text"}'::jsonb)`;
    await o`insert into admin.command_names (name, command_id) values ('ccnt', ${cid})`;
    await o`insert into admin.feature_commands (feature_id, command_id) values (${fid}, ${cid})`;
    await o`insert into admin.feature_entitlements (feature_id, tenant_id) values (${fid}, ${tid})`;
    await o`insert into admin.groups (id, tenant_id, key, name) values (${gid}, ${tid}, 'gc', '{"vi":"g"}'::jsonb)`;
    for (const [i, [, , , inGroup]] of us.entries()) {
      if (inGroup)
        await o`insert into admin.group_members (tenant_id, group_id, user_id) values (${tid}, ${gid}, ${uid(6, 900 + i)})`;
    }
    await o`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${tid}, ${fid}, ${gid})`;
    const [row] = await o.begin(async (tx) => {
      await tx.unsafe("set local role hub_ro");
      return tx.unsafe(
        `select count(distinct u.id)::int as n
         from admin.users u
         join admin.tenants t on t.id = u.tenant_id and t.active
         cross join admin.feature_commands fc
         join admin.commands c on c.id = fc.command_id and c.enabled
         join admin.workflows w on w.id = c.workflow_id and w.enabled
         join admin.features f on f.id = fc.feature_id
         where t.id = $1 and c.id = $2 and u.active and not u.locked_by_tenant
           and (f.status = 'on' or (f.status = 'beta' and exists (
                 select 1 from admin.group_members m join admin.groups g on g.id = m.group_id
                 where m.user_id = u.id and g.tenant_id = u.tenant_id and g.key = 'beta-testers')))
           and (f.key = 'core' or (
                 exists (select 1 from admin.feature_entitlements e
                         where e.feature_id = f.id and e.tenant_id = u.tenant_id and e.revoked_at is null)
                 and exists (select 1 from admin.feature_grants fg
                         where fg.feature_id = f.id and fg.tenant_id = u.tenant_id
                           and (fg.user_id = u.id or fg.group_id in (
                                select m.group_id from admin.group_members m where m.user_id = u.id)))))`,
        [tid, cid],
      );
    });
    let perUser = 0;
    for (let i = 0; i < us.length; i++) {
      if ((await hubVisible(o, uid(6, 900 + i))).includes("ccnt")) perUser++;
    }
    expect((row as unknown as { n: number }).n).toBe(3);
    expect(perUser).toBe(3);
  });
});
