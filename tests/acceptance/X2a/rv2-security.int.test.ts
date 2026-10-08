// HUB-FR-96 · HUB-BR-22 · X2a-AC07 · test khoá cho security review vòng 2: N1 N2 N4b (N4a ở db-rls D18) — test-plan-rv2.md.
// Lưới DB: role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC như `withHubScope`; mỗi probe một transaction.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { HUB_API_URL } from "../H1/_fixtures";
import { asUser, type Ctx, idGenX, mkGroup, P, type Sql, say, startX2a, T } from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
let owner: Sql;
let db: Sql;
const id = idGenX(70_000);
beforeAll(async () => {
  c = await startX2a();
  owner = c.sql;
  db = postgres(HUB_API_URL, { max: 4, onnotice: () => {} });
}, 60_000);
afterAll(async () => {
  await db?.end();
  await c?.stop();
});

type Who = { id: string; tid: string };
/** Phòng nhóm lan (chủ) + hoa, `n` tin lúc `now()` (owner, bỏ qua RLS). */
async function seed(n = 2): Promise<string> {
  const rid = id();
  await owner`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
    values (${rid}, ${T.acme}, 'group', 'Nhóm RV2', ${n}, now(), ${P.lan.id}, now())`;
  for (const [p, role] of [
    [P.lan, "owner"],
    [P.hoa, "member"],
  ] as const)
    await owner`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
      values (${rid}, ${T.acme}, ${p.id}, ${role}, now(), 0)`;
  for (let s = 1; s <= n; s++)
    await owner`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
      values (${rid}, ${T.acme}, ${s}, 'user', ${P.lan.id}, ${`Tin ${s}`}, now())`;
  return rid;
}
/** Chạy `fn` dưới GUC `who` và COMMIT; trả mã lỗi PG ("ok" nếu không lỗi). Lỗi COMMIT cũng bắt ở đây. */
const run = async (who: Who, fn: (tx: postgres.TransactionSql) => Promise<unknown>) => {
  try {
    await asUser(db, who, fn, { commit: true });
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const lastSeq = async (rid: string) =>
  (await owner`select last_seq::int as n from hub.rooms where id = ${rid}`)[0]?.n as number;

describe("RV2-N1 · seq chỉ cấp kèm tin [security-2 N1 · X2a-AC07]", () => {
  it("HUB-BR-22 · RV2-N1a · thành viên gọi room_next_seq rồi COMMIT không chèn tin ⇒ COMMIT lỗi, last_seq giữ nguyên", async () => {
    const g = await seed(2);
    const r = await run(P.hoa, (tx) => tx`select hub.room_next_seq(${g})`);
    expect({ r: r !== "ok", seq: await lastSeq(g) }).toEqual({ r: true, seq: 2 });
  });

  it("HUB-BR-22 · RV2-N1b · gọi room_next_seq 3 lần rồi COMMIT không tin ⇒ lỗi, last_seq giữ, 0 tin mới", async () => {
    const g = await seed(2);
    const r = await run(P.hoa, async (tx) => {
      for (let i = 0; i < 3; i++) await tx`select hub.room_next_seq(${g})`;
    });
    const [m] = await owner`select count(*)::int as n from hub.room_messages where room_id = ${g}`;
    expect({ r: r !== "ok", seq: await lastSeq(g), n: m?.n }).toEqual({ r: true, seq: 2, n: 2 });
  });

  it("HUB-BR-22 · RV2-N1c · chuỗi hợp lệ room_next_seq → INSERT tin cùng seq → COMMIT ⇒ ok, last_seq+1 (hồi quy)", async () => {
    const g = await seed(2);
    const r = await run(P.hoa, async (tx) => {
      const [s] = await tx`select hub.room_next_seq(${g}) as s`;
      await tx`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at)
        values (${g}, ${T.acme}, ${s?.s}, 'user', ${P.hoa.id}, 'hợp lệ', now())`;
    });
    expect({ r, seq: await lastSeq(g) }).toEqual({ r: "ok", seq: 3 });
  });

  it("HUB-FR-96 · RV2-N1d · gửi qua API: seq liền sau các lần gửi (không seq ma), last_seq = số tin", async () => {
    const [a, b] = [await c.tok("lan"), await c.tok("hoa")];
    const g = await mkGroup(c.hub, a, [P.hoa.id], "RV2-N1d");
    const seqs: number[] = [];
    for (let i = 0; i < 3; i++) seqs.push((await say(c.hub, i % 2 ? b : a, g.id, `N1d-${i}`)).seq);
    const last = (await say(c.hub, b, g.id, "N1d-end")).seq;
    expect({ seqs, last, db: await lastSeq(g.id) }).toEqual({ seqs: [1, 2, 3], last: 4, db: 4 });
  });
});

describe("RV2-N2 · created_at / cột agent của tin do hệ thống quyết [security-2 N2 · P07]", () => {
  /** Gửi tin với `created_at` tuỳ ý + cột phụ; trả mã lỗi hoặc "ok". */
  const send = (
    g: string,
    who: Who,
    createdAt: string,
    extra: Record<string, string | null> = {},
  ) =>
    run(who, async (tx) => {
      const [s] = await tx`select hub.room_next_seq(${g}) as s`;
      await tx`insert into hub.room_messages (room_id, tenant_id, seq, sender_type, sender_id, content, created_at, run_id, flow_id, trigger_message_id)
        values (${g}, ${T.acme}, ${s?.s}, 'user', ${who.id}, 'N2', ${createdAt}::timestamptz,
          ${extra.run_id ?? null}, ${extra.flow_id ?? null}, ${extra.trigger_message_id ?? null})`;
    });

  it("HUB-BR-22 · RV2-N2a · INSERT tin created_at = 2001-01-01 ⇒ bị từ chối HOẶC created_at lưu ≥ created_at tin trước", async () => {
    const g = await seed(2);
    const [prev] =
      await owner`select max(created_at) as t from hub.room_messages where room_id = ${g}`;
    const r = await send(g, P.hoa, "2001-01-01T00:00:00Z");
    const [mx] =
      await owner`select created_at as t from hub.room_messages where room_id = ${g} and seq = 3`;
    const ok = r !== "ok" ? mx === undefined : (mx?.t as Date) >= (prev?.t as Date);
    expect({ r, ok }).toEqual({ r, ok: true });
  });

  it("HUB-BR-22 · RV2-N2b · created_at 2099 (tương lai) ⇒ bị từ chối HOẶC lưu ≤ now()+1 phút", async () => {
    const g = await seed(2);
    const r = await send(g, P.hoa, "2099-01-01T00:00:00Z");
    const [mx] =
      await owner`select (created_at <= now() + interval '1 minute') as ok from hub.room_messages where room_id = ${g} and seq = 3`;
    expect({ r, ok: r !== "ok" ? mx === undefined : mx?.ok === true }).toEqual({ r, ok: true });
  });

  for (const col of ["run_id", "flow_id", "trigger_message_id"] as const)
    it(`HUB-BR-22 · RV2-N2c · tin sender_type='user' có ${col} khác NULL ⇒ bị từ chối, không có hàng`, async () => {
      const g = await seed(2);
      const r = await send(g, P.hoa, new Date().toISOString(), { [col]: id() });
      const [m] =
        await owner`select count(*)::int as n from hub.room_messages where room_id = ${g}`;
      expect({ r: r !== "ok", n: m?.n }).toEqual({ r: true, n: 2 });
    });

  it("HUB-BR-22 · RV2-N2d · tin user created_at = now(), cột agent NULL ⇒ ok (hồi quy)", async () => {
    const g = await seed(2);
    expect(await send(g, P.hoa, new Date().toISOString())).toBe("ok");
    expect(await lastSeq(g)).toBe(3);
  });
});

describe("RV2-N4b · đúng một policy UPDATE permissive [security-2 N4b]", () => {
  it("HUB-BR-22 · RV2-N4b · room_members có đúng 1 policy UPDATE permissive (trigger room_members_guard suy chủ từ đó)", async () => {
    const rows =
      await owner`select policyname from pg_policies where schemaname = 'hub' and tablename = 'room_members'
      and permissive = 'PERMISSIVE' and cmd in ('UPDATE', 'ALL')`;
    expect(rows.map((r) => r.policyname)).toEqual(["room_members_update"]);
  });
});
