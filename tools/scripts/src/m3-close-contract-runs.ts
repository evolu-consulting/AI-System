// M3-decouple · M3-10 · script MỘT LẦN (admin): đóng các run engine `contracts-approval` còn mở sau khi gói hợp đồng tách khỏi
// engine (migration gói 0011 đã chuyển mỗi run thành một hàng `contracts.approvals` cùng id). Cách đóng: đặt `expires_at = now()`
// ⇒ vòng hết hạn CÓ SẴN của engine (`processes/runs/expire.ts`) đóng run đúng luật (stage cancelled, task duyệt closed, timer
// huỷ, sự kiện kết thúc) — script không tự ghi các bảng đó. Đồng thời tắt def `contracts-approval` để không ai mở run mới.
// Mặc định chạy thử (chỉ đếm); `--apply` mới ghi — còn run chưa ánh xạ thì DỪNG + in id (trừ `--force`, review B #3). Sau
// `--apply` phải cho engine quét một lượt (`HUB_PROCESS_ENGINE=on`) rồi `--verify` (review B #2). Cần `DATABASE_URL` (chủ migration).
//   bun tools/scripts/src/m3-close-contract-runs.ts [--apply [--force] | --verify]
import postgres from "postgres";
import { PROCESS_RUN_ACTIVE } from "../../../packages/contracts/src/chat/processes";

export const LEGACY_KEY = "contracts-approval";

type Counts = { open: number; mapped: number; unmapped: number; defs: number };

export async function countLegacy(sql: postgres.Sql): Promise<Counts> {
  const [r] = await sql<Counts[]>`
    select count(*)::int as open,
      count(a.id)::int as mapped,
      (count(*) - count(a.id))::int as unmapped,
      (select count(*)::int from hub.process_defs d where d.key = ${LEGACY_KEY} and d.enabled and d.deleted_at is null) as defs
    from hub.process_runs r
    left join contracts.approvals a on a.id = r.id and a.tenant_id = r.tenant_id
    where r.snapshot ->> 'key' = ${LEGACY_KEY} and r.status = any(${[...PROCESS_RUN_ACTIVE]}::text[])`;
  return r as Counts;
}

/** Một tx: hết hạn ngay các run mở + tắt def. Trả số run/def đã đổi. */
export async function closeLegacy(sql: postgres.Sql): Promise<{ runs: number; defs: number }> {
  return sql.begin(async (tx) => {
    const runs = await tx`update hub.process_runs set expires_at = now(), updated_at = now()
      where snapshot ->> 'key' = ${LEGACY_KEY} and status = any(${[...PROCESS_RUN_ACTIVE]}::text[])
      returning id`;
    const defs =
      await tx`update hub.process_defs set enabled = false, version = version + 1, updated_at = now()
      where key = ${LEGACY_KEY} and enabled and deleted_at is null returning id`;
    // Cache cấu hình của hub nạp lại def (như mọi lần sửa def).
    if (defs.length > 0)
      await tx`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    return { runs: runs.length, defs: defs.length };
  });
}

/** Review B #3 · id run mở KHÔNG có lượt duyệt tương ứng (duyệt dở dang sẽ mất nếu đóng). */
export async function unmappedIds(sql: postgres.Sql, limit = 200): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select r.id from hub.process_runs r
    left join contracts.approvals a on a.id = r.id and a.tenant_id = r.tenant_id
    where r.snapshot ->> 'key' = ${LEGACY_KEY} and r.status = any(${[...PROCESS_RUN_ACTIVE]}::text[])
      and a.id is null
    order by r.id limit ${limit}`;
  return rows.map((r) => r.id);
}

export type Plan = "dry-run" | "apply" | "blocked-unmapped" | "verify-ok" | "verify-open";
/** Luật chạy (thuần): `--apply` chặn khi còn run chưa ánh xạ (trừ `--force`); `--verify` đỏ khi còn run mở. */
export function planOf(c: Counts, argv: readonly string[]): Plan {
  if (argv.includes("--verify")) return c.open > 0 ? "verify-open" : "verify-ok";
  if (!argv.includes("--apply")) return "dry-run";
  return c.unmapped > 0 && !argv.includes("--force") ? "blocked-unmapped" : "apply";
}

// Review B #2 · `--apply` chỉ đặt hết hạn: run chỉ thật sự đóng khi vòng hết hạn của engine chạy MỘT lượt — hub phải chạy với
// `HUB_PROCESS_ENGINE=on` (mặc định production là off) ít nhất một chu kỳ quét, rồi chạy `--verify` (đỏ nếu còn run mở).
const AFTER_APPLY = `BƯỚC TIẾP (bắt buộc): khởi động hub với HUB_PROCESS_ENGINE=on cho tới khi vòng quét chạy ít nhất một lượt (mặc định 60 s), rồi chạy lại với --verify (đỏ nếu còn run mở). Engine tắt thì run vẫn active mãi.`;

async function main(sql: postgres.Sql, argv: readonly string[]): Promise<number> {
  const before = await countLegacy(sql);
  console.log(`contracts-approval: ${JSON.stringify(before)}`);
  const plan = planOf(before, argv);
  if (plan === "dry-run") console.log("chạy thử: thêm --apply để ghi");
  if (plan === "verify-ok") console.log("đã đóng hết run contracts-approval");
  if (plan === "verify-open") console.error(`còn ${before.open} run mở — engine chưa quét?`);
  if (plan === "blocked-unmapped") {
    console.error(
      `DỪNG: ${before.unmapped} run chưa có lượt duyệt tương ứng (duyệt dở dang sẽ mất).`,
    );
    console.error((await unmappedIds(sql)).join("\n"));
    console.error("Kiểm tra từng run; chắc chắn đóng ⇒ chạy lại với --apply --force.");
  }
  if (plan === "apply") {
    const done = await closeLegacy(sql);
    console.log(`đã đặt hết hạn ${done.runs} run, tắt ${done.defs} def.`);
    console.log(AFTER_APPLY);
  }
  return plan === "blocked-unmapped" || plan === "verify-open" ? 1 : 0;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa đặt");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    process.exitCode = await main(sql, process.argv);
  } finally {
    await sql.end();
  }
}
