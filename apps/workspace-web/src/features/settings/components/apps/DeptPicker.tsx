// CR-118 §11.2 · chọn nhiều phòng ban cho một luật (điều kiện gồm cả phòng ban con). Hộp xổ native `<details>` + checkbox.
import { useTranslation } from "react-i18next";

export type Dept = { id: string; name: string };

export function DeptPicker({
  testId,
  value,
  departments,
  disabled,
  onToggle,
}: {
  testId: string;
  value: readonly string[];
  departments: readonly Dept[];
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const names = value.map((id) => departments.find((d) => d.id === id)?.name ?? "?");
  return (
    <details className="relative min-w-0" data-testid={testId}>
      <summary
        className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-field bg-panel px-3 py-1.5 text-body"
        aria-label={t("contracts.settings.apps.rule.pickDepartments")}
      >
        <span className={`truncate ${names.length === 0 ? "text-dim" : ""}`}>
          {names.length === 0
            ? t("contracts.settings.apps.rule.pickDepartments")
            : names.join(", ")}
        </span>
      </summary>
      <ul className="absolute z-10 mt-1 max-h-56 w-full min-w-56 overflow-y-auto rounded-lg border border-rule bg-panel p-1 shadow-lg">
        {departments.length === 0 && (
          <li className="px-2 py-1.5 text-caption text-dim">
            {t("contracts.settings.apps.rule.noDepartments")}
          </li>
        )}
        {departments.map((d) => (
          <li key={d.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-sunk">
              <input
                type="checkbox"
                data-testid={`${testId}-${d.id}`}
                checked={value.includes(d.id)}
                disabled={disabled}
                onChange={() => onToggle(d.id)}
              />
              <span className="truncate text-body">{d.name}</span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
