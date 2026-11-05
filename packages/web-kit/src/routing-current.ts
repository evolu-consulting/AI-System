// hub-routing-backfill · quy trình "Đang dùng" (chạy khi không có luật: gán cũ ⇒ mặc định khe) từ GET routing. Logic THUẦN dùng
// chung workspace-web (Cài đặt) và admin-web (SlotRouting, /processes "Được platform gán"); mỗi app tự lo chữ.
type RoutingLike = {
  processes: readonly { def_id: string }[];
  current_def_id?: string | null;
  current_def_name?: string | null;
  /** false ⇒ khe opt-in chưa bật (hub trả); vắng ⇒ coi như bật (server cũ). */
  active?: boolean;
};

export type RoutingCurrent = {
  /** def trong `processes` cần gắn nhãn "Đang dùng" (null = không hàng nào). */
  markId: string | null;
  /** Quy trình đang dùng KHÔNG nằm trong tập gán (mặc định khe chưa gán) ⇒ app hiện một dòng riêng. */
  outside: { defId: string; name: string } | null;
  /** Khe opt-in đang TẮT (chưa luật, chưa gán) ⇒ app hiện "Đang tắt", không gắn "Đang dùng". */
  off?: true;
};

export function routingCurrent(d: RoutingLike): RoutingCurrent {
  if (d.active === false) return { markId: null, outside: null, off: true };
  const id = d.current_def_id ?? null;
  if (!id) return { markId: null, outside: null };
  if (d.processes.some((p) => p.def_id === id)) return { markId: id, outside: null };
  return { markId: null, outside: { defId: id, name: d.current_def_name ?? "" } };
}
