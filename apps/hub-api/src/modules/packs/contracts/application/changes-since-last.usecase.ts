// CR-127 K5 · BR-36a · spec §4 `GET /contracts/:id/changes-since-last`: "Đã đổi so với lần trước" của thẻ duyệt. Lớp 2 — không SQL.
// Lần gửi mới nhất vs lần ngay trước (hồ sơ `contract_submissions`, K3): trường pháp lý đổi + điều khoản đổi / được nhắc trong ý kiến Trả lại.
// MỘT tx, MỘT câu (repo). HĐ không thấy (RLS) / tenant khác ⇒ null (404).
import type { PackUow, PackWho } from "../../kit/public";
import { canReadEvidence } from "../domain/approval-record.rules";
import { type ClauseChangeRequested, changesSinceLast } from "../domain/clause-diff.rules";
import { CONTRACT_FIELD_KEYS } from "../domain/fields.rules";
import { diffFields } from "../domain/versions.rules";
import { asFieldMap } from "./version-diff.usecase";

export type SubmissionSnap = {
  round: number;
  fields: unknown;
  /** Văn bản hiệu lực của lần gửi (hồ sơ chỉ lưu khi khác lần trước ⇒ repo đã lấy lần gần nhất có văn bản). */
  source_text: string | null;
  return_note: string | null;
};
/** Ai đọc được ý kiến Trả lại (BR-26): người gửi, người phụ trách HĐ, người đã quyết ở một bước (+ quản trị công ty do route truyền). */
export type NoteAudience = { submittedBy: string | null; owner: string | null; deciders: string[] };
export type ChangesRepo = {
  /** `null` = không thấy HĐ; `snaps` rỗng = chưa có hồ sơ lần gửi; ≤ 2 hàng, mới nhất trước. */
  lastTwo(id: string): Promise<{ snaps: SubmissionSnap[]; audience: NoteAudience } | null>;
};

export type ChangesSinceLastOut = {
  round: number;
  previous_round: number | null;
  fields: { key: string; before: unknown; after: unknown }[];
  clauses: ClauseChangeRequested[];
  return_note: string | null;
};

const empty = (round: number): ChangesSinceLastOut => ({
  round,
  previous_round: null,
  fields: [],
  clauses: [],
  return_note: null,
});

export const changesSinceLastOf =
  (d: { uow: PackUow<{ changes: ChangesRepo }> }) =>
  (who: PackWho, id: string, admin = false): Promise<ChangesSinceLastOut | null> =>
    d.uow.tenant(who, async (r) => {
      const got = await r.changes.lastTwo(id);
      if (got === null) return null;
      const [cur, prev] = got.snaps;
      if (!cur) return empty(0);
      if (!prev) return empty(cur.round);
      // BR-26: ý kiến lần Trả lại chỉ người trong quy trình / người gửi / người phụ trách / quản trị xem; người khác ⇒ null và cờ
      // `requested` cũng không tính (không lộ ý kiến gián tiếp). Dùng chung luật `canReadEvidence` với hồ sơ duyệt (E4).
      const note = canReadEvidence(
        { userId: who.userId, admin },
        {
          startedBy: got.audience.submittedBy ?? "",
          owner: got.audience.owner,
          involved: new Set(got.audience.deciders),
        },
      )
        ? cur.return_note
        : null;
      return {
        round: cur.round,
        previous_round: prev.round,
        fields: diffFields(
          asFieldMap(prev.fields),
          asFieldMap(cur.fields),
          CONTRACT_FIELD_KEYS,
        ).map((c) => ({ key: c.key, before: c.a, after: c.b })),
        clauses: changesSinceLast(prev.source_text, cur.source_text, note),
        return_note: note,
      };
    });
export type ChangesSinceLastUsecase = ReturnType<typeof changesSinceLastOf>;
