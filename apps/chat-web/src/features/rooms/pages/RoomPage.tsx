// HUB-FR-96 · `/rooms/$id`: chỉ lấy id từ route rồi giao cho RoomView. `?flow=` được nhận nhưng bỏ qua ở X2a (plan-frontend §2).
import { getRouteApi } from "@tanstack/react-router";
import { RoomView } from "../components/RoomView";

const route = getRouteApi("/_authed/rooms/$id");

export function RoomPage() {
  const { id } = route.useParams();
  // key theo id: đổi phòng → trạng thái cuộn/bám đáy/nháp làm lại từ đầu.
  return <RoomView key={id} roomId={id} />;
}
