// HUB-FR-10, HUB-FR-76 · H2a-R02, R03 · menu `/` và lệnh user dùng được, tra từ cache catalog (plan §4, §8: 0 query
// khi cache nóng). Kiểm quyền mỗi lần gọi trên ảnh catalog hiện hành (R03).
import type { CommandMenuResponse } from "@ai/contracts/chat";
import type { AuthUser } from "../../lib/auth.middleware";
import type { CatalogSnapshot, UsableCatalogCommand } from "../config/catalog.rules";
import { usableCatalogCommands } from "../config/catalog.rules";
import type { ConfigCache } from "../config/config.service";
import { toMenuItem } from "./menu.rules";

export type CommandCatalog = Pick<ConfigCache, "catalog" | "tenant" | "user">;

/** Ảnh catalog + lệnh user dùng được, chụp một lần cho một request (HUB-BR-06). */
export type UsableView = { catalog: CatalogSnapshot; usable: UsableCatalogCommand[] };

export class CommandService {
  constructor(protected readonly config: CommandCatalog) {}

  async usable(u: AuthUser): Promise<UsableView> {
    const [catalog, tenant, user] = await Promise.all([
      this.config.catalog(),
      this.config.tenant(u.tenantId),
      this.config.user(u.userId),
    ]);
    return { catalog, usable: user ? usableCatalogCommands(catalog, tenant, user) : [] };
  }

  /** GET `/commands` · sắp `name` (thứ tự của `usableCatalogCommands`). */
  async menu(u: AuthUser): Promise<CommandMenuResponse> {
    const { usable } = await this.usable(u);
    return { items: usable.map((x) => toMenuItem(x.command, x.workflow)) };
  }
}
