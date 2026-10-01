// ADM-FR-53, ADM-FR-32, ADM-FR-62 · ràng buộc khoá M3 — BẤT BIẾN sau loạt song song (test-plan I-K, C1–C13).
// KHÔNG TẤT ĐỊNH: thứ tự đến của các request song song do hệ điều hành quyết định; mỗi ca lặp nhiều vòng và chỉ khẳng định
// điều LUÔN đúng (không 500, không 40P01, nguyên tử, không bản ghi mồ côi, config_version/NOTIFY khớp nhau). Một ca xanh KHÔNG
// chứng minh hết lỗi — ca xen kẽ tất định L1–L10 là của backend (`apps/admin-api/src/lib/lock-order.int.test.ts`); C12 chỉ
// canh việc các ca đó tồn tại. Cần DB không bị tiến trình khác ghi (DB riêng, test-plan §6.3) vì đếm deadlocks/NOTIFY theo DB.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  callerOf,
  createM3Env,
  expectErr,
  hubVisible,
  ID,
  ID3,
  type Listener,
  type M3Env,
  num,
  PW,
  type Res,
  TENANT_ID,
  USER_ID,
} from "./_fixtures";
import { ROOT } from "./_modules";

let env: M3Env;
let lis: Listener;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
let hoa: ReturnType<typeof callerOf>;
let deadlocksAtStart = 0;

beforeAll(async () => {
  env = await createM3Env();
  lis = await env.listen();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
  hoa = callerOf(env, "globex", "hoa");
  deadlocksAtStart = await env.deadlocks();
});
beforeEach(async () => {
  await env.reset3();
  await Promise.all([
    env.token("platform", "admin"),
    env.token("acme", "binh"),
    env.token("globex", "hoa"),
    env.token("acme", "lan"),
  ]);
});
afterAll(async () => {
  await env.close();
});

const KT = ID3.group.acmeKeToan;
const KD = ID3.group.acmeKinhDoanh;
const F = ID.feature;
const P = (feature_id: string, group_id: string) => ({ feature_id, group_id });
const batch = (call: typeof admin, body: unknown) => call("PUT", "/admin/grants/batch", body);
const nGrants = (where = "true") =>
  num(env.owner, `select count(*)::int as n from admin.feature_grants where ${where}`);

/** Một vòng: dựng lại dữ liệu + token rồi chạy `fn`; deadlocks không được tăng trong vòng. */
async function rounds(n: number, fn: (round: number) => Promise<void>) {
  for (let r = 0; r < n; r++) {
    if (r > 0) {
      await env.reset3();
      await Promise.all([
        env.token("platform", "admin"),
        env.token("acme", "binh"),
        env.token("globex", "hoa"),
      ]);
    }
    const d0 = await env.deadlocks();
    await fn(r);
    expect([r, await env.deadlocks()]).toEqual([r, d0]);
  }
}

/** Bất biến chung sau một loạt: không 500; config_version tăng = số NOTIFY nhận được; tập v liên tục (v0, v0 + n], mỗi v duy nhất. */
async function audit(from: number, v0: number, res: Res[]): Promise<number> {
  expect(res.filter((r) => r.status >= 500).map((r) => r.status)).toEqual([]);
  const delta = (await env.cfg()) - v0;
  const msgs = await env.settle(lis, from);
  expect(msgs).toHaveLength(delta);
  expect(msgs.map((m) => m.payload.v).sort((a, b) => a - b)).toEqual(
    Array.from({ length: delta }, (_, i) => v0 + 1 + i),
  );
  return delta;
}
const start = async () => ({ from: lis.msgs.length, v0: await env.cfg() });
const codes = (res: Res[]) => res.map((r) => r.status).sort((a, b) => a - b);

