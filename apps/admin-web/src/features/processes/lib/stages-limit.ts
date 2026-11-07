// CR-122 · p22 · số bước tối đa HIỆU LỰC của một quy trình = cài đặt nền tảng (mặc định 22, trần 50). Hub trả qua
// `GET /process-editor/limits`; `useStagesMax` (hooks/use-stages-max) nạp vào đây để các phép thuần (`step-ops`, `validateDraft`)
// dùng chung một giá trị. Chưa tải xong ⇒ mặc định; Hub vẫn là nơi chặn thật (422).
import { PROCESS_STAGES_DEFAULT, resolveStagesMax } from "@ai/contracts/hub-admin";

let current: number = PROCESS_STAGES_DEFAULT;

export const getStagesMax = (): number => current;
export const setStagesMax = (n: unknown): void => {
  current = resolveStagesMax(n);
};
