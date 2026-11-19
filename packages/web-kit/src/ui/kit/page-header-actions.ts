// CR-191 · luật thuần của nút phụ ở `PageHeader`: nút «ghim» (`pinMobile`) luôn hiện trên điện thoại, còn lại vào menu «⋯».
export type SplitAction = { pinMobile?: boolean };

export function splitActions<A extends SplitAction>(
  actions: readonly A[],
): { pinned: A[]; menu: A[] } {
  return {
    pinned: actions.filter((a) => a.pinMobile === true),
    menu: actions.filter((a) => a.pinMobile !== true),
  };
}
