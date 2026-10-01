// ADM-FR-32, ADM-FR-36, ADM-BR-11, ADM-BR-12 · AC-A10, AC-A11, AC-A03 vế 2 — PHẦN DỮ LIỆU Hub (role hub_ro + SQL tham chiếu
// plan §3.2), chưa cần NOTIFY (M3-R17, R19 (2); test-plan I-HV). "menu /" và CMD_NOT_FOUND là của Hub (M5), không kiểm ở đây.
// Mỗi `it` tự dựng lại dữ liệu (beforeEach reset); ca cần tự cấp qua API dùng `grants: []`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { EffectiveAccessSchema } from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  hubVisible,
  ID,
  ID3,
  type M3Env,
  num,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

const KT = ID3.group.acmeKeToan;
const NO_GRANTS = { phapChe: true, groups: true, members: true, grants: false };
const sees = async (uid: string) => hubVisible(env.owner, uid);
const effective = async (uid: string) => {
  const res = await admin("GET", `/admin/users/${uid}/effective-access`);
  expect(res.status).toBe(200);
  return EffectiveAccessSchema.parse(res.json);
};
const grantIds = async () =>
  (await env.owner<{ id: string }[]>`select id from admin.feature_grants order by id`).map(
    (r) => r.id,
  );

describe("AC-A10 · cấp feature theo group (phía Admin, M3-R19 (2))", () => {
  it("AC-A10 · ADM-FR-32 · tenant_admin cấp ke-toan cho group ke-toan → SQL hub_ro: thành viên (lan) thấy kiemtra-hoadon; user khác trong acme (an) và user globex (khang) KHÔNG; effective-access đồng ý", async () => {
    await env.reset3({ perms: NO_GRANTS });
    expect(await sees(USER_ID.lan)).not.toContain("kiemtra-hoadon");
    const res = await binh("POST", "/admin/grants", {
      feature_id: ID.feature.keToan,
      group_id: KT,
    });
    expect(res.status).toBe(201);
    expect(await sees(USER_ID.lan)).toContain("kiemtra-hoadon");
    expect(await sees(USER_ID.an)).not.toContain("kiemtra-hoadon");
    expect(await sees(USER_ID.khang)).not.toContain("kiemtra-hoadon");
    const lan = (await effective(USER_ID.lan)).commands.find((c) => c.name === "kiemtra-hoadon");
    const an = (await effective(USER_ID.an)).commands.find((c) => c.name === "kiemtra-hoadon");
    expect([lan?.visible, an?.visible]).toEqual([true, false]);
  });

  it("AC-A10 · ADM-FR-32 · bớt lan khỏi group (API) → SQL hub_ro không còn kiemtra-hoadon; thêm lại → có", async () => {
    expect(await sees(USER_ID.lan)).toContain("kiemtra-hoadon");
    expect((await binh("DELETE", `/admin/groups/${KT}/members/${USER_ID.lan}`)).status).toBe(204);
    expect(await sees(USER_ID.lan)).not.toContain("kiemtra-hoadon");
    expect((await binh("POST", `/admin/groups/${KT}/members`, { usernames: ["lan"] })).status).toBe(
      200,
    );
    expect(await sees(USER_ID.lan)).toContain("kiemtra-hoadon");
  });
});

describe("AC-A11 · thu hồi entitlement giữ grant (phía Admin, BR-12)", () => {
  it("AC-A11 · ADM-BR-12 · platform thu hồi entitlement ke-toan của acme → SQL: lan MẤT kiemtra-hoadon; hàng grant còn NGUYÊN (cùng id, cùng số hàng); effective-access: effective false, reasons [grant_group], missing [no_entitlement]", async () => {
    const before = await grantIds();
    const url = `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`;
    expect(await sees(USER_ID.lan)).toContain("kiemtra-hoadon");
    expect((await admin("DELETE", url)).status).toBe(204);
    expect(await sees(USER_ID.lan)).not.toContain("kiemtra-hoadon");
    expect(await grantIds()).toEqual(before);
    const f = (await effective(USER_ID.lan)).features.find((x) => x.feature.key === "ke-toan");
    expect([f?.effective, f?.missing, f?.reasons.map((r) => r.code)]).toEqual([
      false,
      ["no_entitlement"],
      ["grant_group"],
    ]);
  });

  it("AC-A11 · ADM-BR-12 · cấp lại entitlement → SQL có lại kiemtra-hoadon mà KHÔNG cấp lại grant: cùng id grant, không hàng mới, không gọi POST /admin/grants", async () => {
    const before = await grantIds();
    const url = `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`;
    await admin("DELETE", url);
    expect((await admin("PUT", url)).status).toBe(200);
    expect(await sees(USER_ID.lan)).toContain("kiemtra-hoadon");
    expect(await grantIds()).toEqual(before);
    expect(
      await num(
        env.owner,
        `select count(*)::int as n from admin.feature_grants where id = '${ID3.grant.g1}'`,
      ),
    ).toBe(1);
  });
});

