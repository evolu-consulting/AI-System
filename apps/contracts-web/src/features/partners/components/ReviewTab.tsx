// V2-I · DT-04/05 · tab "Đánh giá & ghi chú": đánh giá sao từng tiêu chí (theo vai) + lịch sử đánh giá + ghi chú về đối tác.
import type { RepRole } from "@ai/contracts";
import { NotesPanel } from "./NotesPanel";
import { RatingsPanel } from "./RatingsPanel";
import { RoleSeg } from "./RoleSeg";

export function ReviewTab({
  party,
  role,
  roles,
}: {
  party: string;
  role: RepRole | null;
  roles: readonly RepRole[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        {role && (
          <div className="flex justify-end">
            <RoleSeg party={party} roles={roles} role={role} tab="review" />
          </div>
        )}
        {role && <RatingsPanel party={party} role={role} />}
      </div>
      <NotesPanel party={party} />
    </div>
  );
}
