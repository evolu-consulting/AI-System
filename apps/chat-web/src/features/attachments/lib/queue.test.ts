import { describe, expect, it } from "bun:test";
import { ApiError } from "~/lib/http";
import { type Chip, isBusy, markMissing, nextToStart, readyIds, uploadFailure } from "./queue";

const chip = (uid: number, status: Chip["status"], id?: string): Chip => ({
  uid,
  status,
  id,
  file: new File(["x"], `f${uid}.txt`),
});

describe("hàng đợi upload", () => {
  it("≤ 3 đồng thời, giữ thứ tự", () => {
    const five = [0, 1, 2, 3, 4].map((i) => chip(i, "queued"));
    expect(nextToStart(five)).toEqual([0, 1, 2]);
    const mixed = [
      chip(0, "uploading"),
      chip(1, "uploading"),
      chip(2, "queued"),
      chip(3, "queued"),
    ];
    expect(nextToStart(mixed)).toEqual([2]);
    expect(
      nextToStart([
        chip(0, "uploading"),
        chip(1, "uploading"),
        chip(2, "uploading"),
        chip(3, "queued"),
      ]),
    ).toEqual([]);
  });
  it("busy / readyIds / markMissing", () => {
    const cs = [chip(0, "ready", "a"), chip(1, "ready", "b"), chip(2, "uploading")];
    expect(isBusy(cs)).toBe(true);
    expect(readyIds(cs)).toEqual(["a", "b"]);
    const m = markMissing(cs, ["b"]);
    expect(m[1]?.status).toBe("error");
    expect(readyIds(m)).toEqual(["a"]);
  });
  it("ánh xạ lỗi upload", () => {
    expect(uploadFailure(new ApiError(413, "ATTACHMENT_TOO_LARGE", "x")).errorKey).toBe(
      "attach.err.tooLarge",
    );
    expect(uploadFailure(new ApiError(0, "NETWORK_ERROR", "x")).retryable).toBe(true);
  });
});
