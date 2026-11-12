// CR-127 · E7 · BR-17 · spec §5.6 · luật THUẦN của "Chạy thử": ai sẽ nhận việc ở một bước Duyệt lúc chạy thật, và cảnh báo trước khi áp
// dụng. Dùng chung luật engine (không viết bản mô phỏng riêng): `headGate`, `soleStarterTargets`/`zeroVoterTargets` (R#15, n=0),
// `resolveDelegate` (uỷ quyền), `voteAs`/`canAct` (đóng vai). Không I/O, không ghi gì.
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import { type Voter, voteAs, zeroVoterTargets } from "../tasks/all-vote.rules";
import type { TaskNeed } from "../tasks/claim.rules";
import { type DelegationRow, resolveDelegate, soleStarterTargets } from "../tasks/delegation.rules";
import { canAct, headGate, type TaskFacts } from "../tasks/task-access.rules";

export type PreviewUser = { id: string; name: string; usable: boolean; role: string };
export type PreviewGroup = {
  name: string;
  memberIds: readonly string[];
  headUserId: string | null;
};
/** Dữ liệu thật của công ty (đọc một lần ở repo): người dùng, phòng/nhóm + trưởng phòng, quản trị công ty, uỷ quyền đang sống. */
export type World = {
  tenantId: string;
  users: ReadonlyMap<string, PreviewUser>;
  groups: ReadonlyMap<string, PreviewGroup>;
  adminIds: readonly string[];
  delegations: readonly DelegationRow[];
};

export type HolderVia = "group" | "head" | "person" | "delegated" | "escalated";
export type Holder = {
  user_id: string;
  name: string;
  via: HolderVia;
  on_behalf_of?: string | null;
};
export type WarnCode =
  | "step_no_people"
  | "group_missing"
  | "group_single"
  | "no_head"
  | "starter_only"
  | "all_zero"
  | "facts_missing"
  | "path_no_end"
  | "parallel_groups"
  | "parallel_steps"
  | "loop";
export type PreviewWarning = { code: WarnCode; step_key: string | null; message: string };

export type ReviewView = {
  need: TaskNeed;
  group_id: string | null;
  group_name: string | null;
  /** Người sẽ nhận việc (tối đa `WHO_MAX`); `who_total` = tổng. Việc nhóm `need='one'`: mọi thành viên nhận được, một người quyết là đủ. */
  who: Holder[];
  who_total: number;
  evidence: "opinion" | "opinion_plus";
  /** Chuyển cấp sau N giờ (`after.escalate.after_h`); null = không đặt. */
  due_h: number | null;
  /** `need='all'`: n người phải duyệt (đã trừ người gửi/người vô hiệu). */
  voters_n: number | null;
};
export type ReviewInfo = ReviewView & {
  gate: string | null;
  voters: readonly Voter[] | null;
  warnings: PreviewWarning[];
};

export const WHO_MAX = 12;
const nameOf = (w: World, id: string): string => w.users.get(id)?.name ?? "?";
const usableOf = (w: World, id: string): boolean => w.users.get(id)?.usable === true;
const holder = (w: World, id: string, via: HolderVia, behalf: string | null = null): Holder => ({
  user_id: id,
  name: nameOf(w, id),
  via,
  ...(behalf ? { on_behalf_of: behalf } : {}),
});

type After = Extract<ProcessStageDef["after"], { kind: "review" }>;
export const isReview = (s: ProcessStageDef): boolean => s.after.kind === "review";
const afterOf = (s: ProcessStageDef): After => s.after as After;

type Targets = Parameters<typeof soleStarterTargets>[1];
type Ctx = {
  stage: ProcessStageDef;
  w: World;
  starter: string | null;
  at: Date;
  targets: Targets;
  warn: (code: WarnCode, message: string) => void;
};

