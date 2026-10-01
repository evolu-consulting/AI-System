// ADM-FR-36, ADM-BR-11, ADM-BR-12 · GET /admin/users/:id/effective-access (M3-AC04; M3-R11, R12; test-plan I-EA).
// Số liệu tính trước ở test-plan §3. Mỗi `it` tự dựng lại dữ liệu (beforeEach reset).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { EffectiveAccessSchema } from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  ID,
  ID3,
  type M3Env,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
let hoa: ReturnType<typeof callerOf>;
let lan: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
  hoa = callerOf(env, "globex", "hoa");
  lan = callerOf(env, "acme", "lan");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

type EA = ReturnType<typeof EffectiveAccessSchema.parse>;
const ea = async (call: typeof admin, uid: string, qs = ""): Promise<EA> => {
  const res = await call("GET", `/admin/users/${uid}/effective-access${qs}`);
  expect(res.status).toBe(200);
  return EffectiveAccessSchema.parse(res.json);
};
const feat = (a: EA, key: string) => {
  const f = a.features.find((x) => x.feature.key === key);
  if (!f) throw new Error(`thiếu feature ${key}`);
  return f;
};
const cmd = (a: EA, name: string) => {
  const c = a.commands.find((x) => x.name === name);
  if (!c) throw new Error(`thiếu command ${name}`);
  return c;
};
const visible = (a: EA) => a.commands.filter((c) => c.visible).map((c) => c.name);
const reasonCodes = (f: { reasons: { code: string }[] }) => f.reasons.map((r) => r.code);

describe("ADM-FR-36 · lan (nhóm ke-toan) (M3-R11, R12)", () => {
  it("ADM-FR-36 · M3-R12 · features: core [core] + ke-toan [grant_group ke-toan] hiệu lực; còn lại missing đúng thứ tự (bao-cao, dich-thuat, phap-che, thu-nghiem)", async () => {
    const a = await ea(binh, USER_ID.lan);
    expect(a.blockers).toEqual([]);
    expect(a.features.map((f) => [f.feature.key, f.effective])).toEqual([
      ["core", true],
      ["bao-cao", false],
      ["dich-thuat", false],
      ["ke-toan", true],
      ["phap-che", false],
      ["thu-nghiem", false],
    ]);
    expect(feat(a, "core").reasons).toEqual([{ code: "core" }]);
    const kt = feat(a, "ke-toan").reasons[0];
    expect(kt?.code === "grant_group" && kt.group.key).toBe("ke-toan");
    expect(feat(a, "bao-cao").missing).toEqual(["beta_not_member", "no_grant"]);
    expect(feat(a, "dich-thuat").missing).toEqual(["no_grant"]);
    expect(feat(a, "phap-che").missing).toEqual(["no_entitlement", "no_grant"]);
    expect(feat(a, "thu-nghiem").missing).toEqual(["feature_off", "no_grant"]);
  });

  it("ADM-FR-36 · M3-R12 · commands (sắp name, command_total 5): thấy dich, kiemtra-hoadon, tom-tat; tr-nhanh [command_disabled, no_effective_feature]; xuat-bao-cao [command_disabled, workflow_disabled, no_effective_feature]", async () => {
    const a = await ea(binh, USER_ID.lan);
    expect(a.commands.map((c) => c.name)).toEqual([
      "dich",
      "kiemtra-hoadon",
      "tom-tat",
      "tr-nhanh",
      "xuat-bao-cao",
    ]);
    expect(a.command_total).toBe(5);
    expect(visible(a)).toEqual(["dich", "kiemtra-hoadon", "tom-tat"]);
    expect(cmd(a, "tr-nhanh").missing).toEqual(["command_disabled", "no_effective_feature"]);
    expect(cmd(a, "xuat-bao-cao").missing).toEqual([
      "command_disabled",
      "workflow_disabled",
      "no_effective_feature",
    ]);
    const via = cmd(a, "kiemtra-hoadon").via;
    expect(via.map((v) => v.feature.key)).toEqual(["ke-toan"]);
    expect(cmd(a, "dich").aliases).toEqual(["tr"]);
  });

  it("ADM-FR-36 · M3-R12 · user.groups là GroupRef (ke-toan, is_beta false); agents đúng {available:false}; config_version = giá trị config_meta", async () => {
    const a = await ea(binh, USER_ID.lan);
    expect(a.user).toMatchObject({ username: "lan", tenant_key: "acme", status: "active" });
    expect(a.user.groups.map((g) => [g.key, g.is_beta])).toEqual([["ke-toan", false]]);
    expect(a.agents).toEqual({ available: false });
    expect(a.config_version).toBe(await env.cfg());
  });
});

