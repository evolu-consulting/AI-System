// portal-home · thẻ app: biểu tượng, tên, mô tả, 1–2 con số (nếu có), mở app (chuyển phiên SSO; Chat AI cùng origin mở thẳng).
import type { MeApp } from "@ai/contracts";
import { appDescription, appLabel, entryNext, entryUrl } from "@ai/web-kit/app-catalog/apps";
import type { TileNumber } from "@ai/web-kit/app-catalog/portal";
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { Icon } from "@ai/web-kit/ui/AppSwitcher";
import { Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { session } from "~/lib/auth/session";

type Props = { app: MeApp; numbers: TileNumber[]; children?: ReactNode };

async function open(app: MeApp, e: MouseEvent<HTMLAnchorElement>): Promise<void> {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || !app.sso) return;
  e.preventDefault();
  const url = await handOffUrl({
    authed: true,
    grant: () => session.ssoGrant(app.key),
    fallbackBase: app.url,
    next: entryNext(app),
  }).catch(() => null);
  window.location.assign(url ?? entryUrl(app));
}

export function AppTile({ app, numbers, children }: Props) {
  const { t, i18n } = useTranslation();
  const desc = appDescription(app, i18n.language);
  const title = (
    <span className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground">
        <Icon name={app.icon} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-semibold">
          {appLabel(app, i18n.language)}
        </span>
        {desc && <span className="block text-sm text-muted-foreground">{desc}</span>}
      </span>
    </span>
  );
  return (
    <article
      data-testid={`portal-tile-${app.key}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground"
    >
      {app.key === "chat" ? (
        <Link
          to="/c/new"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
        </Link>
      ) : (
        <a
          href={entryUrl(app)}
          onClick={(e) => void open(app, e)}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
        </a>
      )}
      {numbers.length > 0 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {numbers.map((n) => (
            <li key={n.key} className="text-sm" data-testid={`portal-num-${app.key}-${n.key}`}>
              <b className="text-lg tabular-nums">{n.value}</b>{" "}
              <span className="text-muted-foreground">{t(`portal.num.${n.key}`)}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </article>
  );
}
