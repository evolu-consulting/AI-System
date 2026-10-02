// ADM-FR-53 · M3-AC05 · AC-A03 vế 2 · AC-A10 · AC-A11 · tính chất của NOTIFY `config_changed` (test-plan I-N, N-C P1–P15):
// payload strict, không rò tên/secret, rollback, retry 40P01/40001 (hook ở `bump`), NOTIFY SAU commit, ≤ 1000 ms, lỗi gửi không
// làm hỏng response, upsert config_meta. Ca CÓ YẾU TỐ THỜI GIAN: P10, P13–P15 (ngưỡng 1000 ms, rộng gấp ~100 lần giá trị thường).
// Mỗi `it` tự reset dữ liệu; kiểm "không phát" bằng sentinel (không sleep).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb } from "@ai/db";
import {
  ADMIN_API_URL,
  callerOf,
  createM3Env,
  expectErr,
  hubVisible,
  ID,
  ID3,
  LEAK_1,
  type Listener,
  leakForms,
  type M3Env,
  num,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";
import { onNotify, track, verOf } from "./_notify";

let env: M3Env;
let lis: Listener;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  lis = await env.listen();
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
const deadlock = (code: string) => Object.assign(new Error("test deadlock"), { code });
/** Hook ném `code` ĐÚNG MỘT LẦN tại (op, step). */
function failOnce(op: string, step: string, code: string) {
  const state = { fired: 0 };
  return {
    state,
    hooks: {
      afterLock: (o: string, s: string) => {
        if (o === op && s === step && state.fired === 0) {
          state.fired += 1;
          throw deadlock(code);
        }
      },
    },
  };
}
async function userCall(
  hooks: { afterLock: (o: string, s: string) => void },
  tenant: string,
  username: string,
) {
  const app = await env.makeApp({ hooks });
  const token = await env.token(tenant, username);
  return {
    close: app.close,
    call: (method: string, path: string, body?: unknown) => app.call(method, path, { token, body }),
  };
}

describe("ADM-FR-53 · payload (M3-R16)", () => {
  it("ADM-FR-53 · M3-R16 · P1 · mọi thông điệp qua ConfigChangedPayloadSchema strict (listener đã parse), ≤ 8.000 byte, v nguyên ≥ 1", async () => {
    const from = lis.msgs.length;
    await track(env, lis, () =>
      binh("POST", "/admin/groups", { key: "p1-group", name: { vi: "P1" } }),
    );
    await track(env, lis, () =>
      binh("POST", "/admin/grants", { feature_id: ID.feature.dichThuat, group_id: KT }),
    );
    await track(env, lis, () =>
      admin("DELETE", `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`),
    );
    const mine = lis.msgs.slice(from);
    expect(mine.length).toBeGreaterThanOrEqual(3);
    for (const m of mine) {
      expect(Buffer.byteLength(m.raw)).toBeLessThanOrEqual(8000);
      expect(Number.isInteger(m.payload.v) && m.payload.v >= 1).toBe(true);
      expect(
        Object.keys(JSON.parse(m.raw)).every((k) => ["v", "entity", "tenant_id"].includes(k)),
      ).toBe(true);
    }
  });

  it("ADM-FR-53 · M3-R16 · P2 · payload KHÔNG chứa tên/username/secret: tenant, user, group, feature, workflow, secret mang tên đặc trưng → thông điệp không có các chuỗi đó, không có LEAK_1 thô/base64/hex", async () => {
    const from = lis.msgs.length;
    const secretName = "DIFY_NOTIFY_KEY";
    const t = await admin("POST", "/admin/tenants", {
      key: "notify-co",
      name: "Notify Công Ty",
      first_admin: {
        username: "notify.user",
        display_name: "Notify User",
        email: "n@notify.test",
        locale: "en",
      },
    });
    expect(t.status).toBe(201);
    await admin("POST", `/admin/groups?tenant_id=${t.json.tenant.id}`, {
      key: "nhom-bi-mat",
      name: { vi: "Nhóm bí mật" },
    });
    await admin("POST", "/admin/features", {
      key: "tinh-nang-bi-mat",
      name: { vi: "Tính năng bí mật" },
      status: "on",
    });
    await admin("POST", "/admin/secrets", { name: secretName, value: LEAK_1 });
    await admin("POST", "/admin/workflows", {
      key: "quy-trinh-bi-mat",
      name: "Quy trình bí mật",
      description: "d".repeat(30),
      app_type: "workflow",
      base_url: "https://x.example.com",
      secret_id: ID.secret.old,
    });
    await env.settle(lis, lis.msgs.length);
    const raw = lis.msgs
      .slice(from)
      .map((m) => m.raw)
      .join("\n");
    expect(lis.msgs.length - from).toBeGreaterThanOrEqual(5);
    for (const needle of [
      "notify-co",
      "Notify",
      "notify.user",
      "nhom-bi-mat",
      "tinh-nang-bi-mat",
      "quy-trinh-bi-mat",
      secretName,
      ...leakForms(LEAK_1),
    ]) {
      expect([needle, raw.includes(needle)]).toEqual([needle, false]);
    }
  });
});

describe("ADM-FR-53 · rollback và lỗi luật (M3-R15)", () => {
  it("ADM-FR-53 · M3-AC05 · P3 · POST command hợp lệ nhưng feature_ids có uuid lạ → 400 INVALID_REFERENCE: KHÔNG bump, KHÔNG NOTIFY, command không tồn tại", async () => {
    const { res, v0, v1, msgs } = await track(env, lis, () =>
      admin("POST", "/admin/commands", {
        name: "rollback-cmd",
        description: { vi: "x" },
        workflow_id: ID.workflow.reportTax,
        output: { field: "text", render: "text" },
        feature_ids: [ID3.unknown],
      }),
    );
    expectErr(res, "INVALID_REFERENCE");
    expect([v1, msgs]).toEqual([v0, []]);
    expect(
      await num(
        env.owner,
        "select count(*)::int as n from admin.commands where name = 'rollback-cmd'",
      ),
    ).toBe(0);
  });

  it("ADM-FR-53 · M3-AC05 · P4 · KEY_TAKEN (group, tenant) → không bump, không NOTIFY, không beta-testers mồ côi", async () => {
    const g = await track(env, lis, () =>
      binh("POST", "/admin/groups", { key: "ke-toan", name: { vi: "Trùng" } }),
    );
    expectErr(g.res, "KEY_TAKEN");
    expect([g.v1, g.msgs]).toEqual([g.v0, []]);
    const t = await track(env, lis, () =>
      admin("POST", "/admin/tenants", {
        key: "acme",
        name: "Trùng",
        first_admin: { username: "boss", display_name: "Boss", email: "boss@x.test" },
      }),
    );
    expectErr(t.res, "KEY_TAKEN");
    expect([t.v1, t.msgs]).toEqual([t.v0, []]);
    expect(
      await num(
        env.owner,
        "select count(*)::int as n from admin.groups where key = 'beta-testers'",
      ),
    ).toBe(await num(env.owner, "select count(*)::int as n from admin.tenants"));
  });
});

describe("ADM-FR-53 · retry 40P01/40001 (TECH-DEBT #13, M3-R16)", () => {
  it("ADM-FR-53 · M3-AC05 · P5 · hook ném 40P01 ở group.save/bump LẦN ĐẦU: PATCH group → 200, version +1 đúng một lần, config_version +1, đúng MỘT NOTIFY", async () => {
    const f = failOnce("group.save", "bump", "40P01");
    const u = await userCall(f.hooks, "acme", "binh");
    try {
      const v = await verOf(env, "groups", KT);
      const { res, v0, v1, msgs } = await track(env, lis, () =>
        u.call("PATCH", `/admin/groups/${KT}`, { version: v, name: { vi: "Retry" } }),
      );
      expect(res.status).toBe(200);
      expect(f.state.fired).toBe(1);
      expect(await verOf(env, "groups", KT)).toBe(v + 1);
      expect(v1).toBe(v0 + 1);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.payload).toMatchObject({ v: v1, entity: "group", tenant_id: TENANT_ID.acme });
    } finally {
      await u.close();
    }
  });

  it("ADM-FR-53 · M3-AC05 · P6 · hook ném 40001 ở grant.batch/bump lần đầu: batch → 200 {added:1}, đúng một grant mới, config_version +1, một NOTIFY", async () => {
    const f = failOnce("grant.batch", "bump", "40001");
    const u = await userCall(f.hooks, "acme", "binh");
    try {
      const before = await num(env.owner, "select count(*)::int as n from admin.feature_grants");
      const { res, v0, v1, msgs } = await track(env, lis, () =>
        u.call("PUT", "/admin/grants/batch", {
          add: [{ feature_id: ID.feature.dichThuat, group_id: KT }],
        }),
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ added: 1, removed: 0, unchanged: 0 });
      expect(f.state.fired).toBe(1);
      expect(await num(env.owner, "select count(*)::int as n from admin.feature_grants")).toBe(
        before + 1,
      );
      expect([v1, msgs.length]).toEqual([v0 + 1, 1]);
    } finally {
      await u.close();
    }
  });

  it("ADM-FR-53 · M3-AC05 · P7 · hook ném 40P01 ở tenant.save/bump lần đầu: POST tenant → 201, MỘT tenant, MỘT beta-testers, config_version +1, một NOTIFY", async () => {
    const f = failOnce("tenant.save", "bump", "40P01");
    const u = await userCall(f.hooks, "platform", "admin");
    try {
      const { res, v0, v1, msgs } = await track(env, lis, () =>
        u.call("POST", "/admin/tenants", {
          key: "initech",
          name: "Initech",
          first_admin: {
            username: "lumbergh",
            display_name: "Bill",
            email: "bill@initech.test",
            locale: "en",
          },
        }),
      );
      expect(res.status).toBe(201);
      expect(f.state.fired).toBe(1);
      expect(
        await num(env.owner, "select count(*)::int as n from admin.tenants where key = 'initech'"),
      ).toBe(1);
      expect(
        await num(
          env.owner,
          "select count(*)::int as n from admin.groups g join admin.tenants t on t.id = g.tenant_id where t.key = 'initech'",
        ),
      ).toBe(1);
      expect([v1, msgs.length]).toEqual([v0 + 1, 1]);
    } finally {
      await u.close();
    }
  });
});