describe("ADM-FR-34 · thu (ke-toan + beta-testers): beta cần grant VÀ thành viên (A7)", () => {
  it("ADM-FR-34 · M3-R11 · bao-cao hiệu lực reasons [grant_group beta-testers, beta_member]; xuat-bao-cao [command_disabled, workflow_disabled] (có via nên không no_effective_feature)", async () => {
    const a = await ea(binh, USER_ID.thu);
    const bc = feat(a, "bao-cao");
    expect(bc.effective).toBe(true);
    expect(reasonCodes(bc)).toEqual(["grant_group", "beta_member"]);
    const g = bc.reasons[0];
    expect(g?.code === "grant_group" && g.group.key).toBe("beta-testers");
    expect(cmd(a, "xuat-bao-cao").missing).toEqual(["command_disabled", "workflow_disabled"]);
    expect(visible(a)).toEqual(["dich", "kiemtra-hoadon", "tom-tat"]);
  });

  it("ADM-FR-34 · M3-R11 · bớt thu khỏi beta-testers (API) → bao-cao không hiệu lực [beta_not_member, no_grant]; thêm lan vào beta → bao-cao hiệu lực", async () => {
    const beta = await betaId(env.owner, "acme");
    expect((await binh("DELETE", `/admin/groups/${beta}/members/${USER_ID.thu}`)).status).toBe(204);
    expect(feat(await ea(binh, USER_ID.thu), "bao-cao").missing).toEqual([
      "beta_not_member",
      "no_grant",
    ]);
    expect(
      (await binh("POST", `/admin/groups/${beta}/members`, { usernames: ["lan"] })).status,
    ).toBe(200);
    expect(feat(await ea(binh, USER_ID.lan), "bao-cao").effective).toBe(true);
  });
});

describe("ADM-FR-36 · an (grant trực tiếp) và gợi ý (M3-R12, F4)", () => {
  it("ADM-FR-36 · M3-R12 · dich-thuat hiệu lực [grant_user]; kiemtra-hoadon không thấy [no_effective_feature], blocked_by [{ke-toan,[no_grant]}], suggestion ke-toan; tr-nhanh [command_disabled]", async () => {
    const a = await ea(binh, USER_ID.an);
    expect(reasonCodes(feat(a, "dich-thuat"))).toEqual(["grant_user"]);
    expect(visible(a)).toEqual(["dich", "tom-tat"]);
    const k = cmd(a, "kiemtra-hoadon");
    expect(k.missing).toEqual(["no_effective_feature"]);
    expect(k.blocked_by.map((b) => [b.feature.key, b.missing])).toEqual([
      ["ke-toan", ["no_grant"]],
    ]);
    expect(k.suggestion).toMatchObject({ action: "grant_feature", feature: { key: "ke-toan" } });
    expect(cmd(a, "tr-nhanh").missing).toEqual(["command_disabled"]);
    expect(cmd(a, "tr-nhanh").suggestion).toBeNull();
  });

  it("ADM-FR-36 · M3-R11 · cấp ke-toan cho nhóm có an (API): an thấy kiemtra-hoadon ngay; bớt lan khỏi ke-toan → lan hết thấy", async () => {
    expect(
      (await binh("POST", `/admin/groups/${ID3.group.acmeKeToan}/members`, { usernames: ["an"] }))
        .status,
    ).toBe(200);
    expect(visible(await ea(binh, USER_ID.an))).toContain("kiemtra-hoadon");
    expect(
      (await binh("DELETE", `/admin/groups/${ID3.group.acmeKeToan}/members/${USER_ID.lan}`)).status,
    ).toBe(204);
    expect(visible(await ea(binh, USER_ID.lan))).not.toContain("kiemtra-hoadon");
  });

  it("ADM-FR-33 · M3-R11 · tắt feature ke-toan (M2) → lan: ke-toan missing [feature_off], hết thấy kiemtra-hoadon; bật lại → thấy", async () => {
    const f = (await admin("GET", `/admin/features/${ID.feature.keToan}`)).json;
    const off = await admin("PATCH", `/admin/features/${ID.feature.keToan}`, {
      version: f.version,
      status: "off",
    });
    expect(off.status).toBe(200);
    const a = await ea(binh, USER_ID.lan);
    expect(feat(a, "ke-toan").missing).toEqual(["feature_off"]);
    expect(visible(a)).not.toContain("kiemtra-hoadon");
    const on = await admin("PATCH", `/admin/features/${ID.feature.keToan}`, {
      version: off.json.version,
      status: "on",
    });
    expect(on.status).toBe(200);
    expect(visible(await ea(binh, USER_ID.lan))).toContain("kiemtra-hoadon");
  });
});

