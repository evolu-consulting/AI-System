// COM-FR-28/29/43 · CR-120 · quyền nhóm Sổ Hợp Tác trong Cài đặt Community. Menu trái KHÔNG còn ở module (AppShell dựng từ manifest,
// `shell/nav.ts`); còn lại đây là điều kiện hiện mục "Sổ Hợp Tác" của hộp thoại Cài đặt (I1/I3, HT-75/76: thiếu quyền ⇒ không có trong DOM).
export type NavInput = {
  ownOrgId: string;
  caps: { contracts: boolean };
  contractsUrl: string | null;
};

export const hasContractsGroup = (v: Pick<NavInput, "caps" | "contractsUrl">): boolean =>
  v.caps.contracts && v.contractsUrl !== null;
