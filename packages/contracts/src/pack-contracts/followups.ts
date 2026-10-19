// W1 · hẹn nhắc chung (mgmt-app `routes/followups.py`, `ledger/followups.py`): "nhắc tôi lúc … về …" — của riêng người tạo, chỉ về thứ họ thấy.
// `GET/POST /pack/contracts/followups`, `POST /followups/:id/{done,snooze}` (cùng xử lý với `/my-work/followups/:id/*`).
import { z } from "zod";
import { CksLocalAtTime } from "./cks";
import { nfcText } from "./fields";

export const FOLLOWUP_KINDS = ["obligation", "contract", "company", "renewal"] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];
export const FOLLOWUP_LIST_MAX = 200;

export const FollowupCreateSchema = z.strictObject({
  subject_kind: z.enum(FOLLOWUP_KINDS),
  subject_id: z.string().min(1).max(300),
  at: CksLocalAtTime,
  note: nfcText(200)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type FollowupCreate = z.infer<typeof FollowupCreateSchema>;
export const FollowupsQuerySchema = z.strictObject({
  subject_id: z.string().min(1).max(300).optional(),
});

export type Followup = {
  id: string;
  subject_kind: FollowupKind;
  subject_id: string;
  contract_id: string | null;
  /** Giờ địa phương tenant `YYYY-MM-DDTHH:mm`. */
  at: string;
  title: string;
  note: string | null;
  status: "pending" | "sent";
};
