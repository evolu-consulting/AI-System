// CR-101 DOC-deals · chuyển Giao dịch G1 (`contracts.transactions*`) → chứng từ `contracts.contracts` (`doc_type = 'deal'`), GIỮ id.
// Mặc định CHẠY THỬ: một giao dịch READ ONLY, in số + danh sách id, không ghi. `--apply`: MỘT transaction cho mọi tenant đã chọn,
// theo tập (số câu SQL cố định, không vòng theo hàng — Luật 4c), lặp lại vô hại (chạy lần 2 = 0 hàng đổi), cuối tx đo lại: kế hoạch
// phải rỗng và số ghi = số kế hoạch, lệch ⇒ huỷ cả tx.
//   bun tools/scripts/src/migrate-transactions-to-contracts.ts --tenant demo            (chạy thử)
//   bun tools/scripts/src/migrate-transactions-to-contracts.ts --tenant demo --apply    (ghi)
//   bun tools/scripts/src/migrate-transactions-to-contracts.ts --all [--apply]
// Ánh xạ (tasks.md DOC-deals #3): nháp → giao dịch `active` + mốc giao/tiền MỞ (chưa xác nhận); đã ghi sổ → `active` + nghĩa vụ G1 trỏ
// lại `contract_id` (mốc tiền) + mốc giao ĐÃ XÁC NHẬN gắn dòng kho G1 (kho không chạy lại, không đảo); đã huỷ → `rejected` (loại khỏi
// số liệu như HĐ bị từ chối), nghĩa vụ huỷ + dòng kho đảo giữ nguyên. Nguồn = "Khác". Ghi chú/người giữ/lô/HĐ liên kết/lý do huỷ ⇒
// sự kiện `migrated_from_transaction`. Giao dịch trùng id chứng từ khác hoặc không rõ người tạo ⇒ KHÔNG chuyển, báo.
// Câu 7 (HĐ nhập tay cũ không file → giao dịch): CHỈ BÁO tập "chắc chắn" / "mơ hồ" theo nguồn thật (file cả chuỗi, văn bản đọc,
// ký số, sự kiện tải lên, sự kiện nhập tay) — không ghi; chuyển chờ người dùng xem số (hard stop dữ liệu khách).
// Cần DATABASE_URL của chủ migration (siêu người dùng; bỏ qua RLS), DB đã chạy 0056.
import postgres from "postgres";
import {
  type Applied,
  assertConverged,
  assertMatches,
  type Flags,
  type ManualReport,
  type Plan,
  parseFlags,
  report,
} from "./migrate-transactions.rules";

type Tx = postgres.TransactionSql;
type Full = Plan & { eligible: string[]; posted: string[] };

/** Id mốc tất định theo giao dịch ⇒ chạy lại không sinh trùng. */
const MS_DELIVERY = "'g1-delivery:'";
const MS_MONEY = "'g1-money:'";

async function plan(tx: Tx, ts: readonly string[]): Promise<Full> {
  const [r] = await tx<{ j: Full }[]>`with x as (
      select t.* from contracts.transactions t where t.tenant_id = any(${ts as string[]}::uuid[])),
    clash as (select x.id from x join contracts.contracts c on c.id = x.id
      where c.doc_type <> 'deal' or c.tenant_id <> x.tenant_id),
    nob as (select x.id from x where coalesce(x.created_by, x.posted_by, x.cancelled_by) is null
      and not exists (select 1 from contracts.contracts c where c.id = x.id)),
    ok as (select x.* from x where x.id not in (select id from clash) and x.id not in (select id from nob)),
    todo as (select ok.* from ok where not exists (select 1 from contracts.contracts c where c.id = ok.id))
    select jsonb_build_object(
      'transactions', (select count(*) from todo),
      'byStatus', jsonb_build_object(
        'draft', (select count(*) from todo where status = 'draft'),
        'posted', (select count(*) from todo where status = 'posted'),
        'cancelled', (select count(*) from todo where status = 'cancelled')),
      'ids', coalesce((select jsonb_agg(id order by id) from todo), '[]'),
      'posted', coalesce((select jsonb_agg(id order by id) from todo where status = 'posted'), '[]'),
      'eligible', coalesce((select jsonb_agg(id order by id) from ok), '[]'),
      'lines', (select count(*) from contracts.transaction_lines l join todo
        on l.tenant_id = todo.tenant_id and l.transaction_id = todo.id and l.rev = todo.rev),
      'obligations', (select count(*) from contracts.obligations o join ok
        on o.tenant_id = ok.tenant_id and o.transaction_id = ok.id where o.contract_id is null),
      'stockMoves', (select count(*) from contracts.stock_moves m join ok
        on m.tenant_id = ok.tenant_id and m.transaction_id = ok.id where m.contract_id is null),
      'milestones', (select count(*) filter (where status = 'posted') + 2 * count(*) filter (where status = 'draft') from todo),
      'conflicts', coalesce((select jsonb_agg(id order by id) from clash), '[]'),
      'noCreator', coalesce((select jsonb_agg(id order by id) from nob), '[]')) as j`;
  return (r as { j: Full }).j;
}

