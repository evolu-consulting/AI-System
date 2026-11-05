// REP-v3-ui · engine V2-E · DT-04/05 · tab "Đánh giá & ghi chú": đánh giá sao từng tiêu chí (theo vai) + lịch sử đánh giá + ghi chú về đối tác.
import type { RepRole } from "@ai/contracts";
import type { Range } from "../lib/partner-v2";
import { NotesPanel } from "./NotesPanel";
import { RatingsPanel } from "./RatingsPanel";
import { RoleSeg } from "./RoleSeg";

export function ReviewTabV2E({
  party,
  role,
  roles,
  range,
}: {
  party: string;
  role: RepRole | null;
  roles: readonly RepRole[];
  range: Range;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        {role && (
          <div className="flex justify-end">
            <RoleSeg party={party} roles={roles} role={role} tab="review" range={range} />
          </div>
        )}
        {role && <RatingsPanel party={party} role={role} />}
      </div>
      <NotesPanel party={party} />
    </div>
  );
}
