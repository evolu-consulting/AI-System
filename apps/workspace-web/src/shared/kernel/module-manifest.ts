// CR-118 · hợp đồng duy nhất giữa một module nghiệp vụ và shell (intake PHẦN A §1 "Manifest module"): thuần, không React.
// Shell chỉ đọc `modules/<m>/manifest.ts` (luật depcruise web-shell-manifest-only) rồi lọc bằng FeatureGate (platform/features).

/** Gói + hành động tối thiểu để module hiện ra (FeatureGate đọc, server vẫn fail-closed). */
export type PackRequirement = { pack: string; action: "read" | "write" | "owner" };

export type ModuleManifest<TNavItem = unknown> = {
  key: string;
  /** Đường dẫn trang chủ của module (chuỗi — module không import module khác). */
  home: string;
  requires: PackRequirement;
  nav: readonly TNavItem[];
};
