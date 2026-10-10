// HUB-FR-104…117 · HUB-BR-25 · hạ tầng int P-a (test-plan §1–§2, test-plan-int; plan-contract §7.1 seam): DB sạch X2b (fixture
// H1 + user X2a + cấu hình Hub + quyền agent X2b) + persona P-a + Group "Kế toán"/"PO"/"Tech lead" + phòng R (owner SQL) +
// hub-api thật in-process với seam N3 (`processEngine`, `processLoops:false`, `onProcessHandles`, `stageLauncher` giả, `now`).
// Fixture quy trình (`insertDef`, `insertRun`, `insertEvent`, `insertOutput`, `insertTask`) chèn bảng 0019 ⇒ CHỈ gọi sau
// `hasPaSchema` = true (test-plan §5). Không chứa `it(...)`. Mỗi PF chỉ import file này + file thư mục mình.
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis, type Redis } from "../../../../apps/hub-api/src/lib/redis";
import {
  HUB_API_URL,
  type HubDeps,
  type Keys,
  makeKeys,
  REDIS_TEST_URL,
  sign,
  T,
} from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { ScriptRuntime } from "../../H1/_runtime";
import { api, type HubX2a, Q } from "../../X2a/_x2a";
import { AGB, cm, type Json, P, type Res, type Sql, setupX2b, waitFor } from "../../X2b/_x2b";
import { hasPaSchema } from "./schema";

export { AGB, api, cm, type Json, type Res, type Sql, T, waitFor };