describe("ADM-FR-53 · thứ tự, sau commit, thời gian (M3-R16, R19)", () => {
  it("ADM-FR-53 · M3-R16 · P8 · NOTIFY SAU commit: tại lúc nhận, truy vấn bằng kết nối khác đã thấy dữ liệu đã commit và config_version = payload.v (group, grant, entitlement)", async () => {
    type Seen = { cfg: number; group: number; grant: number; revoked: number };
    const probe = await onNotify<Seen>(async () => {
      const [r] = await env.owner<Seen[]>`select
        (select config_version from admin.config_meta) as cfg,
        (select count(*)::int from admin.groups where key = 'probe-group') as "group",
        (select count(*)::int from admin.feature_grants where feature_id = ${ID.feature.dichThuat} and group_id = ${KT}) as grant,
        (select count(*)::int from admin.feature_entitlements where feature_id = ${ID.feature.keToan}
           and tenant_id = ${TENANT_ID.acme} and revoked_at is not null) as revoked`;
      return r as Seen;
    });
    try {
      await binh("POST", "/admin/groups", { key: "probe-group", name: { vi: "P" } });
      await probe.wait(1);
      await binh("POST", "/admin/grants", { feature_id: ID.feature.dichThuat, group_id: KT });
      await probe.wait(2);
      await admin("DELETE", `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`);
      await probe.wait(3);
      const [a, b, c] = probe.results;
      expect(a?.result.group).toBe(1);
      expect(b?.result.grant).toBe(1);
      expect(c?.result.revoked).toBe(1);
      for (const r of probe.results) expect(r.result.cfg).toBeGreaterThanOrEqual(r.payload.v);
    } finally {
      await probe.close();
    }
  });

  it("ADM-FR-53 · M3-R16 · P9 · chuỗi 10 ghi tuần tự: mỗi lần config_version +1, payload.v = config_version sau ghi, chuỗi payload.v đơn điệu tăng", async () => {
    const seq: number[] = [];
    for (let i = 0; i < 10; i++) {
      const v = await verOf(env, "groups", KT);
      const { res, v0, v1, msgs } = await track(env, lis, () =>
        binh("PATCH", `/admin/groups/${KT}`, { version: v, name: { vi: `Lần ${i}` } }),
      );
      expect(res.status).toBe(200);
      expect(v1).toBe(v0 + 1);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.payload.v).toBe(v1);
      seq.push(v1);
    }
    expect([...seq].sort((x, y) => x - y)).toEqual(seq);
    expect(new Set(seq).size).toBe(10);
  });

  it("ADM-FR-53 · AC-A03 · M3-R19 · P10 · (có yếu tố thời gian) payload tới listener ≤ 1000 ms sau khi response về, cho group, grant, entitlement", async () => {
    const ops: Array<() => Promise<unknown>> = [
      () => binh("POST", "/admin/groups", { key: "p10-group", name: { vi: "P10" } }),
      () => binh("POST", "/admin/grants", { feature_id: ID.feature.dichThuat, group_id: KT }),
      () => admin("DELETE", `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`),
    ];
    for (const run of ops) {
      const from = lis.msgs.length;
      await run();
      const tResp = performance.now();
      await lis.waitCount(from + 1, 1000);
      expect((lis.msgs[from]?.at as number) - tResp).toBeLessThan(1000);
    }
  });
});

