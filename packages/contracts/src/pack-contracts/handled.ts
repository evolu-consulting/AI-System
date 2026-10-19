// HD4-FR-06 · HD4 plan §3: `POST /pack/contracts/contracts/:id/handled` — ghi kết quả xử lý HĐ đã duyệt (mgmt-app
// `routes/contracts.py:448-461`). Lỗi: outcome/khoá lạ 400 VALIDATION_ERROR (D4-10) · chưa duyệt/phụ lục 409 `CONTRACT_NOT_CONFIRMED` · id lạ 404.
import { z } from "zod";
import { IsoDateTime, VersionSchema } from "../common";
import { ContractStatusSchema, HandledOutcomeSchema } from "./fields";

export const HandledRequestSchema = z.strictObject({ outcome: HandledOutcomeSchema });
export type HandledRequest = z.infer<typeof HandledRequestSchema>;

export const ContractHandledRecordSchema = z.strictObject({
  outcome: HandledOutcomeSchema,
  by: z.uuid(),
  at: IsoDateTime,
});

export const HandledResponseSchema = z.strictObject({
  id: z.uuid(),
  status: ContractStatusSchema,
  handled: ContractHandledRecordSchema,
  action_deadline: z.iso.date().nullable(),
  version: VersionSchema,
});
export type HandledResponse = z.infer<typeof HandledResponseSchema>;
