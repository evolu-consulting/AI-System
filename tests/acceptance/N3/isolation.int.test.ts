// N3-FR-01 · N3-FR-02 · N3-FR-03 · N3-NFR-02 · viết TRƯỚC code (phần cao: tenant/RLS/role gói). Đường chạy thật: `hub_api` +
// `SET ROLE <k>_rw` (gói) hoặc `app.scope` (Hub). Dữ liệu dựng bằng owner.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  enqueue,
  inHub,
  inPack,
  needNotify,
  notice,
  P,
  pgCode,
  resetNotify,
  type Sql,
  setupX2a,
  T,
} from "./_support/n3";

let sql: Sql;
beforeAll(async () => {
  sql = await setupX2a();
  await needNotify(sql);
});
afterAll(async () => {
  await sql.end();
});
const count = async (where = "true"): Promise<number> =>
  (
    await sql.unsafe<{ n: number }[]>(
      `select count(*)::int as n from hub.notifications where ${where}`,
    )
  )[0]?.n ?? -1;

describe("N3-FR-01 · ghi cùng tx nghiệp vụ", () => {
  it("commit ⇒ có hàng, tenant lấy từ tx (không từ đầu vào); rollback ⇒ không còn hàng", async () => {
    await resetNotify(sql);
    const n = await inPack("pkdemo", T.acme, (tx) => enqueue(tx, "pkdemo", [notice(P.lan.id)]));
    expect(n).toBe(1);
    const [row] = await sql<{ tenant_id: string; source: string; user_id: string }[]>`
      select tenant_id, source, user_id from hub.notifications`;
    expect(row).toEqual({ tenant_id: T.acme, source: "pkdemo", user_id: P.lan.id });

    await resetNotify(sql);
    await inPack("pkdemo", T.acme, (tx) => enqueue(tx, "pkdemo", [notice(P.lan.id)]), {
      rollback: true,
    });
    expect(await count()).toBe(0);
  });

  it("thiếu app.tenant_id ⇒ lỗi 22023, không ghi gì", async () => {
    await resetNotify(sql);
    const code = await pgCode(() =>
      inPack("pkdemo", null, (tx) => enqueue(tx, "pkdemo", [notice(P.lan.id)])),
    );
    expect(code).toBe("22023");
    expect(await count()).toBe(0);
  });

  it("khóa nguồn sai dạng / lô không phải mảng / quá 500 ⇒ 22023", async () => {
    const bad = async (source: string, body: string) =>
      pgCode(() =>
        inPack("pkdemo", T.acme, async (tx) => {
          await tx`select notify.enqueue(${source}, ${tx.json(JSON.parse(body))})`;
        }),
      );
    expect(await bad("BAD KEY", "[]")).toBe("22023");
    expect(await bad("pkdemo", "{}")).toBe("22023");
    const big = JSON.stringify(Array.from({ length: 501 }, () => notice(P.lan.id)));
    expect(await bad("pkdemo", big)).toBe("22023");
  });

  it("lô rỗng ⇒ 0 hàng, không lỗi; một câu cho cả lô", async () => {
    await resetNotify(sql);
    const n = await inPack("pkdemo", T.acme, (tx) =>
      enqueue(tx, "pkdemo", [
        notice(P.lan.id),
        notice(P.hoa.id),
        notice(P.lan.id, { kind: "demo.other" }),
      ]),
    );
    expect(n).toBe(3);
    expect(await inPack("pkdemo", T.acme, (tx) => enqueue(tx, "pkdemo", []))).toBe(0);
  });
});

describe("N3-FR-02 · idempotency theo khóa", () => {
  it("cùng (tenant, người nhận, nguồn, dedup_key) ⇒ 1 hàng, lần 2 trả 0; khác nguồn/khác người ⇒ hàng riêng", async () => {
    await resetNotify(sql);
    const dup = notice(P.lan.id, { dedup_key: "hd-1:30" });
    expect(await inPack("pkdemo", T.acme, (tx) => enqueue(tx, "pkdemo", [dup]))).toBe(1);
    expect(await inPack("pkdemo", T.acme, (tx) => enqueue(tx, "pkdemo", [dup, dup]))).toBe(0);
    expect(await count()).toBe(1);
    expect(await inPack("contracts", T.acme, (tx) => enqueue(tx, "contracts", [dup]))).toBe(1);
    expect(
      await inPack("pkdemo", T.acme, (tx) =>
        enqueue(tx, "pkdemo", [{ ...dup, user_id: P.hoa.id }]),
      ),
    ).toBe(1);
    expect(await count()).toBe(3);
  });

  it("thiếu dedup_key ⇒ mỗi lần một hàng riêng (khóa ngẫu nhiên)", async () => {
    await resetNotify(sql);
    await inPack("pkdemo", T.acme, (tx) => enqueue(tx, "pkdemo", [notice(P.lan.id)]));
    await inPack("pkdemo", T.acme, (tx) => enqueue(tx, "pkdemo", [notice(P.lan.id)]));
    expect(await count()).toBe(2);
  });
});

