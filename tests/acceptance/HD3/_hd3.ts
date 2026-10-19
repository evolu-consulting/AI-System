// HD-FR-31…37 · M3-decouple · hạ tầng int HD3: hub-api THẬT (khuôn N2 `startPd`) + gói `contracts` chế độ flow — duyệt là máy
// trạng thái của gói (`contracts.approvals`), lượt AI đọc là job Redis Streams gọi model TRỰC TIẾP qua AI client chung. Model giả
// (`contractsAi.model`, KHÔNG AI thật) trả JSON trích như Claude và ghi lại mọi yêu cầu (kiểm không tool / lời nhắc có rào); chờ lượt
// đọc xong bằng tín hiệu `onSettled` (không sleep/poll). Người: A lan (editor + owner, người tải lên), B hoa (editor), H q01 (owner),
// X tam (không vai). Không `it`.
import { expect } from "bun:test";
import { CBASE, cid, insContract } from "../HD1/_support/hd1";
import { agentJson, C1_TEXT } from "../HD2/_support/hd2";
import { packGroupKey, packsPath, startAdminN1 } from "../N1/_support/n1";
import { type CtxPd, type Json, PA, type Role, startPd, T } from "../P-d/_support/pd";
import { settled } from "../P-d/d2/_d2";

export { agentJson, C1_TEXT, CBASE, cid, settled, T };
export type SweepOut = { tenants: number; read: number; closed: number };
/** Một yêu cầu model mà AI client gửi (đúng hình dạng `ModelRequest`). */
export type ModelCall = { model: string; system: string; prompt: string; maxTokens: number };
export type FakeModel = {
  calls: ModelCall[];
  /** Văn bản model trả cho lượt kế (mặc định: lỗi). */
  reply: { ok: true; text: string } | { ok: false };
  usage: { input: number; output: number };
};
export type CtxHd3 = CtxPd & {
  admin: Awaited<ReturnType<typeof startAdminN1>>;
  model: FakeModel;
  /** Promise resolve khi lượt AI đọc của HĐ `id` xong (đăng ký TRƯỚC khi kích hoạt). */
  extracted(id: string): Promise<string>;
  /** Lượt quét flow duyệt (hook `contractsAi.onHandles`; vòng nền tắt). */
  sweepOnce: () => Promise<SweepOut>;
  /** Nhận lại job AI treo trong PEL (XAUTOCLAIM). */
  reclaimOnce: () => Promise<number>;
};

function fakeModel(): FakeModel & { provider: unknown } {
  const m = {
    calls: [] as ModelCall[],
    reply: { ok: false } as FakeModel["reply"],
    usage: { input: 1200, output: 300 },
    provider: null as unknown,
  };
  m.provider = {
    key: "fake",
    complete: async (r: ModelCall & { signal: AbortSignal }) => {
      m.calls.push({ model: r.model, system: r.system, prompt: r.prompt, maxTokens: r.maxTokens });
      const usage = {
        inputTokens: m.usage.input,
        outputTokens: m.usage.output,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      return m.reply.ok
        ? { ok: true, text: m.reply.text, model: r.model, usage }
        : { ok: false, code: "FAILED", model: r.model, usage };
    },
  };
  return m;
}

export async function startHd3(o: { processRunsPerTenant?: number } = {}): Promise<CtxHd3> {
  let h: { sweepOnce: () => Promise<SweepOut>; reclaimOnce: () => Promise<number> } | null = null;
  const waiters = new Map<string, ((o: string) => void)[]>();
  const model = fakeModel();
  const contractsAi = {
    tax: null,
    model: model.provider,
    onSettled: (id: string, out: string) => {
      const w = waiters.get(id) ?? [];
      waiters.delete(id);
      for (const f of w) f(out);
    },
    onHandles: (x: NonNullable<typeof h>) => {
      h = x;
    },
  };
  const c = await startPd({
    processRunsPerTenant: o.processRunsPerTenant ?? 200,
    extraDeps: { packs: { pkdemo: false, contracts: true, contractsAi } },
  });
  const admin = await startAdminN1(c.k);
  const handle = () => {
    expect({ handles: h !== null }).toEqual({ handles: true });
    return h as unknown as NonNullable<typeof h>;
  };
  const stop = async () => {
    await admin.close();
    await c.stop();
  };
  const ctx = {
    ...c,
    admin,
    model,
    extracted: (id: string) =>
      new Promise<string>((res) => waiters.set(id, [...(waiters.get(id) ?? []), res])),
    sweepOnce: () => handle().sweepOnce(),
    reclaimOnce: () => handle().reclaimOnce(),
    stop,
  } as CtxHd3;
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

/** HĐ acme có văn bản, `extract_failed`, chưa có lượt duyệt (người tạo A) — `/extract` mở lượt duyệt. */
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
/** Lượt duyệt (máy trạng thái của gói) — thay `hub.process_runs`. */
export const approvalRow = async (c: CtxHd3, runId: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, started_by, level1_by, decided_by, feedback, tenant_id
      from contracts.approvals where id = ${runId}`
  )[0] as Json;
export const errCode = (r: { json: Json }) => r.json?.error?.code ?? null;

export const total = (v: number) => ({
  total_value: { value: v, quote: `Tổng giá trị hợp đồng: ${v} đồng` },
});

/** A mở lượt duyệt (`/extract`) ⇒ job AI đọc ⇒ model giả trả JSON trích (giá trị `v`) ⇒ chờ cấp 1. Trả {runId, call}. */
export async function toLevel1(
  c: CtxHd3,
  id: string,
  v: number,
): Promise<{ runId: string; call: ModelCall }> {
  c.model.reply = { ok: true, text: agentJson(total(v)) };
  const done = c.extracted(id);
  const before = c.model.calls.length;
  const r = await c.call("A", "POST", `${CBASE}/${id}/extract`);
  expect({ status: r.status, code: errCode(r) }).toEqual({ status: 202, code: null });
  const runId = (await contractRow(c, id)).run_id as string;
  expect({ run: typeof runId }).toEqual({ run: "string" });
  expect(await done).toBe("needs_review");
  const a = await approval(c, "A", id);
  expect({ status: a.status, step: a.json?.step }).toEqual({ status: 200, step: "level1" });
  return { runId, call: c.model.calls[before] as ModelCall };
}
