// CR-125 · m1 · module `community`. Sự kiện còn ở `COMMUNITY_MANIFEST.events` (ghép bằng `withEvents`).
import type { FeatureModule } from "../types";
import { SHOW_POST_NODE } from "./show-post/node";

export const COMMUNITY_MODULE: FeatureModule = {
  app: "community",
  events: [],
  nodes: [SHOW_POST_NODE],
};
