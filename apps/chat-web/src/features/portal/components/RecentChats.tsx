// portal-home · thẻ Chat AI: 3 hội thoại gần nhất (lỗi/chưa có ⇒ ẩn, không chặn trang).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useRecentChats } from "../hooks/use-portal";

export function RecentChats() {
  const { t } = useTranslation();
  const q = useRecentChats();
  if (q.isError || !q.data) return null;
  return (
    <div data-testid="portal-recent" className="border-t border-border pt-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t("portal.recent.title")}</p>
      {q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("portal.recent.none")}</p>
      ) : (
        <ul className="flex flex-col">
          {q.data.map((c) => (
            <li key={c.id}>
              <Link
                to="/c/$id"
                params={{ id: c.id }}
                className="block truncate rounded px-1 py-1.5 text-sm hover:bg-muted"
              >
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