describe("ADM-FR-35 · batch song song (C1)", () => {
  it("ADM-FR-35 · C1 · batch [bớt X, thêm Y] ∥ batch [thêm X, bớt Y] × 20 vòng: cả hai 200; trạng thái cuối CHỈ là {X} hoặc {Y} (nguyên tử); không 40P01", async () => {
    await rounds(20, async () => {
      await env.owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${TENANT_ID.acme}, ${F.dichThuat}, ${KT})`;
      const { from, v0 } = await start();
      const [a, b] = await Promise.all([
        batch(binh, { add: [P(F.thuNghiem, KT)], remove: [P(F.dichThuat, KT)] }),
        batch(binh, { add: [P(F.dichThuat, KT)], remove: [P(F.thuNghiem, KT)] }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const rows = await env.owner<{ f: string }[]>`select feature_id as f from admin.feature_grants
        where group_id = ${KT} and feature_id in (${F.dichThuat}, ${F.thuNghiem})`;
      expect(rows).toHaveLength(1);
      await audit(from, v0, [a, b]);
    });
  });
});

describe("ADM-FR-32 · grant song song (C2, C3, C5)", () => {
  it("ADM-FR-32 · C2 · POST cùng cặp (feature, group) × 10 song song: đúng 1×201 + 9×200; 1 hàng; config_version +1; 1 NOTIFY", async () => {
    const { from, v0 } = await start();
    const res = await Promise.all(
      Array.from({ length: 10 }, () =>
        binh("POST", "/admin/grants", { feature_id: F.dichThuat, group_id: KT }),
      ),
    );
    expect(codes(res)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(await nGrants(`feature_id = '${F.dichThuat}' and group_id = '${KT}'`)).toBe(1);
    expect(await audit(from, v0, res)).toBe(1);
  });

  it("ADM-BR-12 · C3 · POST grant ∥ DELETE entitlement × 20 vòng: POST ∈ {201, 409 NOT_ENTITLED}; nếu 201 hàng grant còn nhưng hiệu lực SQL không có (BR-12); 409 thì không có hàng", async () => {
    await rounds(20, async () => {
      await env.owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${TENANT_ID.acme}, ${KD}, ${USER_ID.an})`;
      const { from, v0 } = await start();
      const [p, d] = await Promise.all([
        binh("POST", "/admin/grants", { feature_id: F.keToan, group_id: KD }),
        admin("DELETE", `/admin/features/${F.keToan}/entitlements/${TENANT_ID.acme}`),
      ]);
      expect(d.status).toBe(204);
      expect([201, 409]).toContain(p.status);
      if (p.status === 409) expectErr(p, "NOT_ENTITLED");
      expect(await nGrants(`feature_id = '${F.keToan}' and group_id = '${KD}'`)).toBe(
        p.status === 201 ? 1 : 0,
      );
      expect(await hubVisible(env.owner, USER_ID.an)).not.toContain("kiemtra-hoadon");
      await audit(from, v0, [p, d]);
    });
  });

  it("ADM-FR-32 · C5 · PATCH feature (status) ∥ POST grant của feature đó × 10 vòng: cả hai thành công; config_version +2; 2 NOTIFY", async () => {
    await rounds(10, async () => {
      const ver = await num(
        env.owner,
        `select version::int as n from admin.features where id = '${F.keToan}'`,
      );
      const { from, v0 } = await start();
      const [pa, po] = await Promise.all([
        admin("PATCH", `/admin/features/${F.keToan}`, { version: ver, status: "beta" }),
        binh("POST", "/admin/grants", { feature_id: F.keToan, group_id: KD }),
      ]);
      expect([pa.status, po.status]).toEqual([200, 201]);
      expect(await audit(from, v0, [pa, po])).toBe(2);
    });
  });
});