// ---------- id cố định (dải `a5a0…`; ca tự sinh dùng `idGenPa(base ≥ 1000)`) ----------
const x = (n: number) => `a5a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function idGenPa(base: number): () => string {
  let n = base;
  return () => x(n++);
}
/** Id cố định dùng chung mọi file P-a (test-plan §2). */
export const PA_FIX = {
  room: x(1), // phòng R (acme): lan owner, hoa, tam; q05 đã rời
  roomOther: x(2), // phòng R2 (acme): hoa owner, tam — cho "run phòng khác"
  gKeToan: x(11), // Group "Kế toán": hoa, cuc
  gPO: x(12), // Group "PO": hoa
  gTech: x(13), // Group "Tech lead": hoa, cuc
  tadminBeta: x(21),
  defHoaDon: x(31), // `hoa-don-t` (acme): stage 0 review Kế toán, stage 1 real_action
  defAuto: x(32), // `p-auto` (acme): 2 stage auto
  defBeta: x(33), // `hoa-don-t` (beta)
} as const;

// ---------- persona (test-plan §2) ----------
type Person = (typeof P)["lan"];
const tadminBeta: Person = {
  id: PA_FIX.tadminBeta,
  tid: T.beta,
  username: "tadmin_beta",
  display_name: "tadmin_beta",
  role: "tenant_admin",
  locale: "vi",
  active: true,
  locked: false,
};
const q = (i: number): Person => Q[i - 1] as Person;
/** A lan · B hoa · X tam · T cuc · H q01 · H2–H4 q02–q04 · L q05 (rời R) · Adm tadmin · P padmin · D an / tadmin_beta · K khoa. */
export const PA = {
  A: P.lan,
  B: P.hoa,
  X: P.tam,
  T: P.cuc,
  H: q(1),
  H2: q(2),
  H3: q(3),
  H4: q(4),
  L: q(5),
  Adm: P.tadmin,
  P: P.padmin,
  D: P.an,
  Db: tadminBeta,
  K: P.khoa,
} as const;
export type Role = keyof typeof PA;

async function insertPaData(sql: Sql): Promise<void> {
  const b = tadminBeta;
  await sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale, active,
      locked_by_tenant, must_change_password)
    values (${b.id}, ${b.tid}, ${b.username}, 'tadmin_beta@example.test', 'x', ${b.display_name}, 'tenant_admin', 'vi',
      true, false, false)`;
  const nm = (vi: string, en: string) => sql.json({ vi, en });
  await sql`insert into admin.groups (id, tenant_id, key, name) values
    (${PA_FIX.gKeToan}, ${T.acme}, 'ke-toan', ${nm("Kế toán", "Accounting")}),
    (${PA_FIX.gPO}, ${T.acme}, 'po', ${nm("PO", "PO")}),
    (${PA_FIX.gTech}, ${T.acme}, 'tech-lead', ${nm("Tech lead", "Tech lead")})`;
  const gm = (g: string, u: Person) => ({ tenant_id: T.acme, group_id: g, user_id: u.id });
  await sql`insert into admin.group_members ${sql([
    gm(PA_FIX.gKeToan, PA.B),
    gm(PA_FIX.gKeToan, PA.T),
    gm(PA_FIX.gPO, PA.B),
    gm(PA_FIX.gTech, PA.B),
    gm(PA_FIX.gTech, PA.T),
  ])}`;
  await sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at) values
    (${PA_FIX.room}, ${T.acme}, 'group', 'Phòng R', 0, now(), ${PA.A.id}, now()),
    (${PA_FIX.roomOther}, ${T.acme}, 'group', 'Phòng R2', 0, now(), ${PA.B.id}, now())`;
  const m = (room: string, u: Person, role: string, left = false) => ({
    room_id: room,
    tenant_id: T.acme,
    user_id: u.id,
    role,
    joined_at: new Date(Date.now() - 86_400_000),
    last_read_seq: 0,
    left_at: left ? new Date(Date.now() - 3_600_000) : null,
  });
  await sql`insert into hub.room_members ${sql([
    m(PA_FIX.room, PA.A, "owner"),
    m(PA_FIX.room, PA.B, "member"),
    m(PA_FIX.room, PA.X, "member"),
    m(PA_FIX.room, PA.L, "member", true),
    m(PA_FIX.roomOther, PA.B, "owner"),
    m(PA_FIX.roomOther, PA.X, "member"),
  ])}`;
}

/** DB sạch X2b + persona/Group/phòng P-a. Trả `{sql, ready}` — `ready` = migration 0019 có (chèn quy trình chỉ khi true). */
export async function setupPa(): Promise<{ sql: Sql; ready: boolean }> {
  const sql = await setupX2b();
  await insertPaData(sql);
  return { sql, ready: await hasPaSchema(sql) };
}

// ---------- hub-api thật + seam N3 ----------
export type PaOpts = {
  /** cờ `processEngine` (mặc định true; S0-10 truyền false). */
  flag?: boolean;
  now?: () => Date;
  processRunsPerTenant?: number;
  instanceId?: string;
};
export type HubPa = HubX2a & {
  /** `ProcessHandles` nhận qua `onProcessHandles` (B0 chưa có ⇒ null ⇒ đỏ ở expect). */
  handles: () => Json | null;
  /** runId mà `stageLauncher.kick` giả nhận (PF2/PF3 dùng; không chạy stage thật). */
  kicks: string[];
};
export async function startHubPa(k: Keys, o: PaOpts = {}): Promise<HubPa> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = o.instanceId ?? "qc-pa-1";
  let handles: Json | null = null;
  const kicks: string[] = [];
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    processEngine: o.flag ?? true,
    processLoops: false,
    processRunsPerTenant: o.processRunsPerTenant,
    now: o.now,
    stageLauncher: {
      kick: async (runId: string) => {
        kicks.push(runId);
      },
    },
    onProcessHandles: (h: Json) => {
      handles = h;
    },
  } as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    handles: () => handles,
    kicks,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

export type CtxPa = {
  sql: Sql;
  ready: boolean;
  k: Keys;
  hub: HubPa;
  redis: Redis;
  rt: ScriptRuntime;
  tok: (r: Role) => Promise<string>;
  /** Gọi API với persona (body JSON lỗi ⇒ `json` null, không TypeError). */
  call: (r: Role, method: string, path: string, body?: unknown) => Promise<Res>;
  stop: () => Promise<void>;
};
export async function startPa(o: PaOpts = {}): Promise<CtxPa> {
  const { sql, ready } = await setupPa();
  const k = await makeKeys();
  const hub = await startHubPa(k, o);
  const redis = await testRedis();
  const rt = new ScriptRuntime(sql, redis);
  const tok = (r: Role) => sign(k, PA[r]);
  return {
    sql,
    ready,
    k,
    hub,
    redis,
    rt,
    tok,
    call: async (r, method, path, body) => api(hub, await tok(r), method, path, body),
    stop: async () => {
      await hub.stop();
      redis.disconnect();
      await sql.end();
    },
  };
}

/** POST tin phòng (thêm `client_msg_id`); trả header quy trình/flow. */
export async function postRoom(c: CtxPa, r: Role, roomId: string, body: Json) {
  const res = await c.call(r, "POST", `/rooms/${roomId}/messages`, {
    client_msg_id: cm(),
    ...body,
  });
  return {
    res,
    processRunId: res.headers.get("x-process-run-id"),
    flowId: res.headers.get("x-flow-id"),
    runId: res.headers.get("x-run-id"),
  };
}

export * from "./process-fixtures";
