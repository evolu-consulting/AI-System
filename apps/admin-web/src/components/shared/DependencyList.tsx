// ADM-FR-10, ADM-FR-13, ADM-FR-50 · M2 · danh sách "đang được dùng bởi" theo nhóm (Command/Agent/Workflow).
// Dùng ở dialog chặn xoá/tắt, tab "Đang được dùng bởi", popover usages, cảnh báo SCHEMA_BREAKS_COMMANDS.
import { Link } from "@tanstack/react-router";
import { StatusBadge, type StatusTone } from "./StatusBadge";

export type DependencyItem = {
  id: string;
  label: string;
  /** Hiển thị font mono (key, tên command). */
  mono?: boolean;
  /** Đường dẫn nội bộ (vd `/commands/<id>`); không có thì chỉ là chữ (agent: Mơ hồ A6). */
  href?: string;
  badge?: { tone: StatusTone; text: string };
};
export type DependencySection = { title: string; items: DependencyItem[] };

/** "Agent …{6 ký tự cuối id}" (Admin chỉ biết `agent_id`, Mơ hồ A6). */
export function agentTail(id: string): string {
  return id.slice(-6);
}

export function DependencyList({ sections }: { sections: DependencySection[] }) {
  const filled = sections.filter((s) => s.items.length > 0);
  return (
    <div className="space-y-3">
      {filled.map((section) => (
        <section key={section.title} aria-label={section.title} className="space-y-1">
          <h3 className="text-caption font-semibold text-muted-foreground">{section.title}</h3>
          <ul className="space-y-1">
            {section.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-body">
                <ItemLabel item={item} />
                {item.badge ? (
                  <StatusBadge tone={item.badge.tone}>{item.badge.text}</StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ItemLabel({ item }: { item: DependencyItem }) {
  const cls = item.mono ? "font-mono" : undefined;
  if (!item.href) return <span className={cls}>{item.label}</span>;
  return (
    <Link to={item.href} className={`${cls ?? ""} text-primary underline-offset-4 hover:underline`}>
      {item.label}
    </Link>
  );
}
