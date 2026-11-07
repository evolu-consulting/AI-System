// CR-125 · m6a · MOD-FR-08: đăng ký panel riêng của các node (một dòng mỗi node có panel riêng).
import { EsignPanel } from "./contracts/esign/Panel";
import { panelRegistry } from "./panel-registry";

panelRegistry.register("contracts.esign", EsignPanel);
