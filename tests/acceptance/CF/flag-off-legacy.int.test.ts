// CR-122 · W1 · lúc deploy mọi công ty ĐỂ CỜ `FLOW_TRIGGERS` TẮT (`hub.tenant_flow_settings` không có dòng / false) ⇒ đường khe/engine cũ
// chạy y như trước CR-122: AI đọc xong ⇒ lượt `level1` mở run engine NGAY (mode engine, không chờ flow `FLOW_STARTING`), mẫu = bản xuất
// bản HIỆN HÀNH của quy trình khe (hub 0111 thêm release mới chép `slot_body` ⇒ cùng bước), thẻ duyệt (`getApproval`) có bước mở;
// Đạt bước 0 (dưới ngưỡng) ⇒ finalize: Đã duyệt + khoá. Hub THẬT (khuôn `startCf`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { approval, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, caller, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

describe("CR-122 W1 · cờ FLOW_TRIGGERS tắt ⇒ đường khe/engine cũ", () => {
  it("cờ tắt ⇒ AI đọc xong mở run engine như cũ (bản xuất bản hiện hành, thẻ có bước mở) · Đạt bước 0 ⇒ Đã duyệt + khoá", async () => {
    const [flag] = await c.sql<
      Json[]
    >`select coalesce((select flow_triggers from hub.tenant_flow_settings
      where tenant_id = ${T.acme}), false) as on`;
    expect(flag?.on).toBe(false);
    const id = await seedContract(c, 731);
    const aid = (await toLevel1(c, id, 10_000_000)).runId;
    const [a] = await c.sql<Json[]>`select status, mode, engine_run_id::text as run, flow_version,
      feedback, jsonb_array_length(flow_steps) as n from contracts.approvals where id = ${aid}`;
    const [pub] = await c.sql<Json[]>`select d.published_version as v from hub.process_slots s
      join hub.process_defs d on d.id = s.default_def_id where s.slot = 'contracts.approval'`;
    expect({ s: a?.status, m: a?.mode, v: a?.flow_version, fb: a?.feedback, n: a?.n }).toEqual({
      s: "level1",
      m: "engine",
      v: pub?.v,
      fb: null,
      n: 2,
    });
    const run = a?.run as string;
    await waitStatus(c.sql, run, "waiting_review");
    const card = (await approval(c, "A", id)).json as Json;
    expect({ mode: card.mode, run: card.engine_run_id, open: card.steps?.[0]?.status }).toEqual({
      mode: "engine",
      run,
      open: "open",
    });
    expect(await c.port.act(caller(PA.B), run, { stage: "s0" }, { result: "pass" })).toBe("ok");
    await waitStatus(c.sql, run, "done");
    const [k] = await c.sql<
      Json[]
    >`select status, confirmed_by::text as by, locked_at is not null as locked
      from contracts.contracts where id = ${id}`;
    expect(k).toEqual({ status: "active", by: PA.B.id, locked: true });
    const [ap] = await c.sql<Json[]>`select status from contracts.approvals where id = ${aid}`;
    expect(ap?.status).toBe("done");
  }, 90_000);
});
