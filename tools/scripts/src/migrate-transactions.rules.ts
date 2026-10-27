// CR-101 DOC-deals · luật thuần của script chuyển Giao dịch G1 → chứng từ (`migrate-transactions-to-contracts.ts`): cờ dòng lệnh,
// khuôn số liệu, báo cáo, bất biến "chạy lại = 0 hàng đổi". Không DB.

export type Flags = { tenants: string[]; all: boolean; apply: boolean };

const KEY = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * `--tenant <khoá>` (lặp được) hoặc `--all` (mọi tenant có hàng G1). Mặc định CHẠY THỬ (chỉ đọc, giao dịch READ ONLY);
 * `--apply` mới ghi. `--dry-run` chấp nhận cho rõ ý, không đổi gì. `--apply` + `--dry-run` ⇒ lỗi (mơ hồ).
 */
export function parseFlags(argv: readonly string[]): Flags {
  const tenants: string[] = [];
  argv.forEach((a, i) => {
    if (a !== "--tenant") return;
    const v = argv[i + 1];
    if (!v || !KEY.test(v)) throw new Error("migrate-transactions: --tenant <khoá tenant> sai");
    tenants.push(v);
  });
  const all = argv.includes("--all");
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run"))
    throw new Error("migrate-transactions: --apply và --dry-run loại trừ nhau");
  if (all === tenants.length > 0)
    throw new Error("migrate-transactions: cần đúng một trong --tenant <khoá> hoặc --all");
  return { tenants, all, apply };
}

/** Số liệu kế hoạch (đọc, không ghi) — cũng là số "sẽ đổi" của lần chạy thật. */
export type Plan = {
  /** Giao dịch G1 chưa có chứng từ cùng id (sẽ chuyển). */
  transactions: number;
  byStatus: { draft: number; posted: number; cancelled: number };
  ids: string[];
  /** Dòng hàng bản hiện hành của các giao dịch sẽ chuyển. */
  lines: number;
  /** Nghĩa vụ G1 còn trỏ `transaction_id` mà chưa có `contract_id`. */
  obligations: number;
  /** Dòng kho G1 chưa có `contract_id`. */
  stockMoves: number;
  /** Mốc tạo mới: giao (đã ghi sổ ⇒ đã xác nhận; nháp ⇒ mở) + tiền (nháp ⇒ mở). */
  milestones: number;
  /** Id giao dịch trùng id một chứng từ không phải giao dịch / tenant khác ⇒ KHÔNG chuyển, báo. */
  conflicts: string[];
  /** Không xác định được người tạo (created/posted/cancelled_by đều trống) ⇒ KHÔNG chuyển, báo. */
  noCreator: string[];
};

/** Câu 7 · HĐ nhập tay cũ không có file — chỉ báo (không ghi). */
export type ManualReport = {
  /** Chắc chắn không có văn bản: cả chuỗi không file, không văn bản đọc, không ký số, tạo bằng nhập tay, không nhập từ app cũ. */
  sure: string[];
  /** `file_id` trống nhưng có dấu vết văn bản/không rõ nguồn ⇒ giữ nguyên, người dùng xem. */
  ambiguous: { id: string; why: string[] }[];
};

export type Applied = {
  contracts: number;
  items: number;
  obligations: number;
  stockMoves: number;
  milestones: number;
  /** Dòng kho giao của giao dịch đã ghi sổ gắn vào mốc giao đã xác nhận. */
  milestoneLinks: number;
  /** SL đã giao từng dòng của mốc giao đã xác nhận (`milestone_items.delivered`). */
  milestoneItems: number;
  events: number;
};

export const appliedTotal = (a: Applied): number =>
  a.contracts +
  a.items +
  a.obligations +
  a.stockMoves +
  a.milestones +
  a.milestoneLinks +
  a.milestoneItems +
  a.events;

/** Sau khi ghi, kế hoạch đo lại phải rỗng (chạy lần 2 = 0 hàng đổi); ngược lại huỷ tx. */
export function assertConverged(after: Plan): void {
  const left = after.transactions + after.obligations + after.stockMoves + after.milestones;
  if (left !== 0)
    throw new Error(`migrate-transactions: còn ${left} hàng chưa chuyển sau khi ghi — huỷ`);
}

/** Kế hoạch trước phải khớp số đã ghi (giao dịch, dòng, nghĩa vụ, kho, mốc). */
export function assertMatches(plan: Plan, a: Applied): void {
  const want = [plan.transactions, plan.lines, plan.obligations, plan.stockMoves, plan.milestones];
  const got = [a.contracts, a.items, a.obligations, a.stockMoves, a.milestones];
  if (want.some((n, i) => n !== got[i]))
    throw new Error(
      `migrate-transactions: số ghi lệch kế hoạch (kế hoạch ${want.join("/")}, ghi ${got.join("/")}) — huỷ`,
    );
}

const list = (ids: readonly string[]) => (ids.length ? ids.join(", ") : "—");

export function report(
  scope: string,
  plan: Plan,
  manual: ManualReport,
  applied: Applied | null,
): string[] {
  const verb = applied ? "đã chuyển" : "sẽ chuyển";
  const s = plan.byStatus;
  return [
    `migrate-transactions [${scope}] ${applied ? "ĐÃ GHI (một transaction)" : "CHẠY THỬ (chỉ đọc, không ghi)"}`,
    `  giao dịch ${verb}: ${plan.transactions} (nháp ${s.draft}, đã ghi sổ ${s.posted}, đã huỷ ${s.cancelled})`,
    `    id: ${list(plan.ids)}`,
    `  dòng hàng: ${plan.lines} · nghĩa vụ trỏ lại: ${plan.obligations} · dòng kho trỏ lại: ${plan.stockMoves} · mốc tạo: ${plan.milestones}`,
    `  KHÔNG chuyển — trùng id chứng từ khác: ${plan.conflicts.length} (${list(plan.conflicts)})`,
    `  KHÔNG chuyển — không rõ người tạo: ${plan.noCreator.length} (${list(plan.noCreator)})`,
    `  Câu 7 · HĐ nhập tay không file (CHỈ BÁO, không ghi): chắc chắn ${manual.sure.length}, mơ hồ ${manual.ambiguous.length}`,
    `    chắc chắn: ${list(manual.sure)}`,
    `    mơ hồ: ${manual.ambiguous.length ? manual.ambiguous.map((a) => `${a.id} [${a.why.join("+")}]`).join(", ") : "—"}`,
    ...(applied
      ? [
          `  ghi: chứng từ ${applied.contracts}, dòng ${applied.items}, nghĩa vụ ${applied.obligations}, kho ${applied.stockMoves}, mốc ${applied.milestones} (+${applied.milestoneLinks} dòng kho, ${applied.milestoneItems} SL đã giao gắn mốc), sự kiện ${applied.events}`,
        ]
      : []),
  ];
}
