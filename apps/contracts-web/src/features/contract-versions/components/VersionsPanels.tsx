// CR-097 K3b: banner "đã thay thế" + khối phiên bản + so sánh trên màn chi tiết (khối chỉ hiện khi chuỗi có ≥ 2 phiên bản).
import type { ContractVersionRef } from "@ai/contracts";
import { SupersededBanner } from "./SupersededBanner";
import { VersionDiff } from "./VersionDiff";
import { VersionsBlock } from "./VersionsBlock";

export function VersionsPanels({
  id,
  versions,
  sup,
}: {
  id: string;
  versions: readonly ContractVersionRef[];
  sup: { byNo: number | null; currentId: string | null } | null;
}) {
  return (
    <>
      {sup && <SupersededBanner byNo={sup.byNo} currentId={sup.currentId} />}
      {versions.length >= 2 && (
        <>
          <VersionsBlock currentId={id} versions={versions} />
          <VersionDiff contractId={id} versions={versions} />
        </>
      )}
    </>
  );
}
