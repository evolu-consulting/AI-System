// CR-112 · công ty của workspace đang mở (id + mã): các tab nhúng (Người dùng, Nhóm, Đối tác, Phân quyền, Agents) lấy tenant từ đây, không từ `?tenant=`.
import { createContext, useContext } from "react";

export type WorkspaceTenant = { id: string; key: string };

const WorkspaceContext = createContext<WorkspaceTenant | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;
export const useWorkspaceTenant = (): WorkspaceTenant | null => useContext(WorkspaceContext);