describe("ADM-FR-53 · lỗi gửi và config_meta (M3-R15, R16)", () => {
  it("ADM-FR-53 · M3-R16 · P11 · Db.notify ném lỗi: POST group vẫn 201, dữ liệu đã ghi, config_version +1, không treo", async () => {
    const db = Object.assign(createDb(ADMIN_API_URL, { max: 4 }), {
      notify: async () => {
        throw new Error("notify hỏng (test)");
      },
    });
    const app = await env.makeApp({ db });
    try {
      const v0 = await env.cfg();
      const res = await app.call("POST", "/admin/groups", {
        token: await env.token("acme", "binh"),
        body: { key: "p11-group", name: { vi: "P11" } },
      });
      expect(res.status).toBe(201);
      expect(
        await num(env.owner, "select count(*)::int as n from admin.groups where key = 'p11-group'"),
      ).toBe(1);
      expect(await env.cfg()).toBe(v0 + 1);
    } finally {
      await app.close();
      await db.close();
    }
  });

  it("ADM-FR-53 · M3-R15 · P12 · config_meta bị xoá hàng (owner): một ghi bất kỳ vẫn thành công, config_version = 1, hàng tồn tại lại (upsert), NOTIFY v=1", async () => {
    await env.owner`delete from admin.config_meta`;
    const { res, v1, msgs } = await track(env, lis, () =>
      binh("POST", "/admin/groups", { key: "p12-group", name: { vi: "P12" } }),
    );
    expect(res.status).toBe(201);
    // v1 đọc ngay sau ghi, trước sentinel của track (sentinel cũng bump nên không đọc lại config_meta ở đây)
    expect(v1).toBe(1);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.payload.v).toBe(1);
    const rows = await env.owner`select config_version from admin.config_meta`;
    expect(rows.length).toBe(1);
  });
});

