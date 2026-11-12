// CR-127 · E10a · spec §5.9 · BR-31 · đích giao việc «Xác nhận mốc» theo cấu hình node (như khối Duyệt), luật thuần.
// Ai làm: người cụ thể (`approver_user_id`, còn dùng được) thắng; phòng chọn (`group_id`/`group_key`) thắng phòng mặc định của người
// phụ trách (#60: phòng đầu tiên theo thứ tự thành viên); không phòng ⇒ đích danh người phụ trách.
// Cần: trưởng phòng (`need='head'` hoặc `head_only`) ⇒ đích danh trưởng phòng của phòng đã chọn; phòng không có trưởng ⇒ cả phòng.

export type MilestoneAfter = {
  kind?: string;
  need?: string;
  head_only?: boolean;
} | null;

export type MilestoneTargetInput = {
  owner: string;
  /** Người cụ thể đã kiểm còn dùng được ở tenant (null = không cấu hình / không hợp lệ). */
  approver: string | null;
  /** Phòng cấu hình đã kiểm cùng tenant (null = không cấu hình). */
  cfgGroup: string | null;
  /** Phòng đầu tiên của người phụ trách (null = không phòng). */
  ownerGroup: string | null;
  /** Trưởng phòng của phòng đã chọn (chỉ cần khi `wantsHead`). */
  head: string | null;
  wantsHead: boolean;
};

export type MilestoneTarget = { groupId: string | null; userIds: string[] };

/** Bước cấu hình «Cần: trưởng phòng». */
export const wantsHead = (after: MilestoneAfter): boolean =>
  after?.kind === "review" && (after.need === "head" || after.head_only === true);

/** Phòng sẽ giao (trước khi xét trưởng phòng); null khi giao đích danh người cụ thể / người phụ trách. */
export function milestoneGroup(
  c: Pick<MilestoneTargetInput, "approver" | "cfgGroup" | "ownerGroup">,
) {
  return c.approver ? null : (c.cfgGroup ?? c.ownerGroup);
}

export function milestoneTarget(c: MilestoneTargetInput): MilestoneTarget {
  if (c.approver) return { groupId: null, userIds: [c.approver] };
  const g = milestoneGroup(c);
  if (!g) return { groupId: null, userIds: [c.owner] };
  if (c.wantsHead && c.head) return { groupId: null, userIds: [c.head] };
  return { groupId: g, userIds: [] };
}
