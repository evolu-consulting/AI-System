// Fixture cố ý vi phạm T-DEP-6: contracts import db và apps.
import { util } from "../../../apps/x-api/src/lib/util";
import { db } from "../../db/src/index";

export const a = () => [db, util()];