describe("AC-A03 · AC-A10 · AC-A11 · tại lúc NOTIFY tới, dữ liệu Hub đọc đã đúng (M3-R19)", () => {
  it("AC-A03 · ADM-FR-20 · M3-R19 · P13 · (có yếu tố thời gian) tạo command dich-v2 (workflow translate, map đủ, feature core) → NOTIFY entity 'command' ≤ 1000 ms; tại lúc nhận SQL hub_ro cho user active của tenant active thấy dich-v2", async () => {
    const probe = await onNotify(async () => ({
      an: await hubVisible(env.owner, USER_ID.an),
      khang: await hubVisible(env.owner, USER_ID.khang),
    }));
    try {
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
      const tResp = performance.now();
      await probe.wait(1);
      const r = probe.results[0];
      expect(r?.payload.entity).toBe("command");
      expect(r?.result.an).toContain("dich-v2");
      expect(r?.result.khang).toContain("dich-v2");
      expect((r?.at as number) - tResp).toBeLessThan(1000);
    } finally {
      await probe.close();
    }
  });

  it("AC-A10 · ADM-FR-32 · M3-R19 · P14 · (có yếu tố thời gian) tenant_admin cấp ke-toan cho group → NOTIFY 'grant' tenant acme ≤ 1000 ms; tại lúc nhận SQL hub_ro: lan thấy kiemtra-hoadon, an không; không NOTIFY nào cho tenant khác", async () => {
    await env.reset3({ perms: NO_GRANTS });
    const probe = await onNotify(async () => ({
      lan: await hubVisible(env.owner, USER_ID.lan),
      an: await hubVisible(env.owner, USER_ID.an),
    }));
    try {
      const { res, msgs } = await track(env, lis, () =>
        binh("POST", "/admin/grants", { feature_id: ID.feature.keToan, group_id: KT }),
      );
      expect(res.status).toBe(201);
      await probe.wait(2);
      const r = probe.results.find((x) => x.payload.entity === "grant");
      expect(r?.payload.tenant_id).toBe(TENANT_ID.acme);
      expect(r?.result.lan).toContain("kiemtra-hoadon");
      expect(r?.result.an).not.toContain("kiemtra-hoadon");
      expect(msgs).toHaveLength(1);
      expect(msgs.every((m) => m.payload.tenant_id === TENANT_ID.acme)).toBe(true);
    } finally {
      await probe.close();
    }
  });

  it("AC-A11 · ADM-BR-12 · M3-R19 · P15 · thu hồi entitlement → NOTIFY 'entitlement' ≤ 1000 ms, tại lúc nhận SQL mất kiemtra-hoadon và grant G1 còn; cấp lại → NOTIFY, SQL có lại, CÙNG id grant", async () => {
    const url = `/admin/features/${ID.feature.keToan}/entitlements/${TENANT_ID.acme}`;
    const probe = await onNotify(async () => ({
      lan: await hubVisible(env.owner, USER_ID.lan),
      g1: await num(
        env.owner,
        `select count(*)::int as n from admin.feature_grants where id = '${ID3.grant.g1}'`,
      ),
    }));
    try {
      await admin("DELETE", url);
      await probe.wait(1);
      const off = probe.results[0];
      expect(off?.payload).toMatchObject({ entity: "entitlement", tenant_id: TENANT_ID.acme });
      expect(off?.result.lan).not.toContain("kiemtra-hoadon");
      expect(off?.result.g1).toBe(1);
      await admin("PUT", url);
      await probe.wait(2);
      const on = probe.results[1];
      expect(on?.payload.entity).toBe("entitlement");
      expect(on?.result.lan).toContain("kiemtra-hoadon");
      expect(on?.result.g1).toBe(1);
    } finally {
      await probe.close();
    }
  });
});
