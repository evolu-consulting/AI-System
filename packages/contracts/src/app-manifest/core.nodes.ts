// CR-122 · FLOW2-FR-25 · node LÕI của nền tảng trên bảng node (mọi công ty đều có, không khoá tính năng): Gửi email, Thông báo
// chuông (executor `notify`), Hẹn giờ (`wait_until`), Chờ khoảng (`wait_for`). Chỉ là cấu hình đặt sẵn — không executor mới.
// CR-125 · m1 · khai báo nằm ở `modules/core` (MỘT nguồn: sổ `MODULES`); đây chỉ là bản đọc lại cho bảng node (node có stage mẫu).
import { MODULES } from "../modules/index.generated";
import { nodesOfApp } from "../modules/modules.rules";
import type { AppNodeDecl } from "./manifest";

export const CORE_NODES: readonly AppNodeDecl[] = nodesOfApp(MODULES, "core");