/** Câu 7 — HĐ hiện hành loại HĐ kinh tế mà CẢ CHUỖI phiên bản không có `file_id`; phân loại theo dấu vết văn bản. Chỉ đọc. */
async function manualReport(tx: Tx, ts: readonly string[]): Promise<ManualReport> {
  const [r] = await tx<{ j: ManualReport }[]>`with c as (
      select c.id, c.tenant_id, c.root_id from contracts.contracts c
      where c.tenant_id = any(${ts as string[]}::uuid[]) and c.kind = 'contract' and c.doc_type = 'contract'
        and c.superseded_at is null
        and not exists (select 1 from contracts.contracts v
          where v.tenant_id = c.tenant_id and v.root_id = c.root_id and v.file_id is not null)),
    ch as (select c.id, v.id as vid, v.tenant_id, v.source_text from c
      join contracts.contracts v on v.tenant_id = c.tenant_id and v.root_id = c.root_id),
    ev as (select c.id,
      exists (select 1 from ch where ch.id = c.id and ch.source_text is not null) as text,
      exists (select 1 from ch join contracts.esign_envelopes e on e.tenant_id = ch.tenant_id and e.contract_id = ch.vid
        where ch.id = c.id and e.signed_file_id is not null) as esign,
      exists (select 1 from ch join contracts.contract_events e on e.tenant_id = ch.tenant_id and e.contract_id = ch.vid
        where ch.id = c.id and e.type = 'uploaded') as uploaded,
      exists (select 1 from ch join contracts.contract_events e on e.tenant_id = ch.tenant_id and e.contract_id = ch.vid
        where ch.id = c.id and e.type = 'created_manual') as manual
      from c)
    select jsonb_build_object(
      'sure', coalesce(jsonb_agg(id order by id) filter (where not text and not esign and not uploaded and manual), '[]'),
      'ambiguous', coalesce(jsonb_agg(jsonb_build_object('id', id, 'why', to_jsonb(array_remove(array[
          case when text then 'source_text' end, case when esign then 'esign_file' end,
          case when uploaded then 'upload_event' end, case when not manual then 'no_manual_event' end], null))) order by id)
        filter (where text or esign or uploaded or not manual), '[]')) as j
    from ev`;
  return (r as { j: ManualReport }).j;
}

