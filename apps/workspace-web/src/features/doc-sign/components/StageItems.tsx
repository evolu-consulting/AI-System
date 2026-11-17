// CR-181 · lớp phủ trên sân khấu: các ô/chữ ký, vạch tím hít khe, thanh nổi, menu chuột phải.
import { type Rect, rectFromParts } from "../lib/geometry";
import type { SignItem } from "../lib/sign-items";
import { type Seam, seamsOf } from "../lib/snap";
import { FieldBox } from "./FieldBox";
import { FloatBar } from "./FloatBar";
import { MarkBox } from "./MarkBox";
import type { StageLayout } from "./PageStage";
import { StageMenu } from "./StageMenu";
import type { SignTray } from "./types";

export function StageItems(p: {
  layout: StageLayout;
  items: SignItem[];
  mode: "prep" | "sign";
  sel: string | null;
  seam: Seam | null;
  menu: { x: number; y: number } | null;
  menuTrays: SignTray[];
  onSel: (id: string | null) => void;
  onSeam: (s: Seam | null) => void;
  onMove: (id: string, r: Rect) => void;
  onRemove: (id: string) => void;
  onCopyAll: (id: string) => void;
  onChangePerson: (it: SignItem) => void;
  onFieldClick: (id: string) => void;
  onPick: (t: SignTray) => void;
  onCloseMenu: () => void;
}) {
  const seams = seamsOf(p.layout.pages);
  const picked = p.items.find((i) => i.id === p.sel);
  const pr = picked && rectFromParts(picked.parts, p.layout.pages);
  return (
    <>
      {p.items.map((it) => {
        const rect = rectFromParts(it.parts, p.layout.pages);
        if (!rect) return null;
        const common = {
          rect,
          selected: p.sel === it.id,
          stage: p.layout,
          seams,
          onSelect: () => p.onSel(it.id),
          onDeselect: () => p.onSel(null),
          onSeam: p.onSeam,
          onCommit: (r: Rect) => p.onMove(it.id, r),
          onDelete: () => p.onRemove(it.id),
        };
        return it.kind === "mark" ? (
          <MarkBox key={it.id} item={it} {...common} />
        ) : (
          <FieldBox
            key={it.id}
            item={it}
            mode={p.mode}
            onFieldClick={() => p.onFieldClick(it.id)}
            {...common}
          />
        );
      })}
      {p.seam && (
        <div
          aria-hidden="true"
          data-testid="sign-seam"
          className="pointer-events-none absolute h-0.5 bg-violet-500"
          style={{ left: p.seam.l, top: p.seam.at, width: p.seam.w }}
        />
      )}
      {picked && pr && picked.status === "editable" && (
        <FloatBar
          mode={p.mode}
          x={pr.l}
          y={pr.t}
          canCopy={picked.kind === "mark"}
          onCopyAll={() => p.onCopyAll(picked.id)}
          onChangePerson={() => p.onChangePerson(picked)}
          onRemove={() => p.onRemove(picked.id)}
        />
      )}
      <StageMenu at={p.menu} trays={p.menuTrays} onPick={p.onPick} onClose={p.onCloseMenu} />
    </>
  );
}
