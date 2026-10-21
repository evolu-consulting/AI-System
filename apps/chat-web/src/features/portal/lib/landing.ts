// portal-home · quyết định nơi hạ cánh của `/` (I/O mỏng quanh `landingFor` thuần); mọi lỗi ⇒ trang chủ.
import { type Landing, landingFor } from "@ai/web-kit/app-catalog/portal";
import { session } from "~/lib/auth/session";
import { fetchPortal } from "../api";

export async function decideLanding(home: boolean): Promise<Landing> {
  if (home) return { kind: "portal" };
  try {
    const info = await fetchPortal();
    const effective = info.default_app.effective;
    if (!effective || effective === "chat") return landingFor(effective, [], false);
    const apps = (await session.myApps()).items;
    return landingFor(effective, apps, false);
  } catch {
    return { kind: "portal" };
  }
}
