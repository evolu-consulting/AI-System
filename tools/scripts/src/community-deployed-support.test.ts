// com-prod-seed · đọc cred cho e2e deployed (thuần, không I/O mạng).
import { describe, expect, it } from "bun:test";
import { loadDeployedEnv, pwFromCredText } from "../../../e2e/community-web/deployed.support";

describe("deployed.support", () => {
  it("pwFromCredText: dòng 'user / pw'", () => {
    expect(pwFromCredText("demo-owner / abc123 (ghi chú)\nkhac / zzz", "demo-owner")).toBe(
      "abc123",
    );
    expect(pwFromCredText("khac / zzz", "demo-owner")).toBeNull();
  });
  it("loadDeployedEnv: thiếu cred ⇒ lỗi không chứa giá trị; đủ ⇒ đặt READONLY + writeback", () => {
    expect(() => loadDeployedEnv({} as NodeJS.ProcessEnv)).toThrow(/CS_CRED_FILE/);
    const env = {
      CS_CRED_FILE: "/x/p.json",
      CS_NEW_PW: "n",
      CS_OWNER_PW: "o",
    } as NodeJS.ProcessEnv;
    loadDeployedEnv(env);
    expect(env.CS_READONLY).toBe("1");
    expect(env.CS_CRED_WRITEBACK).toBe("/x/p.json");
    expect(env.COMMUNITY_URL).toBe("https://community.evoluconsulting.com");
  });
});
