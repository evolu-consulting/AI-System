// CR-120 · mock 3 luồng Community (dev/e2e giả lập, không backend): các luồng TẮT — danh sách rỗng, nav không bật màn nào.
import type { FlowsApi } from "../application/ports";

const off = (): never => {
  throw Object.assign(new Error("flows off"), { status: 404 }); // i18n-ignore: mock, không hiện cho người dùng
};

export const flowsMock = (): { flows: FlowsApi } => ({
  flows: {
    nav: async () => ({
      moderationQueue: false,
      moderationOn: false,
      joinSubmit: false,
      joinReview: false,
      reports: false,
    }),
    modQueue: async () => ({ items: [] }),
    myModeration: async () => ({ items: [] }),
    decideModeration: off,
    createJoin: off,
    listJoins: async () => [],
    decideJoin: off,
    listParties: async () => [],
    reportPost: off,
    listReports: async () => [],
    decideReport: off,
  },
});
