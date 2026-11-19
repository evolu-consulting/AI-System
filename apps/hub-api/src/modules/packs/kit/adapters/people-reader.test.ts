// CR-191 soát #3/#6 · thoát ký tự đặc biệt của LIKE/ILIKE (\, %, _) trước khi ghép `%q%`.
import { describe, expect, it } from "bun:test";
import { escapeLike as goodsEscape } from "../../community/adapters/goods-suggest.service";
import { escapeLike } from "./people-reader";

describe("CR-191 escapeLike", () => {
  it("thoát ký tự đặc biệt của LIKE (gạch chéo ngược, phần trăm, gạch dưới)", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("bình thường")).toBe("bình thường");
  });

  it("gợi ý hàng hoá dùng cùng luật thoát", () => {
    expect(goodsEscape("50%_x\\")).toBe(escapeLike("50%_x\\"));
    expect(goodsEscape("%")).toBe("\\%");
  });
});
