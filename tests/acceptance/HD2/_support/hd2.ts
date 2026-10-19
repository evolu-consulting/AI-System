// HD-FR-21…26 · hạ tầng int HD2: như HD1 (`startHd1`: DB sạch X2a, hub-api THẬT in-process + admin-api THẬT, FileBox giả)
// + seam `deps.packs.contractsAi` = agent trích GIẢ tất định (không gọi AI thật) + tra MST giả + hook `onSettled` để CHỜ
// lượt trích xong bằng tín hiệu (không sleep/poll). Không chứa `it(...)`.
import { expect } from "bun:test";
import { createApp as createHubApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { startFbFake } from "../../FB1/_fbfake";
import {
  call,
  HUB_API_URL,
  type HubDeps,
  makeKeys,
  REDIS_TEST_URL,
  sign,
} from "../../H1/_fixtures";
import { CK } from "../../HD1/_support/hd1";
import {
  type AdminN1,
  bumpConfig,
  type CtxN1,
  type HubN1,
  type P,
  packGroupKey,
  packsPath,
  startAdminN1,
} from "../../N1/_support/n1";
import { setupX2a } from "../../X2a/_x2a";

export * from "../../HD1/_support/hd1";

type Person = (typeof P)[keyof typeof P];
export type AgentCall = { contractId: string; system: string; prompt: string; tenantId: string };
export type AgentScript = (
  c: AgentCall,
) => { ok: true; text: string } | { ok: false; code: "AGENT_FAILED" | "TIMEOUT" };
export type TaxAnswer =
  | { result: "found"; name: string; status: string | null }
  | {
      result: "not_found" | "unavailable" | "invalid";
    };

/** Điều khiển agent giả + tra MST giả + chờ trích xong. */
export type Ai = {
  calls: AgentCall[];
  taxCalls: string[];
  script: AgentScript;
  tax: Record<string, TaxAnswer>;
  /** Promise resolve khi HĐ `id` trích xong lượt kế tiếp (đăng ký TRƯỚC khi kích hoạt). */
  settled(id: string): Promise<string>;
  reset(): void;
};
export type CtxHd2 = CtxN1 & { ai: Ai };

function makeAi(): Ai & { onSettled: (id: string, o: string) => void } {
  const waiters = new Map<string, ((o: string) => void)[]>();
  const ai = {
    calls: [] as AgentCall[],
    taxCalls: [] as string[],
    script: (() => ({ ok: false, code: "AGENT_FAILED" })) as AgentScript,
    tax: {} as Record<string, TaxAnswer>,
    settled: (id: string) =>
      new Promise<string>((res) => {
        waiters.set(id, [...(waiters.get(id) ?? []), res]);
      }),
    onSettled: (id: string, o: string) => {
      const w = waiters.get(id) ?? [];
      waiters.delete(id);
      for (const f of w) f(o);
    },
    reset: () => {
      ai.calls.length = 0;
      ai.taxCalls.length = 0;
      ai.tax = {};
      ai.script = () => ({ ok: false, code: "AGENT_FAILED" });
    },
  };
  return ai;
}

async function startHubHd2(
  k: Awaited<ReturnType<typeof makeKeys>>,
  fb: ReturnType<typeof startFbFake>,
  ai: ReturnType<typeof makeAi>,
): Promise<HubN1> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = "qc-hd2-1";
  const contractsAi = {
    transport: async (r: {
      who: { tenantId: string };
      contractId: string;
      system: string;
      prompt: string;
    }) => {
      const c = {
        contractId: r.contractId,
        system: r.system,
        prompt: r.prompt,
        tenantId: r.who.tenantId,
      };
      ai.calls.push(c);
      return ai.script(c);
    },
    tax: {
      lookup: async (taxId: string) => {
        ai.taxCalls.push(taxId);
        return ai.tax[taxId] ?? { result: "unavailable" as const };
      },
    },
    onSettled: ai.onSettled,
  };
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
    packs: { contracts: true, filebox: { url: fb.origin, token: fb.token }, contractsAi },
  } as HubDeps & Record<string, unknown>;
  const app = createHubApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

