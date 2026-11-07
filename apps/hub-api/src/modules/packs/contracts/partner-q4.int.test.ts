// CR-124 · q4 · FLOW4-FR-06/16 · NFR-01 · DB thật: (1) lần gửi ĐẦU tới công ty chưa nối bị GIỮ, B chấp nhận ⇒ thả, B chặn ⇒ trả lời Từ chối tự động;
// (2) ngưỡng mức + người phụ trách theo công ty nhận; (3) hộp thư/lời mời nối đọc qua API repo; (4) «Ghi nhận kết quả» chỉ cho lần gửi MỞ của chính công ty gửi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, inPack, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import type { PackToolCtx } from "../kit/public";
import { esignRepo } from "./adapters/esign.repo";
import { reviewerReason } from "./adapters/partner-inbox.repo";
import { partnerSendRepo } from "./adapters/partner-send.repo";
import { partnerSendTool } from "./adapters/partner-send.tool";
import { partnerUiRepo } from "./adapters/partner-ui.repo";
import { onPartnerReplies, receiveInbox } from "./partner-mailbox.mount";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let D = "";
let UA = "";
let UB = "";
let C: string[] = [];
const signals: string[] = [];
/** drizzle bọc lỗi Postgres: mã ở `cause.code`. */
const pgCode = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (
      (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? "no-code"
    );
  }
};

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
    ui: partnerUiRepo(tx, t),
  }));
const ctx = (): PackToolCtx => ({ tenantId: A, userId: UA, runId: null, processRunId: null });
const send = (id: string, extra: Record<string, unknown> = {}) =>
  partnerSendTool({ uow: uow() }).run(ctx(), {
    contract_id: id,
    send_fields: "total_value",
    ...extra,
  });
const replies = async () => {
  const rows = await o<
    {
      mailboxId: string;
      tenantId: string;
      ref: string | null;
      outcome: "confirmed" | "returned" | "declined";
      reason: string | null;
      source: string;
      round: number;
    }[]
  >`select id::text as "mailboxId", from_tenant::text as "tenantId", from_ref as ref, outcome, reason,
      replied_by_source as source, round from hub.partner_mailbox where status = 'replied' and reply_emitted_at is null`;
  await onPartnerReplies(
    db,
    () =>
      ({
        port: {
          signalEvent: async (_t: string, r: { record_id: string }, e: string) => {
            signals.push(`${r.record_id}:${e}`);
            return 1;
          },
        },
      }) as never,
  )(rows);
  await o`update hub.partner_mailbox set reply_emitted_at = now() where id = any(${rows.map((r) => r.mailboxId)}::uuid[])`;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B, D] = (await tenants(o, 3, 1350)) as [string, string, string];
  [UA] = (await users(o, A, 1, { from: 1350 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1351 })) as [string];
  await o`update admin.tenants set legal_name = 'Công ty A', tax_code = '0109999990' where id = ${A}`;
  await o`update admin.tenants set legal_name = 'Công ty B', tax_code = '0101111110', directory_listed = true where id = ${B}`;
  await o`update admin.tenants set legal_name = 'Công ty D', tax_code = '0102222220', directory_listed = true where id = ${D}`;
  C = await contracts(o, A, 3, { from: 1350, createdBy: UA, status: "active" });
  const taxes = ["0101111110", "0102222220", "0101111110"];
  for (const [i, id] of C.entries()) {
    const fid = crypto.randomUUID();
    await o`insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
      values (${fid}, ${A}, ${`t_${A}`}, ${`f${i}`}, ${`v${i}`}, 'hd.pdf', 'application/pdf', 16, ${UA})`;
    await o`update contracts.contracts set file_id = ${fid}, direction = 'sale', fields = ${o.json({
      buyer_tax_id: { value: taxes[i] },
      total_value: { value: 600_000_000 },
    } as never)} where id = ${id}`;
  }
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-124 q4 · giữ lần gửi đầu tới khi nối", () => {
  it("chưa nối ⇒ kênh nền tảng nhưng GIỮ; B thấy lời mời; chấp nhận ⇒ thả và B nhận", async () => {
    const r = await send(C[0] as string);
    expect(r).toMatchObject({ status: "held", channel: "platform" });
    const [m] =
      await o`select status from hub.partner_mailbox where id = ${r.mailbox_id as string}::uuid`;
    expect(m?.status).toBe("held");
    expect(await receiveInbox(db)(B, 100)).toBe(0); // chưa giao
    // bên gửi thấy lần gửi đang GIỮ (thẻ «Đang chờ công ty nhận đồng ý kết nối») — không bao giờ lộ «bị chặn»
    const held = await uow().tenant({ tenantId: A, userId: UA }, (x) => x.ui.sends(C[0] as string));
    expect(held[0]).toMatchObject({ status: "open", mb_status: "held" });
    expect(held[0]?.expires_at).toBeTruthy();
    const inv = await uow().tenant({ tenantId: B, userId: UB }, (x) => x.ui.invites());
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ from_name: "Công ty A", held: 1 });
    await uow().tenant({ tenantId: B, userId: UB }, (x) => x.ui.accept(A));
    const [m2] =
      await o`select status from hub.partner_mailbox where id = ${r.mailbox_id as string}::uuid`;
    expect(m2?.status).toBe("sent");
    expect(await receiveInbox(db)(B, 100)).toBe(1);
  });

  it("chặn ⇒ lần gửi đang giữ tự trả lời Từ chối kèm lý do; node chờ nhận partner.declined", async () => {
    const r = await send(C[1] as string); // tới D
    expect(r).toMatchObject({ status: "held" });
    await uow().tenant({ tenantId: D, userId: UB }, (x) => x.ui.block(A));
    await replies();
    expect(signals).toContain(`${C[1]}:partner.declined`);
    const [ps] =
      await o`select status, reason from contracts.partner_sends where mailbox_id = ${r.mailbox_id as string}::uuid`;
    expect(ps?.status).toBe("declined");
    expect(ps?.reason).toContain("email");
  });
});

