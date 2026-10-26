// CR-097 D1 · "N đối tác đổi mức": so mức điểm cũ (V2-E, `score_locks` đã chốt) với mức mới của engine HD8 (U1/U2). Thuần, không DB.
// Mức = good | fair | watch | new; mức mới `new` khi engine không có điểm (null: chưa đủ việc / "MỚI · tạm tính"). Vai bên trả hoa
// hồng (commission_payer) tính như Khách (Q3). Đối tác chưa có điểm chốt nào ⇒ "chưa có mức cũ" (không tính là đổi).

export type Level = "good" | "fair" | "watch" | "new";
export type Role = "customer" | "supplier";

/** Dòng điểm mới (rút gọn từ `PartnerOut`). */
export type NewRow = {
  party: string;
  name: string;
  role: Role;
  band: "good" | "fair" | "watch" | null;
  provisional?: boolean;
  red_flag?: boolean;
};
/** Điểm đã chốt (V2-E) mới nhất của một ô (đối tác, vai, nhóm). */
export type OldLock = {
  party_key: string;
  role: string;
  grp: string;
  period: string;
  level: string;
  jobs: number;
};

export type Change = {
  party: string;
  name: string;
  role: Role;
  old: Level | null;
  new: Level;
  provisional: boolean;
  red_flag: boolean;
};
export type Preview = {
  /** Số đối tác (không trùng) đổi mức ở ít nhất một vai. */
  partners_changed: number;
  /** Số đối tác có ít nhất một vai được so (có mức cũ). */
  compared: number;
  /** Số đối tác không có mức cũ. */
  no_old: number;
  /** Số đối tác có cờ đỏ ở bản mới. */
  red_flags: number;
  total: number;
  changes: Change[];
};

const LEVELS = new Set<string>(["good", "fair", "watch", "new"]);
const roleOf = (r: string): Role | null =>
  r === "customer" || r === "commission_payer" ? "customer" : r === "supplier" ? "supplier" : null;

/** Mức cũ mỗi (đối tác, vai): kỳ chốt mới nhất; cùng kỳ lấy ô nhiều việc nhất (xấp xỉ "mức hiển thị" của V2-E theo vai). */
export function oldLevels(locks: readonly OldLock[]): Map<string, Level> {
  const best = new Map<string, OldLock>();
  for (const l of locks) {
    const role = roleOf(l.role);
    if (!role || !LEVELS.has(l.level)) continue;
    const k = `${role}|${l.party_key}`;
    const cur = best.get(k);
    if (!cur || l.period > cur.period || (l.period === cur.period && l.jobs > cur.jobs))
      best.set(k, l);
  }
  return new Map([...best].map(([k, l]) => [k, l.level as Level]));
}

export function previewLevels(rows: readonly NewRow[], locks: readonly OldLock[]): Preview {
  const old = oldLevels(locks);
  const changes: Change[] = [];
  const compared = new Set<string>();
  const parties = new Set<string>();
  const flagged = new Set<string>();
  for (const r of rows) {
    parties.add(r.party);
    if (r.red_flag) flagged.add(r.party);
    const was = old.get(`${r.role}|${r.party}`) ?? null;
    if (was === null) continue;
    compared.add(r.party);
    const now: Level = r.band ?? "new";
    if (was !== now)
      changes.push({
        party: r.party,
        name: r.name,
        role: r.role,
        old: was,
        new: now,
        provisional: r.provisional === true,
        red_flag: r.red_flag === true,
      });
  }
  changes.sort((a, b) => a.name.localeCompare(b.name) || a.role.localeCompare(b.role));
  return {
    partners_changed: new Set(changes.map((c) => c.party)).size,
    compared: compared.size,
    no_old: parties.size - compared.size,
    red_flags: flagged.size,
    total: parties.size,
    changes,
  };
}

/** Dòng in cho người chạy: câu chính "N đối tác đổi mức" + chi tiết từng đối tác. */
export function previewLines(tenant: string, p: Preview): string[] {
  const head = `d1-preview [${tenant}] ${p.partners_changed} đối tác đổi mức (so ${p.compared}/${p.total} đối tác có mức cũ; ${p.no_old} chưa có mức cũ; ${p.red_flags} có cờ đỏ)`;
  return [
    head,
    ...p.changes.map(
      (c) =>
        `  ${c.name || c.party} [${c.role}]: ${c.old} → ${c.new}${c.provisional ? " (MỚI · tạm tính)" : ""}${c.red_flag ? " · CỜ ĐỎ" : ""}`,
    ),
  ];
}