async function write(tx: Tx, p: Full): Promise<Applied> {
  const ids = p.ids;
  const fv = (e: string) =>
    `jsonb_build_object('value', ${e}, 'quote', '', 'verified', true, 'edited', true)`;
  const contracts =
    await tx`insert into contracts.contracts (id, tenant_id, kind, doc_type, source, title, direction, deal,
      status, owner_user_id, created_by, created_at, updated_at, confirmed_at, confirmed_by, fields, product_group)
    select x.id, x.tenant_id, 'contract', 'deal', 'other', left('Giao dịch ' || x.partner_name, 200),
      case x.deal when 'buy' then 'purchase' else 'sale' end, x.deal,
      case x.status when 'cancelled' then 'rejected' else 'active' end,
      coalesce(x.created_by, x.posted_by, x.cancelled_by), coalesce(x.created_by, x.posted_by, x.cancelled_by),
      x.created_at, x.updated_at, coalesce(x.posted_at, x.created_at), coalesce(x.posted_by, x.created_by, x.cancelled_by),
      jsonb_build_object(case x.deal when 'buy' then 'supplier_name' else 'buyer_name' end, ${tx.unsafe(fv("x.partner_name"))},
          'start_date', ${tx.unsafe(fv("x.occurred_on::text"))}, 'total_value', ${tx.unsafe(fv("x.total"))})
        || case when x.partner_tax_id is null then '{}'::jsonb else jsonb_build_object(
          case x.deal when 'buy' then 'supplier_tax_id' else 'buyer_tax_id' end, ${tx.unsafe(fv("x.partner_tax_id"))}) end
        || case when x.valid_until is null then '{}'::jsonb else jsonb_build_object(
          'end_date', ${tx.unsafe(fv("x.valid_until::text"))}) end,
      x.product_group
    from contracts.transactions x where x.id = any(${ids}::uuid[])
    on conflict (id) do nothing`;
  // Dòng hàng = bản hiện hành (`rev`), GIỮ id dòng (dòng kho G1 trỏ `contract_item_id` = id dòng).
  const items =
    await tx`insert into contracts.contract_items (id, tenant_id, contract_id, ord, name, unit, qty, unit_price,
      verified, edited, product_id, component_ids)
    select l.id, l.tenant_id, l.transaction_id, l.ord, l.name, l.unit, l.qty, l.unit_price, true, true, l.product_id,
      l.component_ids
    from contracts.transaction_lines l join contracts.transactions x
      on x.tenant_id = l.tenant_id and x.id = l.transaction_id and x.rev = l.rev
    where l.transaction_id = any(${ids}::uuid[])
    on conflict (id) do nothing`;
  const obligations = await tx`update contracts.obligations o set contract_id = o.transaction_id
    where o.transaction_id = any(${p.eligible}::uuid[]) and o.contract_id is null`;
  const stock = await tx`update contracts.stock_moves m set contract_id = m.transaction_id
    where m.transaction_id = any(${p.eligible}::uuid[]) and m.contract_id is null`;
  // Mốc: đã ghi sổ ⇒ giao ĐÃ XÁC NHẬN (ngày phát sinh); nháp ⇒ giao + tiền MỞ (tiền trống = 5.4a chia từ giá trị).
  const milestones =
    await tx`insert into contracts.obligations (id, tenant_id, contract_id, party_key, direction, kind, seq,
      due_date, title, source, status, done_at, done_by)
    select md5(${tx.unsafe(MS_DELIVERY)} || x.id::text)::uuid, x.tenant_id, x.id, x.party_key,
      case x.deal when 'buy' then 'pay' else 'receive' end, 'delivery',
      coalesce((select max(o.seq) from contracts.obligations o where o.tenant_id = x.tenant_id and o.transaction_id = x.id), 0) + 1,
      x.occurred_on, 'Giao hàng', 'default',
      case x.status when 'posted' then 'done' else 'open' end,
      case x.status when 'posted' then x.occurred_on end, case x.status when 'posted' then x.posted_by end
    from contracts.transactions x where x.id = any(${ids}::uuid[]) and x.status in ('posted', 'draft')
    union all
    select md5(${tx.unsafe(MS_MONEY)} || x.id::text)::uuid, x.tenant_id, x.id, x.party_key,
      case x.deal when 'buy' then 'pay' else 'receive' end, 'payment', 2, coalesce(x.due_on, x.occurred_on),
      case x.deal when 'buy' then 'Thanh toán' else 'Thu tiền' end, 'default', 'open', null, null
    from contracts.transactions x where x.id = any(${ids}::uuid[]) and x.status = 'draft'
    on conflict (id) do nothing`;
  const links = await tx`update contracts.stock_moves m
    set milestone_id = md5(${tx.unsafe(MS_DELIVERY)} || m.transaction_id::text)::uuid
    where m.transaction_id = any(${p.posted}::uuid[]) and m.reason = 'delivery' and m.milestone_id is null`;
  const mi =
    await tx`insert into contracts.milestone_items (tenant_id, contract_id, milestone_id, contract_item_id, qty,
      delivered)
    select l.tenant_id, l.transaction_id, md5(${tx.unsafe(MS_DELIVERY)} || l.transaction_id::text)::uuid, l.id, l.qty, l.qty
    from contracts.transaction_lines l join contracts.transactions x
      on x.tenant_id = l.tenant_id and x.id = l.transaction_id and x.rev = l.rev
    where l.transaction_id = any(${p.posted}::uuid[])
    on conflict do nothing`;
  const events =
    await tx`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, at, data)
    select x.tenant_id, x.id, 'migrated_from_transaction', null, now(), jsonb_strip_nulls(jsonb_build_object(
      'from', 'transactions', 'status', x.status, 'rev', x.rev, 'note', x.note, 'holder', x.holder, 'lot_label', x.lot_label,
      'contract_id', x.contract_id, 'cancel_reason', x.cancel_reason, 'cancelled_at', x.cancelled_at, 'posted_at', x.posted_at,
      'due_on', x.due_on))
    from contracts.transactions x where x.id = any(${ids}::uuid[])
      and not exists (select 1 from contracts.contract_events e
        where e.tenant_id = x.tenant_id and e.contract_id = x.id and e.type = 'migrated_from_transaction')`;
  return {
    contracts: contracts.count,
    items: items.count,
    obligations: obligations.count,
    stockMoves: stock.count,
    milestones: milestones.count,
    milestoneLinks: links.count,
    milestoneItems: mi.count,
    events: events.count,
  };
}

