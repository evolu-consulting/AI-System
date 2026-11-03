// CR-112 · ADM-FR-76 · trang con nhúng trong tab workspace công ty: tiêu đề hạ xuống h2 (workspace giữ h1 là tên công ty).
import { createContext, useContext } from "react";

const EmbeddedContext = createContext(false);

export const EmbeddedProvider = EmbeddedContext.Provider;
export const useEmbedded = (): boolean => useContext(EmbeddedContext);
