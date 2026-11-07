// CR-125 · m1 · module `contracts`. Sự kiện còn ở `CONTRACTS_MANIFEST.events` (ghép bằng `withEvents`).
import type { FeatureModule } from "../types";
import { ESIGN_NODE } from "./esign/node";

export const CONTRACTS_MODULE: FeatureModule = {
  app: "contracts",
  events: [],
  nodes: [ESIGN_NODE],
};
