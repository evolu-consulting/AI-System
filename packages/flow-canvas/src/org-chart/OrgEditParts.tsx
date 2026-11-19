// CR-189 · BR-189-6 · phần sửa trực tiếp của thẻ phòng (chỉ khi host truyền `edit`): đổi tên tại chỗ, «+» thêm phòng con gõ tên tại chỗ,
// kéo thả (máy tính) để chuyển phòng cha. Chart KHÔNG gọi API: mọi ghi đi qua callback của host (`OrgChartEdit`), host trả
// chuỗi lỗi nghiệp vụ (hoặc null). Hình thẻ giữ nguyên kích thước (ô nhập/«+» nằm đè, không đẩy bố cục ⇒ không nháy).
import { type MutableRefObject, type ReactNode, useEffect, useRef, useState } from "react";

export type OrgChartEditLabels = {
  /** Nhãn truy cập của «+» dưới thẻ phòng `name`. */
  addChild: (name: string) => string;
  /** Gợi ý khi rê vào tên phòng (bấm để đổi tên). */
  rename: string;
  renameInput: string;
  newName: string;
  newPlaceholder: string;
  ok: string;
  cancel: string;
  nameRequired: string;
  dragHint: string;
};

export type OrgChartEdit = {
  labels: OrgChartEditLabels;
  /** `parentId` null = trực thuộc công ty. Trả chuỗi lỗi (hiện dưới ô nhập) hoặc null khi xong. */
  onAdd: (parentId: string | null, name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  /** Thả thẻ `id` lên phòng `parentId` (null = công ty). Chỉ gọi khi `canMove` đúng. */
  onMove: (id: string, parentId: string | null) => void;
  /** Luật chặn ở UI: không vào chính nó, không vào con cháu, không vào phòng cha hiện tại. */
  canMove: (id: string, parentId: string | null) => boolean;
  /** Nút «⋯» + menu do host dựng (hộp thoại nằm ở host). */
  renderMenu: (id: string) => ReactNode;
  /** Điện thoại/cảm ứng: không kéo thả, chỉ «⋯». */
  touch: boolean;
};

export type DragRef = MutableRefObject<string | null>;

const field =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Tên phòng: bấm ⇒ ô nhập tại chỗ; Enter/rời ô = lưu, Esc = bỏ. */
export function RenameName({ id, name, edit }: { id: string; name: string; edit: OrgChartEdit }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const L = edit.labels;
  const finish = async (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = value.trim();
    if (!save || v === "" || v === name) return setEditing(false);
    const err = await edit.onRename(id, v);
    if (err) {
      setError(err);
      done.current = false;
      return;
    }
    setEditing(false);
  };
  if (!editing)
    return (
      <button
        type="button"
        data-testid={`org-rename-${id}`}
        title={L.rename}
        onClick={() => {
          done.current = false;
          setValue(name);
          setError(null);
          setEditing(true);
        }}
        className="nodrag line-clamp-1 w-full cursor-text rounded px-1 text-left text-sm font-semibold leading-tight hover:bg-accent"
      >
        {name}
      </button>
    );
  return (
    <div className="nodrag nopan w-full">
      <input
        // biome-ignore lint/a11y/noAutofocus: ô nhập tại chỗ vừa mở theo thao tác của người dùng
        autoFocus
        aria-label={L.renameInput}
        data-testid={`org-rename-input-${id}`}
        value={value}
        maxLength={64}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void finish(true);
          if (e.key === "Escape") void finish(false);
        }}
        onBlur={() => void finish(true)}
        className={field}
      />
      {error ? (
        <p role="alert" className="mt-0.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** «+» dưới thẻ ⇒ ô gõ tên phòng con (nằm đè phía dưới thẻ, không đổi cỡ thẻ). */
export function AddChild({
  id,
  parentId,
  name,
  edit,
}: {
  id: string;
  parentId: string | null;
  name: string;
  edit: OrgChartEdit;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const L = edit.labels;
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    setValue("");
    setError(null);
  };
  const submit = async () => {
    const v = value.trim();
    if (v === "") return setError(L.nameRequired);
    const err = await edit.onAdd(parentId, v);
    if (err) return setError(err);
    close();
  };
  return (
    <>
      <button
        type="button"
        data-testid={`org-add-${id}`}
        aria-label={L.addChild(name)}
        title={L.addChild(name)}
        onClick={() => setOpen(true)}
        className="nodrag nopan absolute -bottom-3 left-1/2 z-10 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-sm leading-none shadow-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        +
      </button>
      {open ? (
        <div
          data-testid={`org-add-form-${id}`}
          className="nodrag nopan absolute top-full left-1/2 z-20 mt-5 w-56 -translate-x-1/2 rounded-lg border bg-card p-2 shadow-md"
        >
          <label className="text-xs text-muted-foreground" htmlFor={`org-add-in-${id}`}>
            {L.newName}
          </label>
          <input
            id={`org-add-in-${id}`}
            ref={ref}
            data-testid={`org-add-input-${id}`}
            value={value}
            maxLength={64}
            placeholder={L.newPlaceholder}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") close();
            }}
            className={`${field} mt-1`}
          />
          {error ? (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md px-2 py-1 text-sm hover:bg-accent"
            >
              {L.cancel}
            </button>
            <button
              type="button"
              data-testid={`org-add-ok-${id}`}
              onClick={() => void submit()}
              className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground"
            >
              {L.ok}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Thuộc tính kéo thả của thẻ: `id` null = nút «Công ty» (chỉ nhận thả, không kéo được); phòng ⇒ vừa kéo được vừa nhận thả. */
export function dragProps(
  id: string | null,
  edit: OrgChartEdit,
  drag: DragRef,
  setOver: (v: "ok" | "no" | null) => void,
) {
  if (edit.touch) return {};
  const target = id;
  return {
    draggable: id !== null,
    onDragStart: (e: React.DragEvent) => {
      if (id === null) return;
      drag.current = id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragEnd: () => {
      drag.current = null;
      setOver(null);
    },
    onDragOver: (e: React.DragEvent) => {
      const from = drag.current;
      if (from === null) return;
      const ok = edit.canMove(from, target);
      setOver(ok ? "ok" : "no");
      if (ok) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      const from = drag.current;
      drag.current = null;
      setOver(null);
      if (from === null || !edit.canMove(from, target)) return;
      e.preventDefault();
      edit.onMove(from, target);
    },
  };
}
