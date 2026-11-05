// CR-121 C-7 · registry mục hàng việc của menu dùng chung trong process (gói đăng ký lúc mount, `GET /pack/nav` đọc).
import { createPackNavRegistry } from "../application/pack-nav.ports";

export const packNavRegistry = createPackNavRegistry();
