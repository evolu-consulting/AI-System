// ADM-FR-13, ADM-FR-20, ADM-FR-30, ADM-BR-01, ADM-BR-10 · đồng thời và khoá hàng (test-plan K; M2-AC03; M2-R13,
// R19, R27; TECH-DEBT #13). KHÔNG TẤT ĐỊNH: thứ tự đến của request song song không điều khiển được từ test, nên mỗi ca
// chỉ khẳng định BẤT BIẾN sau loạt + tập kết quả hợp lệ + không 500 + deadlocks không tăng; ca có thể xanh dù lỗi còn
// (race không xảy ra mọi lần). Lỗi thật phải được backend bắt bằng test dùng hook (lock-order.int.test.ts, test-plan G8).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ALL_CATALOG, ID } from "./_data";
import { createM2Env, type Json, type M2Env, type Res } from "./_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});

const ROUNDS = 10;
const as = async (method: string, path: string, body?: unknown): Promise<Res> =>
  env.call(method, path, { token: await env.admin(), body });
const W = ID.workflow;
const C = ID.command;
const KT = ID.feature.keToan;
const DT = ID.feature.dichThuat;
const cmdBody = (over: Record<string, unknown> = {}) => ({
  name: "race-cmd",
  description: { vi: "Đua" },
  workflow_id: W.reportTax,
  args: [],
  input_map: {},
  output: { field: "text", render: "text" },
  enabled: false,
  ...over,
});
const statuses = (...rs: Res[]) => rs.map((r) => r.status);
const noServerError = (...rs: Res[]) => expect(rs.filter((r) => r.status >= 500)).toEqual([]);
type Pair = () => Promise<void>;
const n = async (sql: string): Promise<number> =>
  ((await env.owner.unsafe(sql))[0] as Json).n as number;

/** kiemtra-hoadon thuộc cả ke-toan và dich-thuat (để bỏ một feature vẫn hợp lệ khi đứng riêng). */
const twoFeatures: Pair = async () => {
  await env.owner`insert into admin.feature_commands (feature_id, command_id) values (${DT}, ${C.kiemtraHoadon})`;
};
const featuresOf = async (cid: string) =>
  n(`select count(*)::int as n from admin.feature_commands where command_id = '${cid}'`);

async function rounds(rounds: number, setup: Pair, run: Pair): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await env.reset(ALL_CATALOG);
    await setup();
    await run();
  }
}
const noSetup: Pair = async () => undefined;

describe("ADM-BR-01 · tên command song song (M2-AC03, M2-R13)", () => {
  it("ADM-BR-01 · M2-AC03 · hai POST cùng name song song ×10 → đúng 1×201 và 1×409 COMMAND_NAME_TAKEN; đúng 1 command và 1 hàng command_names", async () => {
    await rounds(ROUNDS, noSetup, async () => {
      const [a, b] = await Promise.all([
        as("POST", "/admin/commands", cmdBody({ name: "dich-race" })),
        as("POST", "/admin/commands", cmdBody({ name: "dich-race", description: { vi: "Khác" } })),
      ]);
      expect(statuses(a, b).sort()).toEqual([201, 409]);
      const lose = a.status === 409 ? a : b;
      expect(lose.json.error.code).toBe("COMMAND_NAME_TAKEN");
      expect(
        await n("select count(*)::int as n from admin.commands where name = 'dich-race'"),
      ).toBe(1);
      expect(
        await n("select count(*)::int as n from admin.command_names where name = 'dich-race'"),
      ).toBe(1);
    });
  });

  it("ADM-BR-01 · M2-R13 · POST command A (tên x) ∥ POST command B (alias x) → đúng 1×201, 1×409; command_names.x thuộc về command tạo thành công", async () => {
    await rounds(ROUNDS, noSetup, async () => {
      const [a, b] = await Promise.all([
        as("POST", "/admin/commands", cmdBody({ name: "x-shared" })),
        as("POST", "/admin/commands", cmdBody({ name: "b-other", aliases: ["x-shared"] })),
      ]);
      expect(statuses(a, b).sort()).toEqual([201, 409]);
      const winner = a.status === 201 ? a : b;
      const [row] =
        await env.owner`select command_id from admin.command_names where name = 'x-shared'`;
      expect(row?.command_id).toBe(winner.json.id);
    });
  });
});

