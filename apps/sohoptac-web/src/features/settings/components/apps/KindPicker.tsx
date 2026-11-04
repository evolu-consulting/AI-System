// cr118-route-kind · chọn nhiều loại hợp đồng (Mua/Bán/Giới thiệu) cho một luật; rỗng = mọi loại. Hộp xổ native `<details>`.
import { ROUTING_KINDS, type RoutingKind } from "@ai/web-kit/routing-rules";
import { useTranslation } from "react-i18next";

export function KindPicker({
  testId,
  value,
  disabled,
  onToggle,
}: {
  testId: string;
  value: readonly RoutingKind[];
  disabled: boolean;
  onToggle: (k: RoutingKind) => void;
}) {
  const { t } = useTranslation();
  const r = (k: string) => t(`contracts.settings.apps.rule.${k}`);
  return (
    <details className="relative min-w-0" data-testid={testId}>
      <summary
        className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-field bg-panel px-3 py-1.5 text-body"
        aria-label={r("pickKinds")}
      >
        <span className={`truncate ${value.length === 0 ? "text-dim" : ""}`}>
          {value.length === 0 ? r("anyKind") : value.map((k) => r(`kind.${k}`)).join(", ")}
        </span>
      </summary>
      <ul className="absolute z-10 mt-1 w-full min-w-40 rounded-lg border border-rule bg-panel p-1 shadow-lg">
        {ROUTING_KINDS.map((k) => (
          <li key={k}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunk">
              <input
                type="checkbox"
                data-testid={`${testId}-${k}`}
                checked={value.includes(k)}
                disabled={disabled}
                onChange={() => onToggle(k)}
              />
              <span className="text-body">{r(`kind.${k}`)}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
