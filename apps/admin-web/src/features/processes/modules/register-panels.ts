// CR-125 · m6a · MOD-FR-08: đăng ký panel riêng của các node (một dòng mỗi node có panel riêng).
import { SUBPROCESS_NODE } from "../lib/subprocess-form";
import { EsignPanel } from "./contracts/esign/Panel";
import { SubprocessPanel } from "./core/subprocess/Panel";
import { panelRegistry } from "./panel-registry";

panelRegistry.register("contracts.esign", EsignPanel);
// CR-125 · cr125-subprocess-ui · node "Quy trình con"
panelRegistry.register(SUBPROCESS_NODE, SubprocessPanel);
