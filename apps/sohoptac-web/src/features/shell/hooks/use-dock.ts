// PK-FR-10 · TF5 · trạng thái khoang phải: trợ lý mở/đóng (nhớ `assistant:open`), góp ý (một lần), độ rộng kéo (nhớ `assistant:width`),
// sheet ở điện thoại. Màn rộng (≥ 1024 px) gắn bên phải; hẹp mở sheet 85 dvh.
import { useCallback, useEffect, useState } from "react";
import {
  ASSISTANT_OPEN_KEY,
  ASSISTANT_WIDTH_KEY,
  clampWidth,
  useStoredBool,
  useStoredWidth,
} from "../lib/stored";

export type DockMode = "assistant" | "feedback";
/** Sự kiện mở góp ý: nút trên header và route `/feedback` cùng bắn. */
export const FEEDBACK_OPEN = "contracts:feedback-open";

const isWide = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches;

export function useDock() {
  const [assistant, setAssistant] = useStoredBool(ASSISTANT_OPEN_KEY, false);
  const [feedback, setFeedback] = useState(false);
  const [sheet, setSheet] = useState<DockMode | null>(null);
  const [width, setWidth] = useStoredWidth(ASSISTANT_WIDTH_KEY);
  const [dragging, setDragging] = useState(false);

  const openAssistant = () => {
    if (isWide()) {
      setFeedback(false);
      setAssistant(true);
    } else setSheet("assistant");
  };
  const openFeedback = useCallback(() => {
    if (isWide()) setFeedback(true);
    else setSheet("feedback");
  }, []);

  useEffect(() => {
    window.addEventListener(FEEDBACK_OPEN, openFeedback);
    return () => window.removeEventListener(FEEDBACK_OPEN, openFeedback);
  }, [openFeedback]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: MouseEvent) => setWidth(clampWidth(window.innerWidth - ev.clientX));
    const up = () => {
      setDragging(false);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return {
    mode: (feedback ? "feedback" : "assistant") as DockMode,
    open: assistant || feedback,
    width,
    dragging,
    sheet,
    openAssistant,
    openFeedback,
    closeDock: () => (feedback ? setFeedback(false) : setAssistant(false)),
    closeSheet: () => setSheet(null),
    startResize,
  };
}
