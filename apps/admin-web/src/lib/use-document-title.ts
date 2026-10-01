// ADM-FR-01 · `document.title = "<H1> · Admin"` (plan-frontend §1).
import { useEffect } from "react";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Admin`;
  }, [title]);
}