export type Outcome = {
  plan: Plan;
  manual: ManualReport;
  applied: Applied | null;
  lines: string[];
};

const strip = ({ eligible: _e, posted: _p, ...rest }: Full): Plan => rest;

/** Chạy thử (READ ONLY) hoặc ghi (một tx). `scope` chỉ để in. */
export async function migrateTransactions(
  sql: postgres.Sql,
  tenantIds: readonly string[],
  o: { apply: boolean; scope?: string },
): Promise<Outcome> {
  const scope = o.scope ?? tenantIds.join(",");
  if (!o.apply) {
    return sql.begin("read only", async (tx) => {
      const p = await plan(tx, tenantIds);
      const m = await manualReport(tx, tenantIds);
      return { plan: strip(p), manual: m, applied: null, lines: report(scope, strip(p), m, null) };
    }) as Promise<Outcome>;
  }
  return sql.begin(async (tx) => {
    const p = await plan(tx, tenantIds);
    const m = await manualReport(tx, tenantIds);
    const applied = await write(tx, p);
    assertMatches(p, applied);
    assertConverged(await plan(tx, tenantIds));
    return { plan: strip(p), manual: m, applied, lines: report(scope, strip(p), m, applied) };
  }) as Promise<Outcome>;
}

async function resolve(sql: postgres.Sql, f: Flags): Promise<string[]> {
  if (f.all) {
    const rows = await sql<
      { id: string }[]
    >`select distinct tenant_id::text as id from contracts.transactions
      union select distinct tenant_id::text from contracts.contracts where kind = 'contract' and file_id is null`;
    return rows.map((r) => r.id);
  }
  const rows = await sql<{ id: string; key: string }[]>`select id::text, key from admin.tenants
    where key = any(${f.tenants}::text[])`;
  const miss = f.tenants.filter((k) => !rows.some((r) => r.key === k));
  if (miss.length) throw new Error(`migrate-transactions: không có tenant ${miss.join(", ")}`);
  return rows.map((r) => r.id);
}

async function main(argv: readonly string[]): Promise<void> {
  const flags = parseFlags(argv);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("migrate-transactions: cần DATABASE_URL (chủ migration)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [r] = await sql<
      { su: boolean }[]
    >`select rolsuper as su from pg_roles where rolname = current_user`;
    if (!r?.su) throw new Error("migrate-transactions: cần vai siêu người dùng (chủ migration)");
    const ids = await resolve(sql, flags);
    const out = await migrateTransactions(sql, ids, {
      apply: flags.apply,
      scope: flags.all ? "mọi tenant" : flags.tenants.join(","),
    });
    for (const l of out.lines) console.log(l);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