type Gate = {
  group: PreviewGroup | null;
  groupId: string | null;
  approver: string | null;
  gate: string | null;
};
/** Phòng duyệt + cửa duyệt (trưởng phòng / người cụ thể) của bước, kèm cảnh báo chưa chọn phòng / chưa có trưởng phòng. */
function gateOf(c: Ctx, a: After): Gate {
  const { stage, w, warn } = c;
  const group = a.group_id ? (w.groups.get(a.group_id) ?? null) : null;
  const groupId = group ? (a.group_id as string) : null;
  if (!group && !a.approver_user_id && a.approver_mode !== "starter_head")
    // CR-139
    warn(
      "group_missing",
      `Bước «${stage.name}» chưa chọn phòng duyệt (hoặc phòng không còn ở công ty): chọn phòng cho bước này.`,
    );
  const approver =
    a.approver_user_id && usableOf(w, a.approver_user_id) ? a.approver_user_id : null;
  const head = group?.headUserId ?? null;
  if (a.head_only === true && group && !head && !approver)
    warn(
      "no_head",
      `Phòng «${group.name}» chưa có trưởng phòng: bước «${stage.name}» giao cho cả phòng.`,
    );
  return {
    group,
    groupId,
    approver,
    gate: headGate({ ...a, group_id: groupId }, approver ?? head),
  };
}

/** Người nhận theo nhánh luật: cửa duyệt · tất cả · việc nhóm. */
function holdersOf(c: Ctx, a: After, g: Gate, need: TaskNeed) {
  if (g.gate) return { who: headBranch(c, g.gate, g.approver), voters: null };
  const members = (g.group?.memberIds ?? []).filter((u) => usableOf(c.w, u));
  if (need === "all") return allBranch(c, members);
  const who = oneBranch(c, members, g.group?.name ?? null, a.exclude_starter === true);
  return { who, voters: null };
}

/** Người nhận việc + cảnh báo của MỘT bước Duyệt, theo đúng luật mở task (`core.repo#insertTask` / `review-timing.sql`). */
export function resolveReview(
  stage: ProcessStageDef,
  w: World,
  starter: string | null,
  at: Date,
): ReviewInfo {
  const a = afterOf(stage);
  const warnings: PreviewWarning[] = [];
  const warn = (code: WarnCode, message: string) =>
    warnings.push({ code, step_key: stage.key, message });
  const esc = a.escalate ?? null;
  const escGroup = esc?.group_id && w.groups.has(esc.group_id) ? esc.group_id : null;
  const ctx: Ctx = {
    stage,
    w,
    starter,
    at,
    warn,
    targets: { userId: esc?.user_id ?? null, groupId: escGroup, adminIds: w.adminIds },
  };
  const g = gateOf(ctx, a);
  const need: TaskNeed = g.gate ? "head" : a.need === "all" ? "all" : "one";
  const { who, voters } = holdersOf(ctx, a, g, need);
  const covered = warnings.some((x) => x.code === "group_missing" || x.code === "all_zero");
  if (who.length === 0 && !covered)
    warn(
      "step_no_people",
      `Bước «${stage.name}» chưa có ai nhận việc: thêm người vào phòng hoặc chọn phòng khác.`,
    );
  return {
    need,
    group_id: g.groupId,
    group_name: g.group?.name ?? null,
    evidence: (a.evidence ?? "opinion") as "opinion" | "opinion_plus",
    due_h: esc?.after_h ?? null,
    gate: g.gate,
    warnings,
    who: who.slice(0, WHO_MAX),
    who_total: who.length,
    voters,
    voters_n: voters ? voters.filter((v) => v.usable).length : null,
  };
}

/** Việc nhóm (`need='one'`): thành viên phòng, một người nhận; người gửi bị loại khi `exclude_starter`. */
function oneBranch(
  c: Ctx,
  members: readonly string[],
  groupName: string | null,
  excludeStarter: boolean,
): Holder[] {
  const eligible = members.filter((u) => !(excludeStarter && u === c.starter));
  if (members.length === 1 && groupName)
    c.warn(
      "group_single",
      `${groupName} chỉ có 1 người: người này nghỉ thì việc quá hạn không có ai nhận.`,
    );
  if (members.length > 0 && eligible.length === 0)
    c.warn(
      "starter_only",
      `Người gửi là người duyệt duy nhất của «${c.stage.name}»: việc chuyển cho cấp quá hạn hoặc quản trị công ty.`,
    );
  return eligible.map((u) => holder(c.w, u, "group"));
}

