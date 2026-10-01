// ADM-FR-30, ADM-FR-33 · hành động trên một feature ở danh sách: ghép đổi trạng thái (use-feature-status) và xoá (use-feature-delete).
import { useFeatureDelete } from "./use-feature-delete";
import { useFeatureFail, useFeatureName } from "./use-feature-fail";
import { useFeatureStatus } from "./use-feature-status";

export function useFeatureActions() {
  const fail = useFeatureFail();
  const nameOf = useFeatureName();
  const status = useFeatureStatus(fail, nameOf);
  const del = useFeatureDelete(fail, nameOf);
  const dialogs = (
    <>
      {status.dialog}
      {del.dialogs}
    </>
  );
  return { setStatus: status.setStatus, remove: del.remove, dialogs };
}