describe("ADM-FR-36 · user bị chặn và catalog (M3-R11)", () => {
  it("ADM-FR-36 · M3-AC04 · em (inactive, thành viên ke-toan): blockers [user_inactive], không thấy command nào, mọi feature missing bắt đầu bằng user_inactive; user.status 'locked'", async () => {
    const a = await ea(binh, USER_ID.em);
    expect(a.blockers).toEqual(["user_inactive"]);
    expect(visible(a)).toEqual([]);
    expect(a.features.every((f) => f.missing[0] === "user_inactive")).toBe(true);
    expect(a.user.status).toBe("locked");
    expect(a.commands.every((c) => c.missing[0] === "user_inactive")).toBe(true);
  });

  it("ADM-FR-36 · M3-AC04 · zoe (tenant zeta khoá, locked_by_tenant): blockers [tenant_locked], không thấy gì", async () => {
    const a = await ea(admin, USER_ID.zoe);
    expect(a.blockers).toEqual(["tenant_locked"]);
    expect(visible(a)).toEqual([]);
  });

  it("ADM-FR-36 · M3-R11 · binh/chi/dung (không group): chỉ core, thấy dich + tom-tat; platform admin: chỉ core, feature khác có no_entitlement", async () => {
    const [pt] = await env.owner<
      { id: string }[]
    >`select id from admin.tenants where key = 'platform'`;
    const platformTenant = pt?.id as string;
    for (const id of [USER_ID.binh, USER_ID.chi, USER_ID.dung]) {
      expect(visible(await ea(binh, id))).toEqual(["dich", "tom-tat"]);
    }
    const users = (await admin("GET", `/admin/users?tenant_id=${platformTenant}&limit=50`)).json
      .items as Array<{ id: string; username: string }>;
    const root = (users.find((u) => u.username === "admin") as { id: string }).id;
    const a = await ea(admin, root);
    expect(visible(a)).toEqual(["dich", "tom-tat"]);
    expect(feat(a, "ke-toan").missing).toContain("no_entitlement");
  });

  it("ADM-BR-12 · M3-R11 · khang (globex): ke-toan KHÔNG hiệu lực, reasons [grant_group ke-toan] giữ, missing [no_entitlement] (A11); thấy dich + tom-tat", async () => {
    const a = await ea(hoa, USER_ID.khang);
    const f = feat(a, "ke-toan");
    expect(f.effective).toBe(false);
    expect(reasonCodes(f)).toEqual(["grant_group"]);
    expect(f.missing).toEqual(["no_entitlement"]);
    expect(visible(a)).toEqual(["dich", "tom-tat"]);
  });

  it("ADM-FR-36 · M3-R12 · features gồm MỌI feature catalog (6), core đầu rồi key tăng dần", async () => {
    const a = await ea(binh, USER_ID.binh);
    expect(a.features.map((f) => f.feature.key)).toEqual([
      "core",
      "bao-cao",
      "dich-thuat",
      "ke-toan",
      "phap-che",
      "thu-nghiem",
    ]);
  });

  it("ADM-FR-36 · M3-R12 · trần 1.000 command: owner chèn 1.001 command → commands.length 1000, command_total = 1006", async () => {
    await env.owner`insert into admin.commands (name, description, workflow_id, output)
      select 'cmd-' || lpad(g::text, 4, '0'), ${env.owner.json({ vi: "x" })}, ${ID.workflow.reportTax},
        ${env.owner.json({ field: "text", render: "text" })} from generate_series(1, 1001) g`;
    const a = await ea(binh, USER_ID.binh);
    expect(a.commands).toHaveLength(1000);
    expect(a.command_total).toBe(1006);
  });
});

