// pl-e2e-roles · bug class G3 (docs/platform/dev-flow.md §5): e2e xanh vì CÙNG một tài khoản tạo dữ liệu rồi làm bước (CR-126: đối tác chỉ
// hiện cho người thêm). Helper thuần (không import.meta / Bun / Playwright) để Playwright nạp dạng CJS và `bun test` dùng chung.

export interface Actors {
  /** Người tạo bản ghi chính (vd hợp đồng). */
  creator: string;
  /** Người làm bước đang kiểm (vd chọn đối tác). */
  actor: string;
  /** Người tạo dữ liệu phụ mà bước cần thấy (vd dòng đối tác). */
  dataOwner: string;
}

/** Ném ngay nếu người làm bước trùng người tạo bản ghi hoặc người thêm dữ liệu: e2e như vậy không bắt được lỗi quyền thấy dữ liệu. */
export function assertDistinctActors(step: string, a: Actors): void {
  if (a.actor === a.dataOwner)
    throw new Error(
      `[e2e-roles] «${step}»: người làm bước (${a.actor}) trùng người thêm dữ liệu (${a.dataOwner}) — dùng tài khoản khác thêm dữ liệu để bắt lỗi "chỉ người thêm mới thấy" (G3).`,
    );
  if (a.actor === a.creator)
    throw new Error(
      `[e2e-roles] «${step}»: người làm bước (${a.actor}) trùng người tạo bản ghi (${a.creator}) — dùng tài khoản khác (G3).`,
    );
}
