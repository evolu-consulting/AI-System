// Fixture cố ý vi phạm T-DEP-5: component import api.ts của feature và lib/http.
import { http } from "../../../lib/http";
import { getF } from "../api";

export const Btn = () => [getF(), http()];
