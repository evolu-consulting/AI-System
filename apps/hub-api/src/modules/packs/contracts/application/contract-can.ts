// CR-127 K2a-1 · BR-09/44 · spec §4.1 (`GET /contracts/:id` → `can`): nút nào bấm được theo TRẠNG THÁI + người gọi. Thuần, không đọc DB.
// Chỉ là gợi ý cho UI (hiện/ẩn nút + lý do); quyền thật do route/use case của từng lệnh kiểm lại. Thiếu người gọi ⇒ các nút cần quyền = false.
// Hold/release: `canOf` tính người phụ trách HĐ; trưởng phòng của họ / quản trị công ty (R#18) thêm bởi `withHoldRole` (X3, cần tra `admin.*`).
export type CanFacts = {
  status: string;
  extract_state: string;
  superseded: boolean;
  effect: string | null;
  hold: unknown | null;
  created_by: string;
  owner_user_id: string | null;
  submitted_by: string | null;
};
export type Can = {
  submit: boolean;
  withdraw: boolean;
  recreate: boolean;
  new_version: boolean;
  hold: boolean;
  release: boolean;
  /** CR-127 SG1 · BR-68: quyết kết cục hiệu lực bằng tay — theo vai + quy trình khớp nên do `withExpiryCan` (detail-expiry-role.ts) đặt, không phải `canOf`. */
  expiry?: boolean;
  /** CR-127 · Z8: xoá HĐ — theo vai (quản trị gói / người tạo-phụ trách khi draft) nên do `withDeleteCan` (detail-delete-role.ts) đặt, không phải `canOf`. */
  delete?: boolean;
};

/** Hiệu lực mà tạm khoá có nghĩa (còn việc thực hiện): đang hiệu lực / sắp hết hạn. */
const HOLDABLE = new Set(["active", "expiring"]);

/** Nút Tạm khoá / Mở khoá theo TRẠNG THÁI (chưa xét vai). */
export function holdCan(f: CanFacts): Pick<Can, "hold" | "release"> {
  const done = f.status === "done" && !f.superseded;
  return {
    hold: done && f.effect !== null && HOLDABLE.has(f.effect) && f.hold == null,
    release: done && f.hold != null,
  };
}

export function canOf(f: CanFacts, actor: string | null | undefined): Can {
  const me = actor ?? null;
  const mine = me !== null && (me === f.created_by || me === f.owner_user_id);
  const done = f.status === "done" && !f.superseded;
  const owner = me !== null && me === f.owner_user_id;
  const hold = holdCan(f);
  return {
    submit: f.status === "draft" && f.extract_state === "ready" && mine,
    withdraw: f.status === "processing" && me !== null && me === f.submitted_by,
    recreate: f.status === "reject" && mine,
    new_version: done,
    hold: hold.hold && owner,
    release: hold.release && owner,
  };
}
