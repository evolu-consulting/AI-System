// Fixture cố ý vi phạm T-DEP-6: web import packages/db và code api.

import { db } from "../../../../packages/db/src/index";
import { util } from "../../../x-api/src/lib/util";

export const p = () => [db, util()];