describe("CR-124 q4 · mẫu Thư viện nhận (hub 0121)", () => {
  it("2 flow mẫu seed: «Nhận HĐ quan trọng» có điều kiện mức, «Nhận HĐ thường» không điều kiện", async () => {
    const rows = await o<
      { key: string; trigger: { event: string; when?: unknown }; app: string }[]
    >`
      select key, trigger, app from hub.process_defs where tenant_id is null and key in ('hd-nhan-quan-trong', 'hd-nhan-thuong') order by key`;
    expect(rows.map((r) => [r.key, r.trigger.event, r.app])).toEqual([
      ["hd-nhan-quan-trong", "contract.received", "contracts"],
      ["hd-nhan-thuong", "contract.received", "contracts"],
    ]);
    expect(rows[0]?.trigger.when).toBeTruthy();
    expect(rows[1]?.trigger.when).toBeUndefined();
    const rel =
      await o`select 1 from hub.process_def_releases r join hub.process_defs d on d.id = r.def_id
      where d.key in ('hd-nhan-quan-trong', 'hd-nhan-thuong') and r.rel_version = 1`;
    expect(rel).toHaveLength(2);
  });
});

describe("CR-124 q4 · lý do gửi đối tác chỉ lấy từ bước quyết", () => {
  /** Dựng lượt chạy giả (FK tắt bằng replica role — chỉ để kiểm câu đọc lý do): mỗi bước = [decision, feedback]. */
  async function fakeRun(steps: [string, string | null][]): Promise<string> {
    const run = crypto.randomUUID();
    await o.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
        conversation_id, flow_id, expires_at) values (${run}, ${B}, ${crypto.randomUUID()}, 1, '{}'::jsonb, ${UB}, 'admin', 'x',
        ${crypto.randomUUID()}, ${crypto.randomUUID()}, now() + interval '1 day')`;
      for (const [i, [decision, feedback]] of steps.entries()) {
        const sr = crypto.randomUUID();
        const out = crypto.randomUUID();
        await tx`insert into hub.stage_runs (id, tenant_id, process_run_id, stage_idx, status, feedback, current_output_id)
          values (${sr}, ${B}, ${run}, ${i}, 'done', ${feedback}, ${out})`;
        await tx`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx, version, attempt, content, fields, template_ok)
          values (${out}, ${B}, ${run}, ${sr}, ${i}, 1, 1, 'x', ${tx.json({ decision } as never)}, true)`;
      }
    });
    return run;
  }
  const read = (run: string, outcome: "declined" | "returned") =>
    withHubScope(db, { kind: "system" }, (tx) => reviewerReason(tx, B, run, outcome));

  it("Từ chối: lấy góp ý của bước Từ chối, KHÔNG lấy ghi chú nội bộ của người duyệt trước (đã Đạt)", async () => {
    const run = await fakeRun([
      ["approved", "ghi chú nội bộ của Kế toán"],
      ["rejected", "Điều khoản 3 chưa phù hợp"],
    ]);
    expect(await read(run, "declined")).toBe("Điều khoản 3 chưa phù hợp");
  });
  it("bước quyết không có góp ý ⇒ null (không lùi về ghi chú của bước trước)", async () => {
    const run = await fakeRun([
      ["approved", "ghi chú nội bộ của Kế toán"],
      ["returned", null],
    ]);
    expect(await read(run, "returned")).toBeNull();
    expect(await read(run, "declined")).toBeNull();
  });
});

describe("CR-124 q4 · cài đặt nhận theo công ty", () => {
  it("người phụ trách không thuộc công ty ⇒ không lưu (hàm DEFINER, một EXISTS)", async () => {
    const save = (owner: string | null) =>
      uow().tenant({ tenantId: B, userId: UB }, (x) =>
        x.ui.saveSettings(
          { important_min: 100_000_000, critical_min: 500_000_000, owner_user_id: owner },
          UB,
        ),
      );
    expect(await save(UA)).toBe(false); // UA thuộc công ty A
    expect(await save(crypto.randomUUID())).toBe(false);
    expect(await save(UB)).toBe(true);
    expect(await save(null)).toBe(true);
  });

  it("ngưỡng riêng + người phụ trách: 600 triệu với ngưỡng Rất quan trọng 500 triệu ⇒ critical, owner = người được đặt", async () => {
    await uow().tenant({ tenantId: B, userId: UB }, (x) =>
      x.ui.saveSettings(
        { important_min: 100_000_000, critical_min: 500_000_000, owner_user_id: UB },
        UB,
      ),
    );
    const r = await send(C[2] as string); // tới B, đã nối
    expect(r).toMatchObject({ status: "sent" });
    expect(await receiveInbox(db)(B, 100)).toBe(1);
    const [i] =
      await o`select i.importance, c.owner_user_id::text as owner from contracts.partner_inbox i
      join contracts.contracts c on c.id = i.contract_id where i.mailbox_id = ${r.mailbox_id as string}::uuid`;
    expect(i).toMatchObject({ importance: "critical", owner: UB });
    const items = await uow().tenant({ tenantId: B, userId: UB }, (x) => x.ui.inbox());
    expect(items.length).toBe(2);
  });
});

describe("CR-124 q4 · ghi nhận kết quả thủ công + cách ly", () => {
  it("chỉ công ty gửi ghi nhận được lần gửi MỞ của mình; B không thấy/không ghi nhận hộ A", async () => {
    const [open] = await o<
      { id: string }[]
    >`select mailbox_id::text as id from contracts.partner_sends
      where tenant_id = ${A} and contract_id = ${C[2] as string} and status = 'open'`;
    const id = open?.id as string;
    expect(await uow().tenant({ tenantId: B, userId: UB }, (x) => x.ui.openSend(id))).toBeNull();
    expect(
      await pgCode(() =>
        uow().tenant({ tenantId: B, userId: UB }, (x) =>
          x.ui.recordManual(id, "confirmed", null, {}),
        ),
      ),
    ).toBe("42501");
    expect(
      await uow().tenant({ tenantId: A, userId: UA }, (x) => x.ui.openSend(id)),
    ).not.toBeNull();
    await uow().tenant({ tenantId: A, userId: UA }, (x) =>
      x.ui.recordManual(id, "returned", "sai đơn giá mục 3", {
        by_name: "Nguyễn Văn B",
        files: [{ name: "email.png" }],
      }),
    );
    const [m] =
      await o`select status, outcome, replied_by_source as src from hub.partner_mailbox where id = ${id}::uuid`;
    expect(m).toMatchObject({ status: "replied", outcome: "returned", src: "manual" });
    await replies();
    expect(signals).toContain(`${C[2]}:partner.returned`);
    const rounds = await uow().tenant({ tenantId: A, userId: UA }, (x) =>
      x.ui.sends(C[2] as string),
    );
    expect(rounds[0]).toMatchObject({ round: 1, status: "returned" });
  });
  it("partner_settings: tenant khác không đọc được cài đặt", async () => {
    expect(
      await inPack("contracts", D, (tx) => tx`select 1 from contracts.partner_settings`),
    ).toHaveLength(0);
    expect(
      (await inPack("contracts", B, (tx) => tx`select 1 from contracts.partner_settings`)).length,
    ).toBe(1);
  });
});