describe("ADM-FR-36 · ?command= (M3-R12, F4)", () => {
  it("ADM-FR-36 · M3-R12 · khớp tên, alias, có '/' đầu, viết hoa → đúng một command (dich), command_total 1", async () => {
    for (const q of ["dich", "tr", "/dich", "DICH", " /Tr "]) {
      const a = await ea(binh, USER_ID.lan, `?command=${encodeURIComponent(q)}`);
      expect([q, a.commands.map((c) => c.name), a.command_total]).toEqual([q, ["dich"], 1]);
    }
  });

  it("ADM-FR-36 · M3-R12 · command không tồn tại → commands [], command_total 0 (KHÔNG 404); sai định dạng → 400", async () => {
    const a = await ea(binh, USER_ID.lan, "?command=khong-co");
    expect([a.commands, a.command_total]).toEqual([[], 0]);
    expectErr(
      await binh("GET", `/admin/users/${USER_ID.lan}/effective-access?command=a_b`),
      "VALIDATION_ERROR",
    );
    expectErr(
      await binh("GET", `/admin/users/${USER_ID.lan}/effective-access?foo=1`),
      "VALIDATION_ERROR",
    );
  });

  it("ADM-FR-36 · M3-R12 · ?command=kiemtra-hoadon cho an trả đúng lý do + gợi ý (F4)", async () => {
    const a = await ea(binh, USER_ID.an, "?command=kiemtra-hoadon");
    expect(a.commands).toHaveLength(1);
    expect(a.commands[0]?.suggestion?.feature.key).toBe("ke-toan");
  });
});

describe("ADM-BR-09 · phạm vi và role (M3-R06, R12)", () => {
  it("ADM-BR-09 · M3-R12 · tenant_admin acme xem user globex → 404; xem user mình/tenant mình → 200; platform xem user mọi tenant", async () => {
    expectErr(await binh("GET", `/admin/users/${USER_ID.khang}/effective-access`), "NOT_FOUND");
    expect((await binh("GET", `/admin/users/${USER_ID.thu}/effective-access`)).status).toBe(200);
    expect((await hoa("GET", `/admin/users/${USER_ID.khang}/effective-access`)).status).toBe(200);
    expect((await admin("GET", `/admin/users/${USER_ID.khang}/effective-access`)).status).toBe(200);
    expect((await admin("GET", `/admin/users/${USER_ID.thu}/effective-access`)).status).toBe(200);
  });

  it("ADM-BR-09 · M3-R12 · member → 403; không token → 401; user lạ / 'abc' → 404", async () => {
    expectErr(await lan("GET", `/admin/users/${USER_ID.lan}/effective-access`), "FORBIDDEN");
    expectErr(
      await env.call("GET", `/admin/users/${USER_ID.lan}/effective-access`),
      "UNAUTHORIZED",
    );
    expectErr(await binh("GET", `/admin/users/${ID3.unknown}/effective-access`), "NOT_FOUND");
    expectErr(await admin("GET", "/admin/users/abc/effective-access"), "NOT_FOUND");
  });

  it("ADM-FR-36 · M3-R11 · thu hồi entitlement ke-toan của acme (API) → lan: ke-toan [no_entitlement] với reasons giữ; cấp lại → hiệu lực trở lại không cần cấp lại grant", async () => {
    const url = `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`;
    await admin("DELETE", url);
    const off = feat(await ea(binh, USER_ID.lan), "ke-toan");
    expect([off.effective, off.missing, reasonCodes(off)]).toEqual([
      false,
      ["no_entitlement"],
      ["grant_group"],
    ]);
    await admin("PUT", url);
    expect(feat(await ea(binh, USER_ID.lan), "ke-toan").effective).toBe(true);
  });
});
