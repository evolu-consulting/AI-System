// CR-108 · chú giải nhỏ dưới canvas: bước duyệt, bước hệ thống (khoá), nhánh bỏ qua, mờ = bị bỏ qua theo xem trước.
import { useTranslation } from "react-i18next";

function Item({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={swatch} />
      {label}
    </li>
  );
}

export function FlowLegend() {
  const { t } = useTranslation();
  const l = (k: string) => t(`contracts.flow.current.legend.${k}`);
  return (
    <ul
      className="-mt-2 mb-4 flex flex-wrap gap-x-5 gap-y-1 text-caption text-dim"
      aria-label={l("label")}
      data-testid="flow-legend"
    >
      <Item
        swatch="inline-block h-3 w-5 rounded border border-rule bg-panel shadow-sm"
        label={l("step")}
      />
      <Item
        swatch="inline-block h-3 w-5 rounded border border-dashed border-field bg-sunk"
        label={l("system")}
      />
      <Item swatch="inline-block w-5 border-t-2 border-dashed border-dim" label={l("skip")} />
      <Item
        swatch="inline-block h-3 w-5 rounded border border-dashed border-rule bg-panel opacity-40"
        label={l("dim")}
      />
    </ul>
  );
}
