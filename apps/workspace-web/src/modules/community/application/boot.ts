// Khởi động dùng chung của module: API + gói dịch Community. MỘT lần cho cả trang Community (entry) và ngăn "Bảng tin" trong Cài đặt.
import { initLang } from "../i18n";
import { createApi } from "./runtime";

export const ready = Promise.all([createApi(), initLang()]);