describe("N3-FR-03 · người nhận phải cùng tenant", () => {
  it("người của tenant khác (hoặc không tồn tại) bị bỏ qua lặng lẽ; người cùng tenant vẫn vào", async () => {
    await resetNotify(sql);
    const ghost = "a1000000-0000-4000-8000-0000000fffff";
    const n = await inPack("pkdemo", T.acme, (tx) =>
      enqueue(tx, "pkdemo", [notice(P.an.id), notice(ghost), notice(P.lan.id)]),
    );
    expect(n).toBe(1);
    const rows = await sql<
      { user_id: string; tenant_id: string }[]
    >`select user_id, tenant_id from hub.notifications`;
    expect([...rows]).toEqual([{ user_id: P.lan.id, tenant_id: T.acme }]);
  });
});

describe("N3-NFR-02 · role gói chỉ có EXECUTE cổng, không đọc bảng", () => {
  it("không USAGE hub/admin (PK-AC03 giữ nguyên), có USAGE notify + EXECUTE enqueue; mọi gói đã cài đều có", async () => {
    for (const k of ["pkdemo", "contracts"]) {
      const [r] = await sql<{ hub: boolean; adm: boolean; ntf: boolean; ex: boolean }[]>`select
        has_schema_privilege(${`${k}_rw`}, 'hub', 'USAGE') as hub,
        has_schema_privilege(${`${k}_rw`}, 'admin', 'USAGE') as adm,
        has_schema_privilege(${`${k}_rw`}, 'notify', 'USAGE') as ntf,
        has_function_privilege(${`${k}_rw`}, 'notify.enqueue(text,jsonb)', 'EXECUTE') as ex`;
      expect({ k, ...r }).toEqual({ k, hub: false, adm: false, ntf: true, ex: true });
    }
    const [pub] = await sql<
      { ex: boolean }[]
    >`select has_function_privilege('public', 'notify.enqueue(text,jsonb)', 'EXECUTE') as ex`;
    expect(pub?.ex).toBe(false);
  });

  it("gói đọc/ghi thẳng bảng thông báo ⇒ 42501", async () => {
    const sel = await pgCode(() =>
      inPack("pkdemo", T.acme, async (tx) => void (await tx`select 1 from hub.notifications`)),
    );
    const ins = await pgCode(() =>
      inPack("pkdemo", T.acme, async (tx) => {
        await tx`insert into hub.notifications (tenant_id, user_id, source, kind, title, dedup_key)
          values (${T.acme}, ${P.lan.id}, 'pkdemo', 'x.y', 't', 'k')`;
      }),
    );
    expect({ sel, ins }).toEqual({ sel: "42501", ins: "42501" });
  });

  it("hub_rw (Hub) cũng không INSERT thẳng — chỉ qua hàm; hàm gọi từ Hub dùng app.tenant_id", async () => {
    const ins = await pgCode(() =>
      inHub({ kind: "user", tenantId: T.acme, userId: P.lan.id }, async (tx) => {
        await tx`insert into hub.notifications (tenant_id, user_id, source, kind, title, dedup_key)
          values (${T.acme}, ${P.lan.id}, 'hub', 'x.y', 't', 'k')`;
      }),
    );
    expect(ins).toBe("42501");
    await resetNotify(sql);
    const n = await inHub({ kind: "user", tenantId: T.acme, userId: P.lan.id }, (tx) =>
      enqueue(tx, "hub", [notice(P.lan.id)]),
    );
    expect(n).toBe(1);
  });
});

