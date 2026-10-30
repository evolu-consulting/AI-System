// CR-104 · registry check ops-watch: đủ 8 check v1 (O1: db_redis; O2: 7 check còn lại). Check vắng khỏi registry ⇒ không chạy.
import type { OpsCheck } from "../../application/ops.check";
import { backupCheck } from "./backup.check";
import { dbRedisCheck } from "./db-redis.check";
import { diskCheck } from "./disk.check";
import { providerCheck } from "./provider.check";
import { publicHostsCheck } from "./public-hosts.check";
import { runsFailedCheck } from "./runs-failed.check";
import { stuckCheck } from "./stuck.check";
import { tlsCheck } from "./tls.check";

export const OPS_CHECKS: readonly OpsCheck[] = [
  providerCheck,
  runsFailedCheck,
  dbRedisCheck,
  publicHostsCheck,
  tlsCheck,
  backupCheck,
  diskCheck,
  stuckCheck,
];
