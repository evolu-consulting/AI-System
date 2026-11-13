// CR-125 · m1 · module `contracts`. Sự kiện còn ở `CONTRACTS_MANIFEST.events` (ghép bằng `withEvents`).
import type { FeatureModule } from "../types";
import { CREATE_FROM_STEP_NODE } from "./create-from-step/node";
import { ESIGN_NODE } from "./esign/node";
import { MILESTONE_CONFIRM_NODE } from "./milestone-confirm/node";
import { PARTNER_SEND_NODE } from "./partner-send/node";
import { RECORD_PAYMENT_NODE } from "./record-payment/node";
import { SIGN_TOGETHER_ACCEPT_NODE } from "./sign-together-accept/node";

export const CONTRACTS_MODULE: FeatureModule = {
  app: "contracts",
  events: [],
  nodes: [
    CREATE_FROM_STEP_NODE,
    ESIGN_NODE,
    PARTNER_SEND_NODE,
    MILESTONE_CONFIRM_NODE,
    RECORD_PAYMENT_NODE,
    SIGN_TOGETHER_ACCEPT_NODE,
  ],
};
