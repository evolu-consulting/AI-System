// COM-FR-43/44 · MỘT điểm đi sang Sổ Hợp Tác (contracts-web). Hiện: điều hướng thẳng tới `contractsUrl + path` (cùng tab).
// TODO(cr110-sso): lát cr110-sso đổi thân hàm này sang hand-off (`POST /auth/sso/code` + `handOffUrl`, rơi về đăng nhập khi lỗi);
// nơi gọi (Sidebar, thẻ SHT ở Cài đặt) không đổi.
import { contractsHref } from "./nav";

export function openContracts(path: string, contractsUrl: string): void {
  location.assign(contractsHref(contractsUrl, path));
}
