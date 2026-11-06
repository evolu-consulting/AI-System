// CR-122 · E2 · FLOW2-FR-12/15/21 · flow-model.md mục C–D: sổ đăng ký cổng app cho engine — `FactsReader` (node Nếu đọc dữ kiện
// HIỆN TẠI) + `OutcomeHandler` (node Kết thúc, gọi TRONG tx settle). Gói đăng ký lúc mount (A1/A2), tra theo `(pack, event)`.
// Một gói/sự kiện chỉ một reader + một handler (đăng ký lại ⇒ thay, để mount chạy lại vô hại).
import type { Tx } from "@ai/db";
import type { FactsReader, OutcomeHandler } from "../../../packs/kit/public";

const readers = new Map<string, FactsReader>();
const handlers = new Map<string, OutcomeHandler<Tx>>();
const keyOf = (pack: string, event: string) => `${pack}\u0000${event}`;

export function registerFactsReader(r: FactsReader): void {
  for (const e of r.events) readers.set(keyOf(r.packKey, e), r);
}

export function registerOutcomeHandler(h: OutcomeHandler<Tx>): void {
  for (const e of h.events) handlers.set(keyOf(h.packKey, e), h);
}

export const factsReaderFor = (pack: string, event: string): FactsReader | undefined =>
  readers.get(keyOf(pack, event));

export const outcomeHandlerFor = (pack: string, event: string): OutcomeHandler<Tx> | undefined =>
  handlers.get(keyOf(pack, event));

/** Chỉ cho test: gỡ đăng ký của một gói. */
export function unregisterFlowPorts(pack: string): void {
  for (const m of [readers, handlers] as Map<string, unknown>[])
    for (const k of [...m.keys()]) if (k.startsWith(`${pack}\u0000`)) m.delete(k);
}
