// CR-122 · A1 · FLOW2-FR-12/15: sổ đăng ký `FactsReader` + `OutcomeHandler` dùng chung trong process. Gói đăng ký lúc mount; engine
// (`processes/adapters/runs/flow-ports.ts`) tra theo `(pack, event)`. Nằm ở kit vì gói contracts cấm import `modules/processes`
// (dependency-cruiser `contracts-no-process-engine`) — cùng khuôn `slotRegistry`. Đăng ký lại cùng (gói, sự kiện) ⇒ thay.
import type { FactsReader, OutcomeHandler } from "../application/flow-events.ports";

const readers = new Map<string, FactsReader>();
const handlers = new Map<string, OutcomeHandler<never>>();
const keyOf = (pack: string, event: string) => `${pack}\u0000${event}`;

export const flowPortRegistry = {
  registerFactsReader(r: FactsReader): void {
    for (const e of r.events) readers.set(keyOf(r.packKey, e), r);
  },
  registerOutcomeHandler<TX>(h: OutcomeHandler<TX>): void {
    for (const e of h.events) handlers.set(keyOf(h.packKey, e), h as OutcomeHandler<never>);
  },
  factsReaderFor: (pack: string, event: string): FactsReader | undefined =>
    readers.get(keyOf(pack, event)),
  outcomeHandlerFor: <TX>(pack: string, event: string): OutcomeHandler<TX> | undefined =>
    handlers.get(keyOf(pack, event)) as OutcomeHandler<TX> | undefined,
  /** Chỉ cho test. */
  clearPack(pack: string): void {
    for (const m of [readers, handlers] as Map<string, unknown>[])
      for (const k of [...m.keys()]) if (k.startsWith(`${pack}\u0000`)) m.delete(k);
  },
};
