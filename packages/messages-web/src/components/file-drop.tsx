// CR-178 · M2 · kéo tệp vào khung chat: lớp phủ «Thả tệp để gửi kèm», thả ⇒ đưa vào ô soạn (`sink`). Ô khoá (sink null) ⇒ không nhận.
import { type DragEvent, type MutableRefObject, useRef, useState } from "react";
import { dragHasFiles, droppedFiles } from "../lib/composer";

export function useFileDrop(sink: MutableRefObject<((files: File[]) => void) | null>) {
  const [active, setActive] = useState(false);
  const depth = useRef(0); // dragenter/leave bắn cả với phần tử con
  const ok = (e: DragEvent) => sink.current !== null && dragHasFiles(e.dataTransfer);
  const reset = () => {
    depth.current = 0;
    setActive(false);
  };
  return {
    active,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!ok(e)) return;
        e.preventDefault();
        depth.current += 1;
        setActive(true);
      },
      onDragOver: (e: DragEvent) => {
        if (ok(e)) e.preventDefault();
      },
      onDragLeave: (e: DragEvent) => {
        if (!ok(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      },
      onDrop: (e: DragEvent) => {
        if (!ok(e)) return;
        e.preventDefault();
        const files = droppedFiles(e.dataTransfer);
        reset();
        if (files.length > 0) sink.current?.(files);
      },
    },
  };
}

export function DropOverlay({ label }: { label: string }) {
  return (
    <div
      data-testid="chat-drop-overlay"
      className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-panel/85 p-4"
    >
      <p className="m-0 rounded-2xl border-2 border-dashed border-act-line px-6 py-8 text-center text-sm font-medium text-act">
        {label}
      </p>
    </div>
  );
}
