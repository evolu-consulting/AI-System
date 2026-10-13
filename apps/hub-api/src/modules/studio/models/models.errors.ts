// HUB-FR-66 · HUB-FR-67 · spec H4b2 §3 Mã lỗi · plan D12 · lỗi riêng Models (`STUDIO_MODEL_ERRORS`, không sửa
// `STUDIO_ERRORS` đã khoá — mẫu `secrets.errors.ts`). Message cố định tiếng Anh; client dịch theo `code`.
import { STUDIO_MODEL_ERRORS, type StudioModelErrorCode } from "@ai/contracts/studio";
import { AppError } from "../../../lib/errors";

const MESSAGES: Record<StudioModelErrorCode, string> = {
  PROVIDER_IN_USE: "Provider is used by model profiles",
  PROVIDER_HAS_HISTORY: "Provider has job history",
  PROVIDER_READONLY: "Provider is read-only",
  PROFILE_IN_USE: "Model profile is used by agents",
};

export function modelError(code: StudioModelErrorCode, details?: unknown): AppError {
  return new AppError(code, STUDIO_MODEL_ERRORS[code], MESSAGES[code], details);
}
