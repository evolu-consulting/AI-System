// CR-105 · B2: ngữ cảnh "Canvas của quy trình thư viện" — có ⇒ panel stage dùng form bước theo MÃ phòng ban thay form giai đoạn chung.
import { createContext, useContext } from "react";
import type { GroupOption } from "./flow-step-props";

export type LibraryCanvasCtx = { groups: readonly GroupOption[] };
export const LibraryCanvasContext = createContext<LibraryCanvasCtx | null>(null);
export const useLibraryCanvas = (): LibraryCanvasCtx | null => useContext(LibraryCanvasContext);