export async function startHd2(): Promise<CtxHd2> {
  const sql = await setupX2a();
  const k = await makeKeys();
  const fb = startFbFake();
  const ai = makeAi();
  const hub = await startHubHd2(k, fb, ai);
  const admin: AdminN1 = await startAdminN1(k);
  const tok = (p: Person) => sign(k, p);
  return {
    sql,
    k,
    hub,
    fb,
    admin,
    tok,
    ai,
    hubCall: async (p, method, path, body) =>
      call(hub, method, path, { token: await tok(p), body }),
    enable: async (tenantId, key = CK) => {
      const r = await admin.call("PUT", packsPath(tenantId, key));
      expect({ status: r.status }).toEqual({ status: 200 });
      return r.json;
    },
    addToRole: async (tenantId, role, who, key = CK) => {
      const [g] = await sql<{ id: string }[]>`select id from admin.groups
        where tenant_id = ${tenantId} and key = ${packGroupKey(key, role)}`;
      expect({ group: packGroupKey(key, role), found: g !== undefined }).toEqual({
        group: packGroupKey(key, role),
        found: true,
      });
      await sql`insert into admin.group_members ${sql(
        who.map((p) => ({ tenant_id: tenantId, group_id: g?.id as string, user_id: p.id })),
      )} on conflict do nothing`;
      await bumpConfig(sql, tenantId);
    },
    stop: async () => {
      await hub.stop();
      await admin.close();
      await fb.close();
      await sql.end();
    },
  } as CtxHd2;
}

// ---------- đầu ra agent mẫu ----------
const KEYS = [
  "number",
  "title",
  "type",
  "supplier_name",
  "supplier_tax_id",
  "supplier_address",
  "supplier_representative",
  "buyer_name",
  "buyer_tax_id",
  "buyer_representative",
  "signed_date",
  "start_date",
  "end_date",
  "effective_date",
  "auto_renew",
  "notice_days",
  "total_value",
  "vat_rate",
  "vat_included",
  "payment_terms",
  "delivery_terms",
  "warranty",
  "penalty",
] as const;
type Out = { value: unknown; quote: string };
/** JSON đầu ra hợp lệ: khoá không nêu ⇒ `{value:null, quote:""}`. */
export function agentJson(
  f: Partial<Record<(typeof KEYS)[number], Out>>,
  items: Record<string, unknown>[] = [],
  clauses: { number: string; topic: string }[] = [],
): string {
  const fields = Object.fromEntries(KEYS.map((k) => [k, f[k] ?? { value: null, quote: "" }]));
  return JSON.stringify({ fields, items, clauses });
}
export const item = (o: Record<string, unknown>) => ({
  code: null,
  spec: null,
  unit: null,
  qty: null,
  unit_price: null,
  vat_rate: null,
  moq: null,
  lead_time_days: null,
  valid_from: null,
  valid_to: null,
  quote: "",
  ...o,
});

/** Văn bản HĐ mẫu (DOCX giả đã đổi sang văn bản — chèn thẳng `source_text`). */
export const C1_TEXT = [
  "HỢP ĐỒNG MUA BÁN số 01/2026/HĐMB-PN",
  "Bên bán: Công ty TNHH Bao Bì Phương Nam, MST: 0312345678",
  "Bên mua: Công ty Cổ phần Thực phẩm An Khang, MST 0109876543",
  "Thời hạn hợp đồng từ ngày 01/01/2026 đến hết ngày 31/12/2026.",
  "Tổng giá trị hợp đồng: 245.000.000 đồng (đã bao gồm VAT 8%).",
  "| Thùng carton 5 lớp | thùng | 1000 | 245.000 |",
].join("\n");
