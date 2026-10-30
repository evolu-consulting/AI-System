// CR-104 · registry check ops-watch. O1 chỉ có `db_redis` (để pipeline test được); O2 thêm 7 check còn lại vào danh sách này.
// Check vắng khỏi registry ⇒ không chạy (thẻ hiện "chưa kiểm").
import type { OpsCheck } from "../../application/ops.check";
import { dbRedisCheck } from "./db-redis.check";

export const OPS_CHECKS: readonly OpsCheck[] = [dbRedisCheck];