describe("AC-A03 vế 2 · dữ liệu Hub thấy (M3-R19 (2))", () => {
  it("AC-A03 · ADM-FR-20 · command mới dich-v2 (workflow translate, map đủ) thuộc core → SQL hub_ro: mọi user active của tenant active thấy (acme 6, globex 3, platform 2); user zeta (tenant khoá) và em (inactive) không", async () => {
    const res = await admin("POST", "/admin/commands", {
      name: "dich-v2",
      description: { vi: "Dịch v2" },
      workflow_id: ID.workflow.translate,
      args: [
        { name: "lang", description: { vi: "Ngôn ngữ" } },
        { name: "text", description: { vi: "Văn bản" }, rest: true },
      ],
      input_map: {
        source_text: { source: "arg", value: "text" },
        target_lang: { source: "arg", value: "lang" },
      },
      output: { field: "text", render: "markdown" },
    });
    expect(res.status).toBe(201);
    const users = await env.owner<
      { id: string; key: string; username: string }[]
    >`select u.id, t.key, u.username
      from admin.users u join admin.tenants t on t.id = u.tenant_id`;
    const seen: Record<string, number> = {};
    for (const u of users) {
      if ((await sees(u.id)).includes("dich-v2")) seen[u.key] = (seen[u.key] ?? 0) + 1;
    }
    expect(seen).toEqual({ acme: 6, globex: 3, platform: 2 });
  });
});

describe("BR-11 · các công tắc phía Hub thấy (M3-R11)", () => {
  it("ADM-FR-33 · M3-R11 · kill switch: tắt feature ke-toan (API) → SQL mất kiemtra-hoadon; bật lại → có", async () => {
    const f = (await admin("GET", `/admin/features/${ID.feature.keToan}`)).json;
    const off = await admin("PATCH", `/admin/features/${ID.feature.keToan}`, {
      version: f.version,
      status: "off",
    });
    expect(await sees(USER_ID.lan)).not.toContain("kiemtra-hoadon");
    await admin("PATCH", `/admin/features/${ID.feature.keToan}`, {
      version: off.json.version,
      status: "on",
    });
    expect(await sees(USER_ID.lan)).toContain("kiemtra-hoadon");
  });

  it("ADM-FR-34 · M3-R11 · beta: bật command + workflow của bao-cao; chỉ thành viên beta-testers CÓ grant (thu) thấy xuat-bao-cao; lan (không thành viên) và an không", async () => {
    await env.owner`update admin.commands set enabled = true where id = ${ID.command.xuatBaoCao}`;
    await env.owner`update admin.workflows set enabled = true where id = ${ID.workflow.reportExport}`;
    expect(await sees(USER_ID.thu)).toContain("xuat-bao-cao");
    expect(await sees(USER_ID.lan)).not.toContain("xuat-bao-cao");
    expect(await sees(USER_ID.an)).not.toContain("xuat-bao-cao");
    const beta = await betaId(env.owner, "acme");
    await binh("POST", `/admin/groups/${beta}/members`, { usernames: ["lan"] });
    expect(await sees(USER_ID.lan)).toContain("xuat-bao-cao");
  });

  it("ADM-FR-36 · M3-R11 · command tắt (API) hoặc workflow tắt (owner) → SQL không còn command; effective-access ghi đúng lý do", async () => {
    const c = (await admin("GET", `/admin/commands/${ID.command.kiemtraHoadon}`)).json;
    const off = await admin("PATCH", `/admin/commands/${ID.command.kiemtraHoadon}`, {
      version: c.version,
      enabled: false,
    });
    expect(off.status).toBe(200);
    expect(await sees(USER_ID.lan)).not.toContain("kiemtra-hoadon");
    expect(
      (await effective(USER_ID.lan)).commands.find((x) => x.name === "kiemtra-hoadon")?.missing,
    ).toContain("command_disabled");
    await env.owner`update admin.commands set enabled = true where id = ${ID.command.kiemtraHoadon}`;
    await env.owner`update admin.workflows set enabled = false where id = ${ID.workflow.invoiceCheck}`;
    expect(await sees(USER_ID.lan)).not.toContain("kiemtra-hoadon");
    expect(
      (await effective(USER_ID.lan)).commands.find((x) => x.name === "kiemtra-hoadon")?.missing,
    ).toContain("workflow_disabled");
  });
});

describe("M3-AC06 · hub_ro đọc config_meta, vẫn không đọc secrets (M3-R17)", () => {
  it("M3-AC06 · ADM-NFR-07 · hub_ro đọc config_version = giá trị owner; ghi bị từ chối (42501)", async () => {
    const seenByHub = await env.owner.begin(async (tx) => {
      await tx.unsafe("set local role hub_ro");
      const [r] = await tx<{ v: number }[]>`select config_version as v from admin.config_meta`;
      return r?.v;
    });
    expect(seenByHub).toBe(await env.cfg());
    const code = await env.owner
      .begin(async (tx) => {
        await tx.unsafe("set local role hub_ro");
        await tx`update admin.config_meta set config_version = config_version + 1`;
      })
      .then(() => null)
      .catch((e: { code?: string }) => e.code ?? "unknown");
    expect(code).toBe("42501");
  });

  it("M3-AC06 · ADM-NFR-07 · hub_ro vẫn không đọc được admin.secrets (42501)", async () => {
    const code = await env.owner
      .begin(async (tx) => {
        await tx.unsafe("set local role hub_ro");
        await tx`select name from admin.secrets`;
      })
      .then(() => null)
      .catch((e: { code?: string }) => e.code ?? "unknown");
    expect(code).toBe("42501");
    expectErr(await binh("GET", "/admin/secrets"), "FORBIDDEN");
  });
});
