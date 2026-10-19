// M3-decouple · M3-10 · script MỘT LẦN (admin): đóng các run engine `contracts-approval` còn mở sau khi gói hợp đồng tách khỏi
// engine (migration gói 0011 đã chuyển mỗi run thành một hàng `contracts.approvals` cùng id). Cách đóng: đặt `expires_at = now()`
// ⇒ vòng hết hạn CÓ SẴN của engine (`processes/runs/expire.ts`) đóng run đúng luật (stage cancelled, task duyệt closed, timer
// huỷ, sự kiện kết thúc) — script không tự ghi các bảng đó. Đồng thời tắt def `contracts-approval` để không ai mở run mới.
// Mặc định chạy thử (chỉ đếm); `--apply` mới ghi. Cần `DATABASE_URL` (role chủ migration).
//   bun tools/scripts/src/m3-close-contract-runs.ts [--apply]
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

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa đặt");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const before = await countLegacy(sql);
    console.log(`contracts-approval: ${JSON.stringify(before)}`);
    if (process.argv.includes("--apply")) {
      const done = await closeLegacy(sql);
      console.log(
        `đã đặt hết hạn ${done.runs} run, tắt ${done.defs} def — vòng hết hạn của engine sẽ đóng run`,
      );
    } else console.log("chạy thử: thêm --apply để ghi");
  } finally {
    await sql.end();
  }
}
