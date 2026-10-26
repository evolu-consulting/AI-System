// CR-097 D1 · luật thuần của backfill dữ liệu khách (không DB): đọc cờ dòng lệnh, đếm hàng sẽ đổi, bất biến "sao đã nhập chỉ đọc".
// Dùng chung cho `d1-backfill.ts` (ghi) và test. Nhãn "Chưa có văn bản" KHÔNG lưu: `has_document = file_id is not null` suy khi đọc
// (K1/K2: contracts.mapper) ⇒ script chỉ ĐẾM/liệt kê HĐ không tệp, không ghi gì.

export type Flags = { tenant: string; dryRun: boolean };

/** `--tenant <khoá>` bắt buộc (không có chế độ "mọi tenant"); `--dry-run` = chạy thật trong tx rồi huỷ. */
export function parseFlags(argv: readonly string[]): Flags {
  const i = argv.indexOf("--tenant");
  const tenant = i >= 0 ? argv[i + 1] : undefined;
  if (!tenant || tenant.startsWith("--") || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenant))
    throw new Error("d1-backfill: cần --tenant <khoá tenant> (vd nitigroup)");
  return { tenant, dryRun: argv.includes("--dry-run") };
}

/** Số liệu đo trước/sau trong cùng tx (mọi số là số hàng của MỘT tenant). */
export type Measure = {
  /** HĐ thiếu `root_id` (cột NOT NULL sau 0049 ⇒ chỉ ≠ 0 nếu DB cũ/đã nới). */
  rootMissing: number;
  /** HĐ gốc (`supersedes_id` null) mà `version_no ≠ 1` hoặc `root_id ≠ id`. */
  versionBad: number;
  /** HĐ đã xác nhận mà chưa có `locked_at` (K1). */
  unlocked: number;
  /** HĐ hiện hành loại `contract` không có tệp gốc (nhãn "Chưa có văn bản", chỉ đọc). */
  noDocument: number;
  /** Sao đã nhập (V2-E) — phải KHÔNG đổi. */
  scoreRatings: number;
  /** Dòng sổ `partner_events.type = 'rating'` — phải KHÔNG đổi. */
  ratingEvents: number;
};

export type Changed = { root: number; version: number; locked: number };

/** Sao đã nhập giữ nguyên: sau ≡ trước, nếu không ⇒ lỗi (script huỷ tx). */
export function assertRatingsUntouched(before: Measure, after: Measure): void {
  if (before.scoreRatings !== after.scoreRatings || before.ratingEvents !== after.ratingEvents)
    throw new Error(
      `d1-backfill: sao đã nhập bị đổi (score_ratings ${before.scoreRatings}→${after.scoreRatings}, rating ${before.ratingEvents}→${after.ratingEvents}) — huỷ`,
    );
}

/** Sau backfill không còn hàng thiếu (chạy lần 2 ⇒ mọi `Changed` = 0). */
export function assertConverged(after: Measure): void {
  if (after.rootMissing + after.versionBad + after.unlocked !== 0)
    throw new Error("d1-backfill: vẫn còn hàng thiếu sau khi sửa — huỷ");
}

export const changedTotal = (c: Changed): number => c.root + c.version + c.locked;

/** Dòng báo cáo (tiếng Việt, một dòng mỗi việc). */
export function report(tenant: string, c: Changed, after: Measure, dryRun: boolean): string[] {
  const verb = dryRun ? "sẽ đổi" : "đã đổi";
  return [
    `d1-backfill [${tenant}] ${dryRun ? "CHẠY THỬ (không ghi)" : "ĐÃ GHI"}`,
    `  root_id thiếu: ${verb} ${c.root} hàng`,
    `  version_no/root_id lệch (HĐ gốc): ${verb} ${c.version} hàng`,
    `  HĐ đã xác nhận thiếu locked_at: ${verb} ${c.locked} hàng`,
    `  HĐ hiện hành "Chưa có văn bản" (không ghi, nhãn suy khi đọc): ${after.noDocument}`,
    `  sao đã nhập giữ nguyên (chỉ đọc): score_ratings ${after.scoreRatings}, partner_events.rating ${after.ratingEvents}`,
    `  tổng ${verb}: ${changedTotal(c)} hàng`,
  ];
}
