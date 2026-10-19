// HD-FR-31…37 · hạ tầng int HD3: hub-api THẬT với engine (khuôn N2 `startN2`: launcher thật, runtime giả `ScriptRuntime` trả
// lời job agent như agent Claude — KHÔNG gọi AI thật, D3-11) + gói `contracts` chế độ flow (không seam transport) + admin-api
// bật gói cho acme. Người: A lan (editor + owner, người tải lên), B hoa (editor), H q01 (owner), X tam (không vai). Không `it`.
import { expect } from "bun:test";
import { CBASE, cid, insContract } from "../HD1/_support/hd1";
import { agentJson, C1_TEXT } from "../HD2/_support/hd2";
import { packGroupKey, packsPath, startAdminN1 } from "../N1/_support/n1";
import {
  type CtxPd,
  type Json,
  jobDone,
  nextStageJob,
  PA,
  type Role,
  startPd,
  T,
} from "../P-d/_support/pd";
import { settled } from "../P-d/d2/_d2";

export { agentJson, C1_TEXT, CBASE, cid, settled, T };
export type SweepOut = { tenants: number; read: number; closed: number };
export type CtxHd3 = CtxPd & {
  admin: Awaited<ReturnType<typeof startAdminN1>>;
  /** Lượt quét flow duyệt (hook `contractsAi.onHandles`; vòng nền tắt). */
  sweepOnce: () => Promise<SweepOut>;
};

/** Agent trích = agent seed `hd-read` (agentic-cli) — tool `contracts-extract` chạy job KHÔNG tool của agent này. */
export const EXTRACT_AGENT = "hd-read";

export async function startHd3(o: { processRunsPerTenant?: number } = {}): Promise<CtxHd3> {
  let h: { sweepOnce: () => Promise<SweepOut> } | null = null;
  const contractsAi = {
    tax: null,
    flowAgentKey: EXTRACT_AGENT,
    onHandles: (x: { sweepOnce: () => Promise<SweepOut> }) => {
      h = x;
    },
  };
  const c = await startPd({
    processRunsPerTenant: o.processRunsPerTenant ?? 200,
    extraDeps: { packs: { pkdemo: false, contracts: true, contractsAi } },
  });
  const admin = await startAdminN1(c.k);
  const sweepOnce = () => {
    expect({ sweepHandle: h !== null }).toEqual({ sweepHandle: true });
    return (h as unknown as { sweepOnce: () => Promise<SweepOut> }).sweepOnce();
  };
  const stop = async () => {
    await admin.close();
    await c.stop();
  };
  const ctx = { ...c, admin, sweepOnce, stop } as CtxHd3;
  const r = await admin.call("PUT", packsPath(T.acme, "contracts"));
  expect({ enable: r.status }).toEqual({ enable: 200 });
  await addRole(ctx, "editor", [PA.A, PA.B]);
  await addRole(ctx, "owner", [PA.A, PA.H]);
  await untilActions(ctx, "A", ["read", "write", "admin"]);
  return ctx;
}

export async function groupId(c: CtxHd3, role: "editor" | "owner" | "viewer"): Promise<string> {
  const [g] = await c.sql<{ id: string }[]>`select id from admin.groups
    where tenant_id = ${T.acme} and key = ${packGroupKey("contracts", role)}`;
  expect({ group: role, found: g !== undefined }).toEqual({ group: role, found: true });
  return g?.id as string;
}

export async function addRole(c: CtxHd3, role: "editor" | "owner", who: { id: string }[]) {
  const g = await groupId(c, role);
  await c.sql`insert into admin.group_members ${c.sql(
    who.map((u) => ({ tenant_id: T.acme, group_id: g, user_id: u.id })),
  )} on conflict do nothing`;
  await bump(c);
}

export async function bump(c: CtxHd3): Promise<void> {
  const [r] = await c.sql<{ v: number }[]>`update admin.config_meta
    set config_version = config_version + 1 returning config_version as v`;
  await c.sql`select pg_notify('config_changed',
    json_build_object('v', ${r?.v ?? 1}::int, 'entity', 'group', 'tenant_id', ${T.acme}::text)::text)`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

/** Chờ `/pack/contracts/me` của `role` có `actions` (tín hiệu nạp cache; lưới 10 ms như khuôn N1). */
export async function untilActions(c: CtxHd3, role: Role, want: string[]): Promise<void> {
  const end = Date.now() + 8_000;
  let got: string[] = [];
  while (Date.now() < end) {
    got = (await c.call(role, "GET", "/pack/contracts/me"))?.json?.actions ?? [];
    if (JSON.stringify(got) === JSON.stringify(want)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(got).toEqual(want);
}

/** HĐ acme có văn bản, `extract_failed`, chưa có run (người tạo A) — `/extract` mở run duyệt. */
export async function seedContract(c: CtxHd3, n: number, extra: Record<string, unknown> = {}) {
  await insContract(c.sql, {
    id: cid(n),
    tenant: T.acme,
    status: "extract_failed",
    source: C1_TEXT,
    createdBy: PA.A.id,
    ...extra,
  } as never);
  return cid(n);
}

export const approval = (c: CtxHd3, r: Role, id: string) =>
  c.call(r, "GET", `${CBASE}/${id}/approval`);
export const act = (c: CtxHd3, r: Role, id: string, action: string, feedback?: string) =>
  c.call(r, "POST", `${CBASE}/${id}/approval`, {
    action,
    ...(feedback === undefined ? {} : { feedback }),
  });
export const contractRow = async (c: CtxHd3, id: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, run_id, error, confirmed_by, confirmed_at, version
      from contracts.contracts where id = ${id}`
  )[0] as Json;
export const errCode = (r: { json: Json }) => r.json?.error?.code ?? null;

const total = (v: number) => ({
  total_value: { value: v, quote: `Tổng giá trị hợp đồng: ${v} đồng` },
});

/** A mở run (`/extract`) ⇒ job agent của stage `extract` ⇒ trả JSON trích (giá trị `v`) ⇒ chờ cấp 1. Trả {runId, job}. */
export async function toLevel1(
  c: CtxHd3,
  id: string,
  v: number,
): Promise<{ runId: string; job: Json }> {
  const r = await c.call("A", "POST", `${CBASE}/${id}/extract`);
  expect({ status: r.status, code: errCode(r) }).toEqual({ status: 202, code: null });
  const runId = (await contractRow(c, id)).run_id as string;
  expect({ run: typeof runId }).toEqual({ run: "string" });
  const job = await nextStageJob(c, runId);
  await jobDone(c, job, agentJson(total(v)));
  await settled(c);
  const a = await approval(c, "A", id);
  expect({ status: a.status, step: a.json?.step }).toEqual({ status: 200, step: "level1" });
  return { runId, job: job as unknown as Json };
}
