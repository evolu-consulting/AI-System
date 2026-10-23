// CR-097 K3b: nhãn "vN" cạnh HĐ có nhiều phiên bản (versions_count > 1).
import { showVersionBadge } from "../lib/versions";

export function VersionBadge({ no, count }: { no: number | undefined; count: number | undefined }) {
  if (!showVersionBadge(count)) return null;
  return (
    <span
      data-testid="version-badge"
      className="ml-2 rounded-full border border-rule px-2 py-0.5 text-xs font-semibold text-act"
    >
      v{no}
    </span>
  );
}
