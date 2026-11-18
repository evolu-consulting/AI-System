// CR-184 · lượt ký ra ngoài (phiên ký): `behalf` chỉ gồm id + tên người vắng (không lộ Group); tên lấy MỘT câu, chỉ khi có người vắng.
import type { SignTurnOut } from "@ai/contracts/pack-contracts";
import type { SignTurn } from "../domain/sign-turn.port";

type Names = (
  who: { tenantId: string; userId: string },
  ids: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

export async function turnWithNames(
  userNames: Names | undefined,
  who: { tenantId: string; userId: string },
  turn: SignTurn,
): Promise<SignTurnOut> {
  const { behalf, ...rest } = turn;
  if (!behalf?.length) return rest;
  const names =
    (await userNames?.(
      who,
      behalf.map((b) => b.user_id),
    )) ?? new Map<string, string>();
  return {
    ...rest,
    behalf: behalf.map((b) => ({ user_id: b.user_id, name: names.get(b.user_id) ?? null })),
  };
}
