// CR-105 · B2: ngữ cảnh "Canvas của quy trình thư viện" — có ⇒ panel stage dùng form bước theo MÃ phòng ban thay form giai đoạn chung.
import type { DlcStepTemplate } from "@ai/contracts/hub-admin";
import { createContext, useContext } from "react";
import type { GroupOption } from "./flow-step-props";

/** dlc-step-library · `dlcSteps` = bước DLC mẫu của thư viện (khe `dlc.*`; khe khác ⇒ rỗng) cho nút "Thêm bước DLC". */
export type LibraryCanvasCtx = {
  groups: readonly GroupOption[];
  dlcSteps?: readonly DlcStepTemplate[];
};
export const LibraryCanvasContext = createContext<LibraryCanvasCtx | null>(null);
export const useLibraryCanvas = (): LibraryCanvasCtx | null => useContext(LibraryCanvasContext);
