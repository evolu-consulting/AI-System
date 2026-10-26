// contract-flow S3a · hạ tầng int: hub-api THẬT (khuôn HD3 `startHd3`) + gói contracts chế độ flow + cờ duyệt trên engine
// (`contractsAi.approvalEngine`, = env `CONTRACTS_APPROVAL_ENGINE=on`) + cầu `packRuns` lấy được cổng engine. Model giả như HD3.
// Không `it`.
import { expect } from "bun:test";
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../../apps/hub-api/src/modules/packs/kit/application/pack-runs.ports";
import { addRole, type CtxHd3, type FakeModel, type ModelCall, untilActions } from "../HD3/_hd3";
import { packsPath, startAdminN1 } from "../N1/_support/n1";
import { PA, startPd, T } from "../P-d/_support/pd";

export type CtxCf = CtxHd3 & { port: PackRunsPort };
export const caller = (p: { id: string; role: string }, tenantId = T.acme): PackRunCaller => ({
  userId: p.id,
  tenantId,
  role: p.role,
});

function fakeModel(): FakeModel & { provider: unknown } {
  const m = {
    calls: [] as ModelCall[],
    reply: { ok: false } as FakeModel["reply"],
    usage: { input: 1200, output: 300 },
    provider: null as unknown,
  };
  const usage = { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 };
  m.provider = {
    key: "fake",
    complete: async (r: ModelCall) => {
      m.calls.push({ model: r.model, system: r.system, prompt: r.prompt, maxTokens: r.maxTokens });
      return m.reply.ok
        ? { ok: true, text: m.reply.text, model: r.model, usage }
        : { ok: false, code: "FAILED", model: r.model, usage };
    },
  };
  return m;
}

export async function startCf(): Promise<CtxCf> {
  const waiters = new Map<string, ((o: string) => void)[]>();
  const model = fakeModel();
  const bridge: PackRunsBridge = {};
  const contractsAi = {
    tax: null,
    model: model.provider,
    approvalEngine: true,
    onSettled: (id: string, out: string) => {
      const w = waiters.get(id) ?? [];
      waiters.delete(id);
      for (const f of w) f(out);
    },
    onHandles: () => undefined,
  };
  const c = await startPd({
    processRunsPerTenant: 200,
    extraDeps: { packRuns: bridge, packs: { pkdemo: false, contracts: true, contractsAi } },
  });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  const admin = await startAdminN1(c.k);
  const ctx = {
    ...c,
    admin,
    model,
    port: bridge.port,
    extracted: (id: string) =>
      new Promise<string>((res) => waiters.set(id, [...(waiters.get(id) ?? []), res])),
    sweepOnce: async () => ({ tenants: 0, read: 0, closed: 0 }),
    reclaimOnce: async () => 0,
    stop: async () => {
      await admin.close();
      await c.stop();
    },
  } as CtxCf;
  const r = await admin.call("PUT", packsPath(T.acme, "contracts"));
  expect({ enable: r.status }).toEqual({ enable: 200 });
  await addRole(ctx, "editor", [PA.A, PA.B]);
  await addRole(ctx, "owner", [PA.A, PA.H]);
  await untilActions(ctx, "A", ["read", "write", "admin"]);
  return ctx;
}
