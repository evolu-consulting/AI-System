import { describe, expect, test } from "bun:test";
import { eventOf } from "./flow-def";
import { joinRecordWords, recordWords, recordWordsOf } from "./record-words";

describe("CR-125 c6 · B4 · tên bản ghi theo sự kiện (record.label của manifest)", () => {
  test("hợp đồng ⇒ 'hợp đồng' / 'Hợp đồng'; community ⇒ 'bài đăng' / 'Bài đăng'; đơn tham gia ⇒ 'đơn tham gia'", () => {
    expect(recordWordsOf(eventOf("contracts", "contract.submitted"), "vi")).toEqual({
      record: "hợp đồng",
      Record: "Hợp đồng",
    });
    expect(recordWordsOf(eventOf("community", "post.created"), "vi")).toEqual({
      record: "bài đăng",
      Record: "Bài đăng",
    });
    expect(recordWordsOf(eventOf("community", "partner.join_requested"), "vi").record).toBe(
      "đơn tham gia",
    );
    expect(recordWordsOf(eventOf("community", "post.created"), "en").record).toBe("post");
  });
  test("không có sự kiện/bản ghi (flow cũ theo khe) ⇒ giữ chữ hợp đồng", () => {
    expect(recordWordsOf(undefined, "vi").record).toBe("hợp đồng");
    expect(recordWords(undefined, "en").record).toBe("contract");
  });
  test("công ty có flow của nhiều app ⇒ nối không trùng: 'hợp đồng và bài đăng'", () => {
    const c = eventOf("contracts", "contract.submitted")?.record?.label;
    const p = eventOf("community", "post.created")?.record?.label;
    expect(joinRecordWords([c, p, c], "vi")).toEqual({
      record: "hợp đồng và bài đăng",
      Record: "Hợp đồng và bài đăng",
    });
    expect(joinRecordWords([], "vi").record).toBe("hợp đồng");
    expect(joinRecordWords([p], "vi").Record).toBe("Bài đăng");
  });
});
