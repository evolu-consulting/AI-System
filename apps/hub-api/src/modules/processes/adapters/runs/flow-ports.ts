// CR-122 · E2 · FLOW2-FR-12/15/21 · flow-model.md mục C–D: cổng app cho engine — `FactsReader` (node Nếu đọc dữ kiện HIỆN TẠI) +
// `OutcomeHandler` (node Kết thúc, gọi TRONG tx settle). Gói đăng ký lúc mount; sổ nằm ở kit (`flowPortRegistry`, A1: gói contracts
// không import được `processes`), tra theo `(pack, event)`. Một gói/sự kiện chỉ một reader + một handler (đăng ký lại ⇒ thay).
import type { Tx } from "@ai/db";
import { type FactsReader, flowPortRegistry, type OutcomeHandler } from "../../../packs/kit/public";

export const registerFactsReader = (r: FactsReader): void =>
  flowPortRegistry.registerFactsReader(r);

export const registerOutcomeHandler = (h: OutcomeHandler<Tx>): void =>
  flowPortRegistry.registerOutcomeHandler(h);

export const factsReaderFor = (pack: string, event: string): FactsReader | undefined =>
  flowPortRegistry.factsReaderFor(pack, event);

export const outcomeHandlerFor = (pack: string, event: string): OutcomeHandler<Tx> | undefined =>
  flowPortRegistry.outcomeHandlerFor<Tx>(pack, event);

/** Chỉ cho test: gỡ đăng ký của một gói. */
export const unregisterFlowPorts = (pack: string): void => flowPortRegistry.clearPack(pack);
