// CR-101 DOC-legal · Câu 8 qua hub-api THẬT — đường chính: giao dịch đứng riêng 6 triệu còn mốc thu/trả mở ⇒ có ở Cần xử lý (`legal`)
// + chi tiết (`legal_warning`); 3 triệu / thuộc HĐ NT / đã xong mốc tiền ⇒ không; Bỏ qua ẩn việc; ngưỡng ở Cài đặt (owner sửa, non-owner
// 403); chéo tenant cho cột ngưỡng. Hạ tầng V2-D (HD1).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2d,
  type CtxN1,
  call,
  d,
  type Json,
  ok,
  P,
  settleRaw,
  startHd1,
  T,
} from "../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
  await c.sql`delete from contracts.approval_settings`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const body = (value: number, title: string) => ({
  deal: "buy",
  source: "invoice",
  title,
  partner_name: "Công ty A",
  start_date: d(0),
  total_value: value,
  items: [{ name: "Vật tư", qty: 1, unit_price: value }],
});
const make = async (value: number, title: string) =>
  (await ok(call(c, P.hoa, "POST", "/contracts/deals", body(value, title)))).id as string;
const legalIds = async (): Promise<string[]> =>
  (await ok(call(c, P.hoa, "GET", "/my-work/todo"))).items
    .filter((i: Json) => i.kind === "legal")
    .map((i: Json) => i.contract_id);
const warning = async (id: string) =>
  (await ok(call(c, P.hoa, "GET", `/contracts/${id}`))).legal_warning;

describe("CR-101 DOC-legal · đường chính", () => {
  it("6 triệu đứng riêng + mốc tiền mở ⇒ todo + chi tiết; 3 triệu ⇒ không; xong mốc tiền ⇒ hết", async () => {
    const big = await make(6_000_000, "Mua lớn");
    const small = await make(3_000_000, "Mua nhỏ");
    const ids = await legalIds();
    expect(ids).toContain(big);
    expect(ids).not.toContain(small);
    expect(await warning(big)).toMatchObject({ threshold: 5_000_000 });
    expect(await warning(small)).toBeNull();

    const pay = await c.sql<{ id: string }[]>`select id::text from contracts.obligations
      where contract_id = ${big} and kind = 'payment'`;
    await ok(settleRaw(c, (pay[0] as { id: string }).id));
    expect(await legalIds()).not.toContain(big);
    expect(await warning(big)).toBeNull();
  });

  it("thuộc HĐ NT ⇒ không cảnh báo; Bỏ qua ẩn việc", async () => {
    const f = await make(1_000, "HĐ NT giả lập");
    await c.sql`delete from contracts.obligations where contract_id = ${f}`;
    // Dựng HĐ NT giả lập (chỉ test): tạm tắt trigger nâng, vì đường thật (upload + xác nhận) đã có ở DOC-model.
    await c.sql`alter table contracts.contracts disable trigger contracts_doc_deal_promote`;
    await c.sql`update contracts.contracts set doc_type = 'framework' where id = ${f}`;
    await c.sql`alter table contracts.contracts enable trigger contracts_doc_deal_promote`;
    const child = await make(9_000_000, "Con của HĐ NT");
    await c.sql`update contracts.contracts set frame_root_id = ${f} where id = ${child}`;
    expect(await legalIds()).not.toContain(child);
    expect(await warning(child)).toBeNull();

    const alone = await make(8_000_000, "Đứng riêng");
    const item = (await ok(call(c, P.hoa, "GET", "/my-work/todo"))).items.find(
      (i: Json) => i.kind === "legal" && i.contract_id === alone,
    );
    expect(item).toBeTruthy();
    await ok(call(c, P.hoa, "POST", "/my-work/todo/dismiss", { key: item.key, action: "skip" }));
    expect(await legalIds()).not.toContain(alone);
    expect(await warning(alone)).not.toBeNull(); // chi tiết vẫn cảnh báo
  });

  it("ngưỡng ở Cài đặt: owner sửa ⇒ đổi cảnh báo; non-owner 403; chéo tenant không thấy", async () => {
    const cfg = (await ok(call(c, P.lan, "GET", "/company"))) as Json;
    expect(cfg.legal_warn_threshold).toBe(5_000_000);
    const put = (p: typeof P.lan, v: number) =>
      call(c, p, "PUT", "/company", {
        ...cfg.company,
        approval_enabled: cfg.approval_enabled,
        legal_warn_threshold: v,
      });
    expect((await put(P.hoa, 1_000_000)).status).toBe(403);
    const mid = await make(2_000_000, "Mua vừa");
    expect(await warning(mid)).toBeNull();
    expect((await ok(put(P.lan, 1_000_000))).legal_warn_threshold).toBe(1_000_000);
    expect(await warning(mid)).toMatchObject({ threshold: 1_000_000 });
    expect(await legalIds()).toContain(mid);
    await ok(put(P.lan, 0));
    expect(await warning(mid)).toBeNull(); // 0 = tắt

    await c.sql`update contracts.approval_settings set legal_warn_threshold = 123456 where tenant_id = ${T.acme}`;
    const seen = await c.sql.begin(async (tx) => {
      await tx`set local role contracts_rw`;
      await tx`select set_config('app.tenant_id', ${T.beta}, true), set_config('app.user_id', ${P.an.id}, true)`;
      return tx<{ n: number }[]>`select count(*)::int as n from contracts.approval_settings
        where legal_warn_threshold = 123456`;
    });
    expect(seen[0]?.n).toBe(0);
  });
});