describe("N3-NFR-02 · RLS đọc/ghi theo scope", () => {
  async function seed(): Promise<void> {
    await resetNotify(sql);
    await inPack("pkdemo", T.acme, (tx) =>
      enqueue(tx, "pkdemo", [
        notice(P.lan.id, { title: "của lan" }),
        notice(P.hoa.id, { title: "của hoa" }),
      ]),
    );
    await inPack("pkdemo", T.beta, (tx) =>
      enqueue(tx, "pkdemo", [notice(P.an.id, { title: "của an" })]),
    );
    await sql`insert into hub.notification_deliveries (notification_id, tenant_id, user_id, channel)
      select id, tenant_id, user_id, 'email' from hub.notifications`;
    await sql`insert into hub.notify_prefs (tenant_id, user_id, email) values (${T.acme}, ${P.lan.id}, false), (${T.beta}, ${P.an.id}, false)`;
    await sql`insert into hub.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
      values (${T.acme}, ${P.lan.id}, 'https://push.example/a', 'k', 'a'), (${T.beta}, ${P.an.id}, 'https://push.example/b', 'k', 'a')`;
  }
  const titles = (tx: Sql) =>
    tx<{ title: string }[]>`select title from hub.notifications order by title`;

  it("user thấy đúng thông báo/tùy chọn/đăng ký của MÌNH; không thấy người khác cùng tenant, không thấy tenant khác", async () => {
    await seed();
    const lan = await inHub({ kind: "user", tenantId: T.acme, userId: P.lan.id }, async (tx) => ({
      t: (await titles(tx)).map((x) => x.title),
      prefs: (await tx`select 1 from hub.notify_prefs`).length,
      subs: (await tx`select 1 from hub.push_subscriptions`).length,
    }));
    expect(lan).toEqual({ t: ["của lan"], prefs: 1, subs: 1 });
    const an = await inHub({ kind: "user", tenantId: T.beta, userId: P.an.id }, async (tx) =>
      (await titles(tx)).map((x) => x.title),
    );
    expect(an).toEqual(["của an"]);
  });

  it("tenant của phiên ≠ tenant của hàng ⇒ 0 hàng (user giả mạo cặp tenant/user)", async () => {
    await seed();
    const t = await inHub(
      { kind: "user", tenantId: T.beta, userId: P.lan.id },
      async (tx) => (await titles(tx)).length,
    );
    expect(t).toBe(0);
  });

  it("system thấy hết; không đặt scope ⇒ 0 hàng (fail-closed)", async () => {
    await seed();
    expect(await inHub({ kind: "system" }, async (tx) => (await titles(tx)).length)).toBe(3);
    expect(await inHub("none", async (tx) => (await titles(tx)).length)).toBe(0);
  });

  it("bản gửi chỉ system đọc/ghi: user 0 hàng, UPDATE 0 hàng", async () => {
    await seed();
    const r = await inHub({ kind: "user", tenantId: T.acme, userId: P.lan.id }, async (tx) => ({
      sel: (await tx`select 1 from hub.notification_deliveries`).length,
      upd: (await tx`update hub.notification_deliveries set status = 'dead'`).count,
    }));
    expect(r).toEqual({ sel: 0, upd: 0 });
    expect(
      await inHub(
        { kind: "system" },
        async (tx) => (await tx`select 1 from hub.notification_deliveries`).length,
      ),
    ).toBe(3);
  });

  it("user chỉ đánh dấu đã đọc hàng của mình (cột read_at); sửa nội dung/hàng người khác ⇒ 0 hàng hoặc 42501", async () => {
    await seed();
    const me = { kind: "user", tenantId: T.acme, userId: P.lan.id } as const;
    const r = await inHub(me, async (tx) => ({
      all: (await tx`update hub.notifications set read_at = now()`).count,
    }));
    expect(r.all).toBe(1); // chỉ hàng của lan
    const hoaUnread =
      await sql`select 1 from hub.notifications where user_id = ${P.hoa.id} and read_at is null`;
    expect(hoaUnread.length).toBe(1);
    const title = await pgCode(() =>
      inHub(me, async (tx) => void (await tx`update hub.notifications set title = 'hack'`)),
    );
    expect(title).toBe("42501");
  });

  it("prefs/subscription: user ghi cho chính mình; ghi cho người khác ⇒ vi phạm RLS (42501)", async () => {
    await seed();
    const me = { kind: "user", tenantId: T.acme, userId: P.lan.id } as const;
    const ok = await inHub(
      me,
      async (tx) =>
        (await tx`update hub.notify_prefs set push = false where user_id = ${P.lan.id}`).count,
    );
    expect(ok).toBe(1);
    const other = await pgCode(() =>
      inHub(me, async (tx) => {
        await tx`insert into hub.notify_prefs (tenant_id, user_id, email) values (${T.acme}, ${P.hoa.id}, false)`;
      }),
    );
    expect(other).toBe("42501");
  });
});
