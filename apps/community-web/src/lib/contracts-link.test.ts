// COM-FR-44 · hand-off SSO community → Sổ Hợp Tác.
import { describe, expect, it } from "bun:test";
import { openContracts } from "./contracts-link";

describe("openContracts (COM-FR-44)", () => {
  it("có mã: đi tới <target_url>/sso#code=…&next=<path> (giữ ?sec=)", async () => {
    const urls: string[] = [];
    await openContracts("/contracts?sec=doc", "https://sht.example/", {
      grant: async () => ({ code: "c1", target_url: "https://sht.example" }),
      assign: (u) => urls.push(u),
    });
    expect(urls).toEqual(["https://sht.example/sso#code=c1&next=%2Fcontracts%3Fsec%3Ddoc"]);
  });

  it("lỗi xin mã (401/403/mạng): rơi về contractsUrl + path", async () => {
    const urls: string[] = [];
    await openContracts("/partners", "https://sht.example/", {
      grant: async () => {
        throw new Error("403");
      },
      assign: (u) => urls.push(u),
    });
    expect(urls).toEqual(["https://sht.example/partners"]);
  });

  it("caps.contracts=false: không xin mã, không điều hướng", async () => {
    let called = 0;
    await openContracts("/overview", "https://sht.example", {
      allowed: false,
      grant: async () => {
        called++;
        return { code: "x", target_url: "https://sht.example" };
      },
      assign: () => called++,
    });
    expect(called).toBe(0);
  });
});
