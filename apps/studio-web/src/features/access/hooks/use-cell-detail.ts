// HUB-FR-78 · chi tiết một ô (drawer chỉ đọc): ngày cấp, người cấp, grant trong tenant.
import { useQuery } from "@tanstack/react-query";
import { cellDetailQuery } from "../api";
import type { Ref } from "../lib/matrix";

export const useCellDetail = (ref: Ref) => useQuery(cellDetailQuery(ref));