describe("ADM-BR-10 · command không mồ côi dưới đồng thời (M2-R19, plan §5.1)", () => {
  it("ADM-BR-10 · M2-R19 · PATCH command bỏ feature DT (feature_ids:[KT]) ∥ PATCH feature KT bỏ command (command_ids:[]) ×10 → đúng 1 thành công; command còn ≥ 1 feature; kẻ thua ∈ {409 VERSION_CONFLICT, 400 COMMAND_NEEDS_FEATURE}", async () => {
    await rounds(ROUNDS, twoFeatures, async () => {
      const [a, b] = await Promise.all([
        as("PATCH", `/admin/commands/${C.kiemtraHoadon}`, { version: 1, feature_ids: [KT] }),
        as("PATCH", `/admin/features/${KT}`, { version: 1, command_ids: [] }),
      ]);
      noServerError(a, b);
      expect(statuses(a, b).filter((s) => s === 200)).toHaveLength(1);
      const lose = a.status === 200 ? b : a;
      expect(["VERSION_CONFLICT", "COMMAND_NEEDS_FEATURE"]).toContain(lose.json.error.code);
      expect(await featuresOf(C.kiemtraHoadon)).toBeGreaterThanOrEqual(1);
    });
  });

  it("ADM-BR-10 · M2-R21 · DELETE feature KT ∥ PATCH command feature_ids:[KT] ×10 → command còn ≥ 1 feature; kết quả ∈ {(204, 400 INVALID_REFERENCE), (409 FEATURE_HAS_EXCLUSIVE_COMMANDS, 200)}", async () => {
    await rounds(ROUNDS, twoFeatures, async () => {
      const [del, p] = await Promise.all([
        as("DELETE", `/admin/features/${KT}`),
        as("PATCH", `/admin/commands/${C.kiemtraHoadon}`, { version: 1, feature_ids: [KT] }),
      ]);
      noServerError(del, p);
      const code = (r: Res) => r.json?.error?.code;
      const deletedFirst =
        del.status === 204 && p.status === 400 && code(p) === "INVALID_REFERENCE";
      const patchedFirst =
        del.status === 409 && code(del) === "FEATURE_HAS_EXCLUSIVE_COMMANDS" && p.status === 200;
      expect(deletedFirst || patchedFirst).toBe(true);
      expect(await featuresOf(C.kiemtraHoadon)).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("ADM-FR-13 · workflow/secret song song với command/workflow (M2-R11, M2-R14)", () => {
  it("ADM-FR-13 · M2-R14 · POST command enabled:true ∥ PATCH workflow enabled:false ×10 → KHÔNG có command bật trỏ workflow tắt; kết quả ∈ {(201, 409 WORKFLOW_IN_USE), (409 WORKFLOW_DISABLED, 200)}", async () => {
    await rounds(ROUNDS, noSetup, async () => {
      const [c, w] = await Promise.all([
        as("POST", "/admin/commands", cmdBody({ enabled: true })),
        as("PATCH", `/admin/workflows/${W.reportTax}`, { version: 1, enabled: false }),
      ]);
      noServerError(c, w);
      const created =
        c.status === 201 && w.status === 409 && w.json.error.code === "WORKFLOW_IN_USE";
      const disabledFirst =
        c.status === 409 && c.json.error.code === "WORKFLOW_DISABLED" && w.status === 200;
      expect(created || disabledFirst).toBe(true);
      const bad = await n(`select count(*)::int as n from admin.commands c
        join admin.workflows w on w.id = c.workflow_id where c.enabled and not w.enabled`);
      expect(bad).toBe(0);
    });
  });

  it("ADM-FR-13 · M2-R11 · DELETE workflow ∥ POST command trỏ vào ×10 → không command nào dangling, không cả hai cùng thành công; kẻ thua ∈ {409 WORKFLOW_IN_USE, 400 INVALID_REFERENCE}", async () => {
    await rounds(ROUNDS, noSetup, async () => {
      const [d, c] = await Promise.all([
        as("DELETE", `/admin/workflows/${W.reportTax}`),
        as("POST", "/admin/commands", cmdBody()),
      ]);
      noServerError(d, c);
      expect(d.status === 204 && c.status === 201).toBe(false);
      expect([204, 409]).toContain(d.status);
      if (d.status === 409) expect(d.json.error.code).toBe("WORKFLOW_IN_USE");
      if (c.status !== 201) expect(c.json.error.code).toBe("INVALID_REFERENCE");
      const dangling = await n(`select count(*)::int as n from admin.commands c
        where not exists (select 1 from admin.workflows w where w.id = c.workflow_id)`);
      expect(dangling).toBe(0);
    });
  });

  it("ADM-FR-13 · M2-R05 · DELETE secret ∥ POST workflow trỏ vào ×10 → không workflow mồ côi; kết quả ∈ {(204, 400 INVALID_REFERENCE), (409 SECRET_IN_USE, 201)}", async () => {
    await rounds(ROUNDS, noSetup, async () => {
      const [d, w] = await Promise.all([
        as("DELETE", "/admin/secrets/DIFY_OLD_KEY"),
        as("POST", "/admin/workflows", {
          key: "race-wf",
          name: "Race",
          description: "d".repeat(30),
          app_type: "workflow",
          base_url: "https://x.example.com",
          secret_id: ID.secret.old,
        }),
      ]);
      noServerError(d, w);
      const deletedFirst =
        d.status === 204 && w.status === 400 && w.json.error.code === "INVALID_REFERENCE";
      const createdFirst =
        d.status === 409 && d.json.error.code === "SECRET_IN_USE" && w.status === 201;
      expect(deletedFirst || createdFirst).toBe(true);
      const orphan = await n(`select count(*)::int as n from admin.workflows w
        where not exists (select 1 from admin.secrets s where s.id = w.secret_id)`);
      expect(orphan).toBe(0);
    });
  });
});

describe("ADM-FR-20 · version và entitlement song song", () => {
  it("ADM-FR-20 · M2-R25 · 15 PATCH song song cùng version lên cùng command → đúng 1×200 và 14×409 VERSION_CONFLICT", async () => {
    await env.reset(ALL_CATALOG);
    const rs = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        as("PATCH", `/admin/commands/${C.dich}`, { version: 1, description: { vi: `Mô tả ${i}` } }),
      ),
    );
    noServerError(...rs);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      rs.filter((r) => r.status === 409 && r.json.error.code === "VERSION_CONFLICT"),
    ).toHaveLength(14);
  });

  it("ADM-FR-31 · M2-R21 · PUT entitlement ∥ DELETE feature ×10 → không còn hàng entitlement của feature đã xoá; PUT ∈ {200, 404}", async () => {
    await rounds(ROUNDS, noSetup, async () => {
      const f = ID.feature.thuNghiem;
      const tenant = (await env.owner`select id from admin.tenants where key = 'zeta'`)[0] as Json;
      const [put, del] = await Promise.all([
        as("PUT", `/admin/features/${f}/entitlements/${tenant.id}`),
        as("DELETE", `/admin/features/${f}`),
      ]);
      noServerError(put, del);
      expect([200, 404]).toContain(put.status);
      expect(del.status).toBe(204);
      expect(
        await n(
          `select count(*)::int as n from admin.feature_entitlements where feature_id = '${f}'`,
        ),
      ).toBe(0);
    });
  });
});

describe("ADM-FR-20 · M2-R27 · không deadlock", () => {
  it("ADM-FR-20 · M2-R27 · trộn mọi cặp xen kẽ ×20 vòng: không response 500, pg_stat_database.deadlocks không tăng, mỗi vòng xong < 900 ms", async () => {
    const deadlocks = async (): Promise<number> => {
      await env.owner`select pg_stat_force_next_flush()`;
      return (
        await env.owner`select deadlocks::int as d from pg_stat_database where datname = current_database()`
      )[0]?.d as number;
    };
    const before = await deadlocks();
    await rounds(20, twoFeatures, async () => {
      const t0 = Date.now();
      const rs = await Promise.all([
        as("PATCH", `/admin/commands/${C.kiemtraHoadon}`, { version: 1, feature_ids: [KT] }),
        as("PATCH", `/admin/features/${KT}`, { version: 1, command_ids: [] }),
        as("DELETE", `/admin/features/${DT}`),
        as("POST", "/admin/commands", cmdBody({ enabled: true })),
        as("PATCH", `/admin/workflows/${W.reportTax}`, { version: 1, enabled: false }),
        as("DELETE", `/admin/workflows/${W.reportExport}`),
        as("POST", "/admin/commands", cmdBody({ name: "race-cmd-2" })),
        as("DELETE", "/admin/secrets/DIFY_OLD_KEY"),
        as("POST", "/admin/workflows", {
          key: "race-wf",
          name: "Race",
          description: "d".repeat(30),
          app_type: "workflow",
          base_url: "https://x.example.com",
          secret_id: ID.secret.old,
        }),
      ]);
      expect(Date.now() - t0).toBeLessThan(900);
      noServerError(...rs);
    });
    expect(await deadlocks()).toBe(before);
  });
});
