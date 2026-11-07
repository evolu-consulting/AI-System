// CR-125 · m9 · đầu ra máy chủ ghi thật (bỏ `pending`): Hub THẬT (khuôn P-d + cầu packRuns) — gói bắn `signalEvent(…, data)` ⇒ dữ liệu kèm
// vào output của bước chờ CÙNG tx thả bước (Ký số: signed_at / signer / envelope_id; Gửi đối tác: round / partner_reason); bắn lại ⇒ không
// đổi; Thông báo sau Ký số dựng `{signed_at}` từ đầu ra bước trước + ghi `sent_to`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../../apps/hub-api/src/modules/packs/kit/application/pack-runs.ports";
import { type CtxPd, defBody, type Json, PA, startPd, T, waitStatus } from "../P-d/_support/pd";

const who = (p: { id: string; role: string }): PackRunCaller => ({
  userId: p.id,
  tenantId: T.acme,
  role: p.role,
});
const A = who(PA.A);
const ADM = who(PA.Adm);

const stage = (key: string, step: number, executor: Json): Json => ({
  key,
  name: `Bước ${key}`,
  step,
  executor,
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: `# ${key}\n\n## Kết quả\n`,
    required_sections: ["Kết quả"],
    fields: [],
  },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 60,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
});
const wait = (key: string, event: string, also: string[]) =>
  stage(key, 0, { kind: "wait_event", event, also_events: also, timeout_h: 24 });
const notify = stage("bao", 1, {
  kind: "notify",
  to: [{ who: "starter" }],
  channels: ["bell"],
  title: "Đã ký ngày {signed_at} bởi {signer}",
  body: "Phong bì {envelope_id}",
});
const INPUTS = [{ key: "contract_id", label: "HĐ", type: "text", required: true }];

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  port = bridge.port;
}, 90_000);
afterAll(async () => {
  if (c) await c.stop();
});

async function startRun(key: string, stages: Json[], rec: string): Promise<string> {
  expect(await port.ensureDef(ADM, key, defBody(key, stages, { inputs: INPUTS }), 1)).toBe(
    "created",
  );
  const s = await port.start(A, {
    process_key: key,
    input: "HĐ",
    inputs: [{ type: "text", key: "contract_id", text: rec }],
    ref: { pack: "contracts", record_id: rec },
  });
  await s.kick();
  await waitStatus(c.sql, s.runId, "waiting_timer");
  return s.runId;
}
const fieldsAt = async (runId: string, idx: number): Promise<Json> => {
  const [r] = await c.sql<Json[]>`select o.fields from hub.stage_runs s
    join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
    where s.process_run_id = ${runId} and s.stage_idx = ${idx}`;
  return r?.fields ?? null;
};

describe("CR-125 m9 · đầu ra chạm trạng thái run (ghi thật)", () => {
  it("Ký số xong ⇒ bước chờ có signed_at/signer/envelope_id; bắn lại không đổi; Thông báo sau đó dựng {signed_at} + ghi sent_to", async () => {
    const REC = "c1250000-0000-4000-8000-000000000901";
    const runId = await startRun(
      "cr125-m9-esign",
      [wait("ky", "esign.completed", ["esign.declined", "esign.voided"]), notify],
      REC,
    );
    const ref = { pack: "contracts", record_id: REC };
    const data = { envelope_id: "env-9", signed_at: "2026-11-07", signer: "An, Bình" };
    expect(await port.signalEvent(T.acme, ref, "esign.completed", data)).toBe(1);
    await waitStatus(c.sql, runId, "done");
    expect(await fieldsAt(runId, 0)).toEqual({ ...data, event: "esign.completed" });
    // Bắn lại (webhook + đồng bộ) với dữ liệu khác ⇒ không thả, output giữ nguyên.
    const again = { ...data, signer: "Khác" };
    expect(await port.signalEvent(T.acme, ref, "esign.completed", again)).toBe(0);
    expect((await fieldsAt(runId, 0))?.signer).toBe("An, Bình");
    const notes = await c.sql<Json[]>`select user_id::text as u, title, body from hub.notifications
      where dedup_key like ${`pn:${runId}:%`}`;
    expect(notes.map((n) => ({ u: n.u, title: n.title, body: n.body }))).toEqual([
      { u: PA.A.id, title: "Đã ký ngày 2026-11-07 bởi An, Bình", body: "Phong bì env-9" },
    ]);
    const sent = (await fieldsAt(runId, 1)) as { sent_to?: string } | null;
    expect(typeof sent?.sent_to).toBe("string");
    expect((sent?.sent_to ?? "").length).toBeGreaterThan(0);
  }, 60_000);

  it("Gửi đối tác: trả lại sửa ⇒ bước chờ có round + partner_reason; dữ liệu của sự kiện khác không lẫn vào", async () => {
    const REC = "c1250000-0000-4000-8000-000000000902";
    const runId = await startRun(
      "cr125-m9-partner",
      [wait("cho", "partner.confirmed", ["partner.returned", "partner.declined"]), notify],
      REC,
    );
    const ref = { pack: "contracts", record_id: REC };
    // Tenant khác bắn cùng bản ghi ⇒ không thả (lọc tenant).
    expect(await port.signalEvent(T.beta, ref, "partner.returned", { round: 9 })).toBe(0);
    expect(
      await port.signalEvent(T.acme, ref, "partner.returned", {
        round: 2,
        partner_reason: "Sai giá",
      }),
    ).toBe(1);
    await waitStatus(c.sql, runId, "done");
    expect(await fieldsAt(runId, 0)).toEqual({
      round: 2,
      partner_reason: "Sai giá",
      event: "partner.returned",
    });
  }, 60_000);
});
