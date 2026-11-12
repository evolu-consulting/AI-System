// CR-127 K1a · BR-01/02/06/07/77 · spec §2.1, §3: migration MIGC 0091 trên DB thật.
// (1) backfill 9 → 4 trạng thái (chạy LẠI đúng đoạn backfill của file migration trên dữ liệu cũ dựng trong tx, rồi rollback);
// (2) trigger `contracts_status_gate` chặn UPDATE status ngoài cổng; (3) `refresh_effect` = `effectOf` (bảng ca chung);
// (4) `applyTransition` qua role gói `contracts_rw` + RLS: một câu, 0 hàng ⇒ STATE_CONFLICT, vào done ⇒ hiệu lực + hook.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { EFFECT_CASES, effectOf } from "../domain/effect.rules";
import { contractStateRepo } from "./contract-state.repo";

const MIG = join(
  import.meta.dir,
  "../../../../../../../packages/db/migrations-pack-contracts/0091_contract_state.sql",
);
/** Đoạn backfill của migration (giữa hai mốc), tách theo `--> statement-breakpoint` như Drizzle. */
const backfillStatements = (): string[] => {
  const src = readFileSync(MIG, "utf8");
  const a = src.indexOf("-- >>> K1A BACKFILL");
  const b = src.indexOf("-- <<< K1A BACKFILL");
  if (a < 0 || b < 0) throw new Error("thiếu mốc backfill trong 0091");
  return src
    .slice(a, b)
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, "").trim().length > 0);
};

let o: Sql;
let db: Db;
let T = "";
let U = "";
const ROLLBACK = new Error("rollback");
const TODAY = "2026-11-10";

const uow = () => createPackUow(db, "contracts", (tx, tid) => ({ st: contractStateRepo(tx, tid) }));
const who = () => ({ tenantId: T, userId: U });

