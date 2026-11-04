// COM-FR-43/44 · MỘT điểm đi sang Sổ Hợp Tác (contracts-web), cùng tab. Bấm ⇒ xin mã SSO một lần cho app `contracts`
// (`POST /auth/sso/code`, URL đích lấy từ catalog) ⇒ `<contracts>/sso#code=…&next=<path>` (mã trong fragment). Lỗi (401/403/mạng)
// ⇒ rơi về `contractsUrl + path` (contracts-web tự hiện đăng nhập). Nơi gọi (Sidebar, thẻ SHT ở Cài đặt) không đổi.
import { ssoLandingUrl } from "@ai/web-kit/auth/sso";
import { contractsHref } from "../domain/nav";

export type ContractsLinkDeps = {
  /** `caps.contracts` của người xem; `false` ⇒ không làm gì (đối tác không bao giờ có link này). */
  allowed?: boolean;
  grant?: () => Promise<{ code: string; target_url: string }>;
  assign?: (url: string) => void;
};

const defaultGrant = async () =>
  (await import("../adapters/session")).session.ssoGrant("contracts");

export async function openContracts(
  path: string,
  contractsUrl: string,
  d: ContractsLinkDeps = {},
): Promise<void> {
  if (d.allowed === false) return;
  const assign = d.assign ?? ((u: string) => location.assign(u));
  let url = contractsHref(contractsUrl, path);
  try {
    const g = await (d.grant ?? defaultGrant)();
    url = ssoLandingUrl(g.target_url, g.code, path);
  } catch {
    // giữ URL thẳng: contracts-web hiện form đăng nhập
  }
  assign(url);
}
