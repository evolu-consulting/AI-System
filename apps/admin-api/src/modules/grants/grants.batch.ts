// ADM-FR-35, ADM-FR-32 · `PUT /admin/grants/batch` (spec M3 §3, M3-R08; plan §5.5, §6). Một transaction, sai một phần
// tử → không ghi gì. Khoá theo thứ tự tăng dần, KHÔNG theo thứ tự request: groups SHARE → features SHARE → entitlements
// SHARE → lock pass mọi cặp (thêm ∪ bớt) → xoá theo TOÀN BỘ `remove` → chèn `add ∖ existing` sắp `comparePairs` → config_meta.
// Không early-return sau lock pass (readiness M3 lần 2): số đếm lấy từ `returning`, đúng cả khi hàng vừa được tx khác
// commit trong lúc chờ khoá (READ COMMITTED).
import type { GrantBatchRequest, GrantBatchResponse, GrantKey } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { afterLock } from "../../lib/test-hooks";
import { mustTenant, writeTenant } from "../groups/groups.service";
import * as repo from "./grants.repo";
import { checkGrantFeatures, comparePairs, type PairKey, planBatch } from "./grants.rules";
import { type Call, fail } from "./grants.service";

const toPair = (k: GrantKey): PairKey => ({ featureId: k.feature_id, groupId: k.group_id });
const missing = (want: readonly string[], have: ReadonlySet<string>) =>
  [...new Set(want.filter((x) => !have.has(x)))].sort();

type Sets = { tenantId: string; add: PairKey[]; all: PairKey[] };

/** Khoá tham chiếu theo thứ tự tăng (groups → features → entitlements) rồi báo lỗi theo thứ tự spec. */
async function lockAndCheck(c: Call, tx: Tx, s: Sets): Promise<void> {
  const groups = await repo.shareGroups(
    tx,
    s.tenantId,
    s.all.map((p) => p.groupId),
  );
  const features = await repo.shareFeatures(
    tx,
    s.all.map((p) => p.featureId),
  );
  const entitled = await repo.shareEntitled(
    tx,
    s.tenantId,
    features.map((f) => f.id),
  );
  await afterLock(c.ctx.hooks, "grant.batch", "locked");
  const noFeature = missing(
    s.all.map((p) => p.featureId),
    new Set(features.map((f) => f.id)),
  );
  if (noFeature.length)
    throw appError("INVALID_REFERENCE", { field: "feature_ids", ids: noFeature });
  const noGroup = missing(
    s.all.map((p) => p.groupId),
    groups,
  );
  if (noGroup.length) throw appError("INVALID_REFERENCE", { field: "group_ids", ids: noGroup });
  const withEnt = features.map((f) => ({ ...f, entitled: entitled.has(f.id) }));
  fail(checkGrantFeatures(withEnt, new Set(s.add.map((p) => p.featureId))));
}

export function batchGrants(
  c: Call,
  queryTenantId: string | undefined,
  input: GrantBatchRequest,
): Promise<GrantBatchResponse> {
  const tenantId = writeTenant(c.actor, queryTenantId);
  const add = input.add.map(toPair).sort(comparePairs);
  const remove = input.remove.map(toPair).sort(comparePairs);
  const all = [...add, ...remove].sort(comparePairs);
  return configWrite(c, "grant.batch", async (tx, ch) => {
    await mustTenant(tx, tenantId);
    await lockAndCheck(c, tx, { tenantId, add, all });
    const existing = await repo.lockGroupGrants(tx, tenantId, all);
    const plan = planBatch(existing, add, remove);
    const removed = await repo.deleteGroupGrants(tx, tenantId, remove);
    // Hàng trong existing đã bị ta khoá nên không ai xoá được tới commit → chỉ cần chèn add ∖ existing.
    const added = await repo.insertGroupGrants(
      tx,
      { tenantId, actorId: c.actor.userId },
      plan.insert,
    );
    if (added + removed > 0) ch.changed({ entity: "grant", tenantId });
    await afterLock(c.ctx.hooks, "grant.batch", "rows");
    return { added, removed, unchanged: add.length + remove.length - added - removed };
  });
}