async function newContract(
  sql: Sql,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const [r] = await sql<{ id: string }[]>`insert into contracts.contracts ${sql({
    tenant_id: T,
    title: "HĐ thử K1a",
    created_by: U,
    status,
    ...extra,
  } as never)} returning id`;
  return (r as { id: string }).id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9127)) as [string];
  [U] = (await users(o, T, 1, { from: 9127 })) as [string];
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 K1a backfill 0091 (BR-77)", () => {
  it("mọi trạng thái cũ ⇒ 4 trạng thái + extract_state + effect_outcome (+handled) + submit_round/submitted_by", async () => {
    const seen: Record<string, Record<string, unknown>> = {};
    await o
      .begin(async (tx) => {
        await tx.unsafe("alter table contracts.contracts drop constraint contracts_status_ck");
        // CR-127 K6 (MIGC 0096) đã gỡ cột `handled`; backfill 0091 vẫn đọc nó ⇒ dựng lại cột TRONG tx thử (rollback cuối ca) để chạy đúng đoạn cũ trên dữ liệu cũ.
        await tx.unsafe("alter table contracts.contracts add column handled jsonb");
        const mk = (s: string, extra: Record<string, unknown> = {}) =>
          newContract(tx as unknown as Sql, s, extra);
        const ids = {
          extracting: await mk("extracting"),
          extract_failed: await mk("extract_failed"),
          nr_open: await mk("needs_review"),
          nr_stale: await mk("needs_review"),
          nr_none: await mk("needs_review"),
          active: await mk("active"),
          active_replaced: await mk("active", { handled: tx.json({ outcome: "replaced" }) }),
          expiring_renewed: await mk("expiring", { handled: tx.json({ outcome: "renewed" }) }),
          expired_neg: await mk("expired", { handled: tx.json({ outcome: "negotiating" }) }),
          renewed: await mk("renewed"),
          terminated: await mk("terminated"),
          rejected: await mk("rejected"),
        };
        // needs_review + lượt đang mở trỏ đúng run_id ⇒ processing; lượt mở nhưng HĐ không trỏ (run_id khác) ⇒ draft.
        const appr = async (cid: string, status: string, at: string) => {
          const [r] = await tx<{ id: string }[]>`insert into contracts.approvals
            (tenant_id, contract_id, status, started_by, created_at)
            values (${T}, ${cid}, ${status}, ${U}, ${at}::timestamptz) returning id`;
          return (r as { id: string }).id;
        };
        await appr(ids.nr_open, "rejected", "2026-01-01");
        const open = await appr(ids.nr_open, "level1", "2026-02-01");
        await tx`update contracts.contracts set run_id = ${open} where id = ${ids.nr_open}`;
        await appr(ids.nr_stale, "level2", "2026-02-01");
        for (const s of backfillStatements()) await tx.unsafe(s);
        const rows = await tx<
          {
            id: string;
            status: string;
            extract_state: string;
            effect_outcome: string | null;
            effect: string | null;
            submit_round: number;
            submitted_by: string | null;
          }[]
        >`select id, status, extract_state, effect_outcome, effect, submit_round, submitted_by
          from contracts.contracts where tenant_id = ${T}`;
        for (const [k, id] of Object.entries(ids)) seen[k] = rows.find((r) => r.id === id) ?? {};
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    const pick = (k: string) => {
      const r = seen[k] as Record<string, unknown>;
      return [r.status, r.extract_state, r.effect_outcome];
    };
    expect(pick("extracting")).toEqual(["draft", "reading", null]);
    expect(pick("extract_failed")).toEqual(["draft", "failed", null]);
    expect(pick("nr_open")).toEqual(["processing", "ready", null]);
    expect(pick("nr_stale")).toEqual(["draft", "ready", null]);
    expect(pick("nr_none")).toEqual(["draft", "ready", null]);
    expect(pick("active")).toEqual(["done", "ready", null]);
    expect(pick("active_replaced")).toEqual(["done", "ready", "terminated"]);
    expect(pick("expiring_renewed")).toEqual(["done", "ready", "renewed"]);
    expect(pick("expired_neg")).toEqual(["done", "ready", null]);
    expect(pick("renewed")).toEqual(["done", "ready", "renewed"]);
    expect(pick("terminated")).toEqual(["done", "ready", "terminated"]);
    expect(pick("rejected")).toEqual(["reject", "ready", null]);
    expect(seen.nr_open?.submit_round).toBe(2);
    expect(seen.nr_open?.submitted_by).toBe(U);
    expect(seen.nr_none?.submit_round).toBe(0);
    // hiệu lực chỉ khi done (đã gọi refresh_effect sau UPDATE)
    expect(seen.active?.effect).toBe("active");
    expect(seen.renewed?.effect).toBe("renewed");
    expect(seen.extracting?.effect).toBeNull();
    expect(seen.rejected?.effect).toBeNull();
  }, 60_000);
});

describe("CR-127 K1a trigger contracts_status_gate (R#24)", () => {
  it("UPDATE status ngoài cổng ⇒ STATUS_GATE_ONLY; đúng id / bulk:txid ⇒ qua; sửa cột khác ⇒ không chặn", async () => {
    const id = await newContract(o, "draft");
    const err = await o`update contracts.contracts set status = 'done' where id = ${id}`.catch(
      (e: Error) => e,
    );
    expect(String((err as Error).message)).toContain("STATUS_GATE_ONLY");
    const wrong = await o
      .begin(async (tx) => {
        await tx`select set_config('contracts.state_gate', ${crypto.randomUUID()}, true)`;
        await tx`update contracts.contracts set status = 'processing' where id = ${id}`;
      })
      .catch((e: Error) => e);
    expect(String((wrong as Error).message)).toContain("STATUS_GATE_ONLY");
    await o.begin(async (tx) => {
      await tx`select set_config('contracts.state_gate', ${id}, true)`;
      await tx`update contracts.contracts set status = 'processing' where id = ${id}`;
    });
    await o.begin(async (tx) => {
      await tx`select set_config('contracts.state_gate', 'bulk:' || txid_current(), true)`;
      await tx`update contracts.contracts set status = 'draft' where id = ${id}`;
    });
    await o`update contracts.contracts set title = 'đổi tên', status = status where id = ${id}`;
    const [r] = await o<
      { status: string }[]
    >`select status from contracts.contracts where id = ${id}`;
    expect(r?.status).toBe("draft");
  });
});

const fieldsOf = (i: (typeof EFFECT_CASES)[number]["input"]) => {
  const f: Record<string, unknown> = {};
  if (i.startDate) f.start_date = { value: i.startDate };
  if (i.endDate) f.end_date = { value: i.endDate };
  if (i.noticeDays !== undefined) f.notice_days = { value: i.noticeDays };
  return f;
};