/** Cửa trưởng phòng / người duyệt cụ thể: một người nhận (+ người được uỷ quyền) · R#15 người gửi duy nhất. */
function headBranch(c: Ctx, gate: string, approver: string | null): Holder[] {
  const out = [holder(c.w, gate, approver ? "person" : "head")];
  const to = resolveDelegate(gate, "review", c.at, c.w.delegations, { starterId: c.starter });
  if (to) out.push(holder(c.w, to, "delegated", gate));
  const sole = soleStarterTargets({ gate, soleUser: null, starter: c.starter }, c.targets);
  if (sole) {
    c.warn(
      "starter_only",
      `Người gửi là người duyệt duy nhất của «${c.stage.name}»: việc chuyển cho cấp «Quá hạn chuyển cho», không có thì quản trị công ty.`,
    );
    for (const u of sole.userIds) out.push(holder(c.w, u, "escalated"));
  }
  return out;
}

/** "Cần: tất cả": n = thành viên phòng trừ người gửi; n = 0 ⇒ giao cấp quá hạn / quản trị công ty (R#14). */
function allBranch(c: Ctx, members: readonly string[]): { who: Holder[]; voters: Voter[] } {
  const voters: Voter[] = members
    .filter((u) => u !== c.starter)
    .map((u) => ({ userId: u, usable: true }));
  if (voters.length === 0) {
    const z = zeroVoterTargets(c.starter, c.targets);
    c.warn(
      "all_zero",
      `«${c.stage.name}» cần tất cả mọi người trong phòng duyệt nhưng phòng không có ai ngoài người gửi: việc giao cho cấp quá hạn hoặc quản trị công ty.`,
    );
    return { who: (z?.userIds ?? []).map((u) => holder(c.w, u, "escalated")), voters };
  }
  const who = voters.map((v) => {
    const to = resolveDelegate(v.userId, "review", c.at, c.w.delegations, { starterId: c.starter });
    return to ? holder(c.w, to, "delegated", v.userId) : holder(c.w, v.userId, "group");
  });
  return { who, voters };
}

/** Người `actorId` đóng vai có quyết được bước này không — `canAct` của engine (một nguồn). */
export function canActAs(
  stage: ProcessStageDef,
  info: ReviewInfo,
  w: World,
  starter: string | null,
  actorId: string,
): boolean {
  const a = afterOf(stage);
  const groupIds = new Set(
    [...w.groups].filter(([, g]) => g.memberIds.includes(actorId)).map(([id]) => id),
  );
  const delegatedFor =
    info.who.find((h) => h.via === "delegated" && h.user_id === actorId)?.on_behalf_of ?? null;
  const t: TaskFacts = {
    kind: "review",
    status: "open",
    reason: null,
    userIds: new Set(info.who.filter((h) => h.via !== "group").map((h) => h.user_id)),
    groupId: info.group_id,
    reviewGroupId: info.group_id,
    starterExcluded: a.exclude_starter === true,
    headGate: info.gate,
    need: info.need,
    claimedBy: null,
    allVote:
      info.need === "all" && info.voters
        ? {
            as: voteAs(actorId, info.voters, [], delegatedFor).kind,
            escalatedUser: info.who.some((h) => h.via === "escalated" && h.user_id === actorId),
          }
        : null,
  };
  return canAct({ userId: actorId, tenantId: w.tenantId, role: "member", groupIds }, t, {
    tenantId: w.tenantId,
    startedBy: starter ?? "",
    originRoom: "none",
    taskAssignee: false,
    status: "waiting_review",
  });
}
