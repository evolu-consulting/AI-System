// CR-097 K3b: banner "đã thay thế" + khối phiên bản + so sánh trên màn chi tiết (khối chỉ hiện khi chuỗi có ≥ 2 phiên bản).
import type { ContractVersionRef } from "@ai/contracts";
import { SupersededBanner } from "./SupersededBanner";
import { VersionDiff } from "./VersionDiff";
import { VersionsBlock } from "./VersionsBlock";

export function VersionsPanels({
  id,
  versions: raw,
  sup,
}: {
  id: string;
  /** Thiếu (Hub cũ / DTO một phần) ⇒ coi như một bản duy nhất. */
  versions: readonly ContractVersionRef[] | undefined;
  sup: { byNo: number | null; currentId: string | null } | null;
}) {
  const versions = raw ?? [];
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
