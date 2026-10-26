// U3 · tab "Ghi chú & sổ việc": ghi chú về đối tác + sổ việc đã ghi (HD7 `PartnerLog`, gồm cờ đỏ). Điểm không còn ô sao/chấm tay (R41).
import type { PartnerRole } from "@ai/contracts";
import { PartnerLog } from "~/features/ledger/components/PartnerLog";
import { NotesPanel } from "./NotesPanel";

export function ReviewTab({ party, roles }: { party: string; roles: readonly PartnerRole[] }) {
  const role = roles[0];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {role && (
        <section className="rounded-xl border border-rule bg-panel p-5">
          <PartnerLog party={party} role={role} />
        </section>
      )}
      <NotesPanel party={party} />
    </div>
  );
}
