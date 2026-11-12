// CR-127 · X3 · spec §4 (hold/release, yêu cầu thay đổi), §6, BR-41/42/52/53/75/76: tạm khoá, mở khoá, dời hạn, tách mốc, miễn phạt đều đi qua MỘT
// bảng "Yêu cầu chờ duyệt" (`exec_requests`). Có quy trình `fulfilment.change_requested` khớp ⇒ `pending` + phát sự kiện (kho/mốc CHƯA đổi, mốc hiện
// "Chờ duyệt thay đổi"); không ⇒ áp ngay với bằng chứng. Duyệt ⇒ áp đúng đường `applyKind` (xem `exec-request-events.mount.ts`); từ chối ⇒ giữ nguyên + báo.
// Mỗi lệnh MỘT tx `PackUow`: khoá HĐ → (khoá mốc) → luật thuần → ghi. Lớp 2: không SQL.
import type {
  ChangeRequest,
  ExecKind,
  ExecRequestOut,
  HoldRequest,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import type { ExecContract, ExecEvidence, ExecRepo } from "../adapters/exec-requests.repo";
import {
  type ChangeFacts,
  daysBetween,
  factsOf,
  holdable,
  mayChange,
  mayHold,
} from "../domain/exec-request.rules";
import { roleOf } from "../domain/ledger.rules";
import { LedgerFail, type LedgerRepos, type LockedObligation } from "./ledger.ports";

export type ExecFailKind =
  | "not_found"
  | "hold_exists"
  | "not_held"
  | "hold_not_allowed"
  | "hold_forbidden"
  | "change_forbidden"
  | "evidence_required"
  | "invalid"
  | "pending_exists";
export class ExecFail extends Error {
  constructor(readonly kind: ExecFailKind) {
    super(kind);
  }
}

export type ExecRepos = { exec: ExecRepo; ledger: LedgerRepos["ledger"] };
/** Người gọi + quyền quản trị công ty (route tính từ quyền `admin` của gói). */
export type ExecWho = PackWho & { admin: boolean };
export type ExecDeps = {
  uow: PackUow<ExecRepos>;
  /** Có quy trình `fulfilment.change_requested` khớp? (engine `FlowAvailability`; chưa có engine ⇒ false ⇒ áp ngay). */
  hasFlow(q: {
    tenantId: string;
    facts: Record<string, string | number | boolean>;
  }): Promise<boolean>;
  /** `userId` là trưởng của phòng nào đó có `ownerId` là thành viên? (đọc `admin.*` qua hub scope). */
  headOf(tenantId: string, ownerId: string, userId: string): Promise<boolean>;
  today(tenantId: string): Promise<string>;
  newId(): string;
};

const isUnique = (e: unknown) => {
  const o = e as { code?: string; cause?: { code?: string } };
  return o?.code === "23505" || o?.cause?.code === "23505";
};
const evidenceOf = (e: HoldRequest["evidence"]): ExecEvidence => {
  if (!e?.note.trim()) throw new ExecFail("evidence_required");
  return e;
};

/** Áp MỘT yêu cầu vào dữ liệu thật (cùng đường cho "áp ngay" và "đã duyệt"). Trả mốc sau khi đổi (nếu có). */
export type ApplyIn = {
  repos: ExecRepos;
  contractId: string;
  obligationId: string | null;
  kind: ExecKind;
  payload: Record<string, unknown>;
  by: string;
  evidenceId: string | null;
  today: string;
};
export async function applyKind(a: ApplyIn): Promise<unknown> {
  if (a.kind === "hold" || a.kind === "release") return applyHoldKind(a, a.kind);
  const id = a.obligationId;
  if (!id) throw new ExecFail("invalid");
  const { exec, ledger } = a.repos;
  const p = a.payload;
  const need = <T>(v: T | null): T => {
    if (v === null) throw new ExecFail("invalid");
    return v;
  };
  if (a.kind === "waive_penalty") return need(await exec.applyWaive(id, a.by, a.evidenceId));
  if (a.kind === "split") {
    const s = p as { due_date: string; amount: number; title?: string };
    // CR-127 X5: tách mốc KHÔNG đóng việc — mốc gốc vẫn mở, giữ hạn (khoá nguồn lịch theo hạn đã chạy ⇒ đóng sẽ mất việc vĩnh viễn).
    return need(await exec.applySplit(id, s, a.by, a.evidenceId));
  }
  // postpone: lại kiểm trong tx (mốc có thể đã đổi từ lúc lập yêu cầu)
  const ob = await ledger.lockObligation(id);
  if (!ob) throw new LedgerFail("not_found");
  if (ob.status !== "open") throw new LedgerFail("done");
  const to = String(p.to);
  if (to <= ob.due_date) throw new LedgerFail("postpone_date");
  const moved = await ledger.postpone({
    id,
    to,
    was: ob.due_date,
    today: a.today,
    by: a.by,
    role: roleOf(ob.direction),
    note: typeof p.note === "string" ? p.note : null,
  });
  await ledger.signalMilestone(id, "cancelled"); // CR-127 X5 (#55): chỉ DỜI HẠN đóng việc cũ (tách mốc thì không)
  return moved;
}

/** Trạng thái HĐ cho phép tạm khoá / mở khoá? */
function holdStateCheck(kind: "hold" | "release", c: ExecContract): void {
  if (kind === "release") {
    if (!c.hold) throw new ExecFail("not_held");
    return;
  }
  if (c.hold) throw new ExecFail("hold_exists");
  if (!holdable(c)) throw new ExecFail("hold_not_allowed");
}

/** Luật theo loại yêu cầu trên mốc đang mở; trả số ngày dời (chỉ dời hạn). */
function changeDays(b: ChangeRequest, ob: LockedObligation): number | null {
  const kind: string = ob.kind; // DB có thêm `penalty` (X1) mà kiểu `ObligationKind` của sổ chưa liệt kê
  if (b.kind === "postpone") {
    if (b.payload.to <= ob.due_date) throw new LedgerFail("postpone_date");
    return daysBetween(ob.due_date, b.payload.to);
  }
  const moneyKind = kind !== "delivery" && kind !== "penalty" && ob.amount !== null;
  if (b.kind === "split" && !(moneyKind && b.payload.amount < (ob.amount ?? 0)))
    throw new ExecFail("invalid");
  if (b.kind === "waive_penalty" && kind !== "penalty") throw new ExecFail("invalid");
  return null;
}

/** Tạm khoá / mở khoá vào HĐ (0 hàng ⇒ trạng thái đã đổi giữa lúc lập yêu cầu và lúc áp). */
async function applyHoldKind(a: ApplyIn, kind: "hold" | "release"): Promise<null> {
  const { exec } = a.repos;
  if (kind === "release") {
    if ((await exec.applyRelease(a.contractId, a.by, a.evidenceId)) === 0)
      throw new ExecFail("not_held");
    return null;
  }
  // Áp muộn (sau duyệt): HĐ có thể đã hết hiệu lực / bị thay thế từ lúc lập yêu cầu ⇒ kiểm lại như lúc lập.
  const c = await exec.lockContract(a.contractId);
  if (!c) throw new ExecFail("invalid");
  holdStateCheck("hold", c);
  const reason = typeof a.payload.reason === "string" ? a.payload.reason : null;
  if ((await exec.applyHold(a.contractId, a.by, reason, a.evidenceId)) === 0)
    throw new ExecFail("hold_exists");
  return null;
}

export function execCommands(d: ExecDeps) {
  /** Người gọi là trưởng phòng của người phụ trách? Chỉ tra khi chưa đủ quyền bằng cách khác (tiết kiệm một kết nối). */
  const actorOf = async (who: ExecWho, c: ExecContract, withHead: boolean) => {
    const owner = c.owner ?? c.created_by;
    const head =
      withHead && !who.admin && who.userId !== owner
        ? await d.headOf(who.tenantId, owner, who.userId)
        : false;
    return { userId: who.userId, owner: c.owner, createdBy: c.created_by, head, admin: who.admin };
  };

  /** Lập yêu cầu: có quy trình ⇒ pending (+ sự kiện), không ⇒ ghi `applied` rồi áp ngay. */
  const submit = async (
    who: ExecWho,
    r: ExecRepos,
    w: {
      c: ExecContract;
      obligationId: string | null;
      kind: ExecKind;
      payload: Record<string, unknown>;
      facts: ChangeFacts;
      evidence: ExecEvidence;
    },
  ): Promise<{ out: ExecRequestOut; applied: unknown }> => {
    const id = d.newId();
    const flow = await d.hasFlow({
      tenantId: who.tenantId,
      facts: w.facts as Record<string, string | number | boolean>,
    });
    let evidenceId: string | null;
    try {
      evidenceId = await r.exec.insert({
        id,
        contractId: w.c.id,
        obligationId: w.obligationId,
        kind: w.kind,
        payload: w.payload,
        by: who.userId,
        evidence: w.evidence,
        status: flow ? "pending" : "applied",
        facts: w.facts,
      });
    } catch (e) {
      throw isUnique(e) ? new ExecFail("pending_exists") : e;
    }
    if (flow) return { out: { state: "pending", request_id: id }, applied: null };
    const applied = await applyKind({
      repos: r,
      contractId: w.c.id,
      obligationId: w.obligationId,
      kind: w.kind,
      payload: w.payload,
      by: who.userId,
      evidenceId,
      today: await d.today(who.tenantId),
    });
    return { out: { state: "applied", request_id: id }, applied };
  };

  /** Tạm khoá / mở khoá (`kind` = `hold` | `release`). */
  const holdOrRelease =
    (kind: "hold" | "release") => (who: ExecWho, contractId: string, b: HoldRequest) =>
      d.uow.tenant(who, async (r) => {
        const c = await r.exec.lockContract(contractId);
        if (!c) throw new ExecFail("not_found");
        if (!mayHold(await actorOf(who, c, true))) throw new ExecFail("hold_forbidden");
        const evidence = evidenceOf(b.evidence);
        holdStateCheck(kind, c);
        const { out } = await submit(who, r, {
          c,
          obligationId: null,
          kind,
          payload: b.reason ? { reason: b.reason } : {},
          facts: factsOf(kind, {}),
          evidence,
        });
        return out;
      });

  /** Khoá HĐ → mốc; vai; bằng chứng; mốc còn mở và không có yêu cầu chờ. */
  const loadChange = async (
    who: ExecWho,
    r: ExecRepos,
    obligationId: string,
    ev: HoldRequest["evidence"],
  ) => {
    const c = await r.exec.lockContractOf(obligationId);
    if (!c) throw new ExecFail("not_found");
    if (!mayChange(await actorOf(who, c, false))) throw new ExecFail("change_forbidden");
    const evidence = evidenceOf(ev);
    const ob = await r.ledger.lockObligation(obligationId);
    if (!ob) throw new ExecFail("not_found");
    if (ob.status !== "open") throw new LedgerFail("done");
    if (ob.pending) throw new ExecFail("pending_exists");
    return { c, ob, evidence };
  };

  /** `POST /obligations/:id/change-requests` (+ PATCH/postpone mốc cũ): dời hạn / tách mốc / miễn phạt. */
  const requestChange = (who: ExecWho, obligationId: string, b: ChangeRequest) =>
    d.uow.tenant(who, async (r) => {
      const { c, ob, evidence } = await loadChange(who, r, obligationId, b.evidence);
      const days = changeDays(b, ob);
      const waive = b.kind === "waive_penalty" ? ob.amount : null;
      const { out, applied } = await submit(who, r, {
        c,
        obligationId,
        kind: b.kind,
        // `days`/`waive` chốt lúc lập yêu cầu: bộ đọc dữ kiện của quy trình đọc lại từ đây (dữ kiện HIỆN TẠI của yêu cầu).
        payload: {
          ...b.payload,
          ...(days === null ? {} : { days }),
          ...(waive === null ? {} : { waive }),
        },
        facts: factsOf(b.kind, { days, waive }),
        evidence,
      });
      return { ...out, obligation: applied };
    });

  /** Mốc thuộc HĐ DONE? (PATCH mốc: DONE ⇒ chỉ qua yêu cầu thay đổi). `null` ⇒ không có mốc. */
  const contractStateOf = (who: PackWho, obligationId: string) =>
    d.uow.tenant(who, async (r) => {
      const c = await r.exec.lockContractOf(obligationId);
      return c ? { done: c.status === "done" } : null;
    });

  return {
    hold: holdOrRelease("hold"),
    release: holdOrRelease("release"),
    requestChange,
    contractStateOf,
  };
}
export type ExecCommands = ReturnType<typeof execCommands>;

/** Vai tạm khoá/mở khoá của người gọi trên một HĐ (cho `can.hold/release` của chi tiết): MỘT lần tra khi người gọi không phải người phụ trách. */
export async function holdRoleOk(
  d: Pick<ExecDeps, "headOf"> & { isAdmin(who: PackWho): Promise<boolean> },
  who: PackWho,
  c: { owner: string | null; created_by: string },
): Promise<boolean> {
  const owner = c.owner ?? c.created_by;
  if (who.userId === owner) return true;
  if (await d.isAdmin(who)) return true;
  return d.headOf(who.tenantId, owner, who.userId);
}