describe("ADM-FR-62 · xoá song song (C4, C6)", () => {
  it("ADM-FR-62 · C4 · DELETE group ∥ batch có group đó × 20 vòng: DELETE 204; batch ∈ {200, 400 INVALID_REFERENCE group_ids}; không grant mồ côi", async () => {
    await rounds(20, async () => {
      const { from, v0 } = await start();
      const [d, b] = await Promise.all([
        binh("DELETE", `/admin/groups/${KD}`),
        batch(binh, { add: [P(F.keToan, KD)] }),
      ]);
      expect(d.status).toBe(204);
      expect([200, 400]).toContain(b.status);
      if (b.status === 400) {
        expectErr(b, "INVALID_REFERENCE");
        expect(b.json.error.details.field).toBe("group_ids");
      }
      expect(await nGrants(`group_id = '${KD}'`)).toBe(0);
      expect(
        await num(env.owner, `select count(*)::int as n from admin.groups where id = '${KD}'`),
      ).toBe(0);
      await audit(from, v0, [d, b]);
    });
  });

  it("ADM-FR-32 · C6 · DELETE feature ∥ batch thêm feature đó × 20 vòng: batch ∈ {200, 400 INVALID_REFERENCE feature_ids}; không grant mồ côi", async () => {
    await rounds(20, async () => {
      const { from, v0 } = await start();
      const [d, b] = await Promise.all([
        admin("DELETE", `/admin/features/${F.thuNghiem}`),
        batch(binh, { add: [P(F.thuNghiem, KT)] }),
      ]);
      expect(d.status).toBe(204);
      expect([200, 400]).toContain(b.status);
      if (b.status === 400) {
        expectErr(b, "INVALID_REFERENCE");
        expect(b.json.error.details.field).toBe("feature_ids");
      }
      expect(await nGrants(`feature_id = '${F.thuNghiem}'`)).toBe(0);
      await audit(from, v0, [d, b]);
    });
  });
});

