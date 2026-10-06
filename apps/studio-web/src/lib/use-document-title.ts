// HUB-FR-72 · `document.title = "<H1> · Agent Studio"`.
import { useEffect } from "react";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Agent Studio`;
  }, [title]);
}
