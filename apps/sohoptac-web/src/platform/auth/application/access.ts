// CR-118 · cr118-auth · quyền mở module của phiên hiện tại (guard route + home). Nguồn app = FeatureGate qua `setAppsSource`
// (lát cr118-feature-gate nối `/pack/me.apps`); chưa nối / lỗi ⇒ suy từ `me.kind` (đối tác chỉ Community). Fail-closed ở server.
import { type AccessCaps, capsOf } from "../domain/login-machine";
import type { AppsSource } from "../port";
import { session } from "../session";

let appsSource: AppsSource = async () => null;

/** TODO(cr118-feature-gate): `setAppsSource(async () => (await gate.ensure()).apps)`. */
export function setAppsSource(src: AppsSource): void {
  appsSource = src;
}

export async function currentCaps(): Promise<AccessCaps> {
  const apps = await appsSource().catch(() => null);
  return capsOf(session.getState().me, apps);
}