describe("ADM-FR-53 · config_version khi ghi song song (C7, C8, C9, C10, C11)", () => {
  it("ADM-FR-53 · C7 · ghi ở hai tenant song song (20 cặp = 40 request): đều 201; config_version +40; 40 NOTIFY; xong < 5 s (không chờ nhau quá hạn)", async () => {
    const { from, v0 } = await start();
    const t0 = performance.now();
    const res = await Promise.all(
      Array.from({ length: 20 }, (_, i) => [
        binh("POST", "/admin/groups", { key: `c7-a${i}`, name: { vi: `A${i}` } }),
        hoa("POST", "/admin/groups", { key: `c7-g${i}`, name: { vi: `G${i}` } }),
      ]).flat(),
    );
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(res.every((r) => r.status === 201)).toBe(true);
    expect(await audit(from, v0, res)).toBe(40);
  });

  it("ADM-FR-62 · C8 · POST /admin/tenants cùng key × 10: đúng 1×201 + 9×409 KEY_TAKEN; ĐÚNG 1 beta-testers cho tenant đó; config_version +1; 1 NOTIFY", async () => {
    const { from, v0 } = await start();
    const body = {
      key: "initech",
      name: "Initech",
      first_admin: {
        username: "lumbergh",
        display_name: "Bill",
        email: "bill@initech.test",
        locale: "en",
      },
    };
    const res = await Promise.all(
      Array.from({ length: 10 }, () => admin("POST", "/admin/tenants", body)),
    );
    expect(codes(res)).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    for (const r of res.filter((x) => x.status === 409)) expectErr(r, "KEY_TAKEN");
    expect(
      await num(
        env.owner,
        "select count(*)::int as n from admin.groups g join admin.tenants t on t.id = g.tenant_id where t.key = 'initech'",
      ),
    ).toBe(1);
    expect(await audit(from, v0, res)).toBe(1);
  });

  it("ADM-FR-62 · C9 · members add [dung, an] ∥ [an, dung] × 20 vòng: cả hai 200; tổng added = 2 (không trùng); không 40P01", async () => {
    await rounds(20, async () => {
      const { from, v0 } = await start();
      const [a, b] = await Promise.all([
        binh("POST", `/admin/groups/${KD}/members`, { usernames: ["dung", "an"] }),
        binh("POST", `/admin/groups/${KD}/members`, { usernames: ["an", "dung"] }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.json.added.length + b.json.added.length).toBe(2);
      expect(
        await num(
          env.owner,
          `select count(*)::int as n from admin.group_members where group_id = '${KD}'`,
        ),
      ).toBe(2);
      await audit(from, v0, [a, b]);
    });
  });

  it("ADM-FR-53 · C10 · 30 ghi khác loại song song (group, grant, feature, secret, user, tenant × 5): đều 2xx; config_version +30; 30 NOTIFY; mọi v duy nhất", async () => {
    const { from, v0 } = await start();
    const tenant = (i: number) => ({
      key: `c10-t${i}`,
      name: `C10 ${i}`,
      first_admin: {
        username: `c10.a${i}`,
        display_name: `A${i}`,
        email: `c10a${i}@x.test`,
        locale: "en",
      },
    });
    const grants = [
      P(F.dichThuat, KT),
      P(F.dichThuat, KD),
      P(F.thuNghiem, KT),
      P(F.thuNghiem, KD),
      P(F.baoCao, KD),
    ];
    const res = await Promise.all([
      ...Array.from({ length: 5 }, (_, i) =>
        binh("POST", "/admin/groups", { key: `c10-g${i}`, name: { vi: `G${i}` } }),
      ),
      ...grants.map((g) => binh("POST", "/admin/grants", g)),
      ...Array.from({ length: 5 }, (_, i) =>
        admin("POST", "/admin/features", { key: `c10-f${i}`, name: { vi: `F${i}` }, status: "on" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        admin("POST", "/admin/secrets", {
          name: `DIFY_C10_${i}`,
          value: `giatri-bi-mat-${i}-12345`,
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        binh("POST", "/admin/users", {
          username: `c10.u${i}`,
          display_name: `U${i}`,
          role: "member",
        }),
      ),
      ...Array.from({ length: 5 }, (_, i) => admin("POST", "/admin/tenants", tenant(i))),
    ]);
    expect(res.filter((r) => r.status < 200 || r.status >= 300).map((r) => r.status)).toEqual([]);
    expect(await audit(from, v0, res)).toBe(30);
  });

  it("ADM-FR-53 · C11 · đăng nhập/refresh (sổ sách) ∥ ghi cấu hình: config_version chỉ tăng theo số ghi cấu hình (5)", async () => {
    const { from, v0 } = await start();
    const login = () =>
      env.call("POST", "/auth/login", {
        body: { tenant_key: "acme", username: "lan", password: PW },
      });
    const res = await Promise.all([
      ...Array.from({ length: 10 }, login),
      ...Array.from({ length: 5 }, (_, i) =>
        binh("POST", "/admin/groups", { key: `c11-g${i}`, name: { vi: `G${i}` } }),
      ),
    ]);
    expect(await audit(from, v0, res)).toBe(5);
  });
});

describe("ADM-FR-53 · guard độ phủ và deadlocks (C12, C13)", () => {
  it("ADM-FR-53 · C12 · lock-order.int.test.ts của backend có ĐỦ 10 ca tên bắt đầu L1…L10 (guard; không đo logic)", () => {
    const text = readFileSync(join(ROOT, "apps/admin-api/src/lib/lock-order.int.test.ts"), "utf8");
    const missing: string[] = [];
    const titles = text
      .split("\n")
      .filter((l) => l.trim().startsWith("it("))
      .map((l) => l.split(/[^A-Za-z0-9]+/));
    for (let n = 1; n <= 10; n++) {
      if (!titles.some((tokens) => tokens.includes(`L${n}`))) missing.push(`L${n}`);
    }
    expect(missing).toEqual([]);
  });

  it("ADM-FR-53 · C13 · pg_stat_database.deadlocks của DB test không tăng trong cả file", async () => {
    expect(await env.deadlocks()).toBe(deadlocksAtStart);
  });
});
