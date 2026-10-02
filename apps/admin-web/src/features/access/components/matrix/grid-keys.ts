// ADM-FR-35 · bàn phím cho lưới ma trận: mũi tên/Home/End di chuyển giữa các ô; ô ngoài cửa sổ → cuộn tới rồi focus.
import { GRID } from "../../lib/grid-window";

const CELL = 'button[role="checkbox"][data-r]';
const find = (root: HTMLElement, r: number, c: number) =>
  root.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);

function focusCell(root: HTMLElement, r: number, c: number, tries = 6): void {
  const el = find(root, r, c);
  if (el) {
    el.focus();
    return;
  }
  if (tries === 6) root.scrollTo({ left: c * GRID.colW, top: r * GRID.rowH });
  if (tries > 0) setTimeout(() => focusCell(root, r, c, tries - 1), 40);
}

/** Trả `true` nếu phím đã được xử lý (chặn cuộn mặc định). */
export function onGridKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  rows: number,
  cols: number,
): boolean {
  const target = (e.target as HTMLElement).closest<HTMLElement>(CELL);
  if (!target || rows === 0 || cols === 0) return false;
  const r = Number(target.dataset.r);
  const c = Number(target.dataset.c);
  const next: Record<string, [number, number]> = {
    ArrowRight: [r, Math.min(cols - 1, c + 1)],
    ArrowLeft: [r, Math.max(0, c - 1)],
    ArrowDown: [Math.min(rows - 1, r + 1), c],
    ArrowUp: [Math.max(0, r - 1), c],
    Home: [r, 0],
    End: [r, cols - 1],
  };
  const to = next[e.key];
  if (!to) return false;
  e.preventDefault();
  focusCell(e.currentTarget, to[0], to[1]);
  return true;
}