describe("CR-127 K1a refresh_effect = effectOf (spec §2.1)", () => {
  it("bảng ca chung: SQL cho cùng kết quả với hàm thuần", async () => {
    const made: { id: string; today: string; want: string | null }[] = [];
    for (const c of EFFECT_CASES) {
      const i = c.input;
      const id = await newContract(o, "draft", { fields: o.json(fieldsOf(i) as never) });
      await o.begin(async (tx) => {
        await tx`select set_config('contracts.state_gate', ${id}, true)`;
        await tx`update contracts.contracts set status = ${i.status}, effect_outcome = ${i.outcome},
          superseded_at = ${i.superseded ? new Date() : null},
          superseded_by = ${i.superseded ? id : null} where id = ${id}`;
      });
      made.push({ id, today: c.today, want: effectOf(c.input, c.today) });
    }
    for (const m of made)
      await o`select contracts.refresh_effect(array[${m.id}]::uuid[], ${m.today}::date)`;
    const got = await o<
      { id: string; effect: string | null }[]
    >`select id, effect from contracts.contracts
      where id = any(${made.map((m) => m.id)}::uuid[])`;
    for (const m of made)
      expect([m.id, got.find((g) => g.id === m.id)?.effect ?? null]).toEqual([m.id, m.want]);
  });
});

describe("CR-127 K1a applyTransition (spec §3)", () => {
  it("draft → submit không quy trình ⇒ done + khoá + hiệu lực + event status_changed + hook; lặp ⇒ STATE_CONFLICT", async () => {
    const id = await newContract(o, "draft", {
      fields: o.json({ end_date: { value: "2099-01-01" } } as never),
    });
    const hooked: string[] = [];
    const hook = { onDone: async (_tx: unknown, _t: string, cid: string) => void hooked.push(cid) };
    const r1 = await uow().tenant(who(), (r) =>
      r.st.applyTransition(
        {
          contractId: id,
          ev: "submit",
          ctx: { hasFlow: false },
          actorId: U,
          reason: "thử",
          today: TODAY,
        },
        hook,
      ),
    );
    expect(r1).toEqual({ ok: true, from: "draft", to: "done" });
    expect(hooked).toEqual([id]);
    const [c] = await o<
      {
        status: string;
        effect: string;
        locked_at: Date | null;
        submit_round: number;
        submitted_by: string;
      }[]
    >`select status, effect, locked_at, submit_round, submitted_by from contracts.contracts where id = ${id}`;
    expect(c).toMatchObject({ status: "done", effect: "active", submit_round: 1, submitted_by: U });
    expect(c?.locked_at).not.toBeNull();
    const [ev] = await o<
      { data: Record<string, unknown> }[]
    >`select data from contracts.contract_events
      where contract_id = ${id} and type = 'status_changed'`;
    expect(ev?.data).toMatchObject({ from: "draft", to: "done", ev: "submit", reason: "thử" });
    const r2 = await uow().tenant(who(), (r) =>
      r.st.applyTransition({
        contractId: id,
        ev: "submit",
        ctx: { hasFlow: true },
        actorId: U,
        today: TODAY,
      }),
    );
    expect(r2).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  it("CAS theo run_id: lượt khác ⇒ bỏ qua (0 hàng, không ném)", async () => {
    const run = crypto.randomUUID();
    const id = await newContract(o, "draft");
    await o.begin(async (tx) => {
      await tx`select set_config('contracts.state_gate', ${id}, true)`;
      await tx`update contracts.contracts set status = 'processing', run_id = ${run} where id = ${id}`;
    });
    const other = await uow().tenant(who(), (r) =>
      r.st.applyTransition({
        contractId: id,
        ev: "flow_cancelled",
        runId: crypto.randomUUID(),
        actorId: null,
      }),
    );
    expect(other).toEqual({ ok: false, code: "STATE_CONFLICT" });
    const same = await uow().tenant(who(), (r) =>
      r.st.applyTransition({ contractId: id, ev: "flow_cancelled", runId: run, actorId: null }),
    );
    expect(same).toEqual({ ok: true, from: "processing", to: "draft" });
  });
});
