// CR-129 · ảnh bài đăng cần Bearer ⇒ tải qua `api.fileObjectUrl`, chỉ khi `enabled` (lazy), thu hồi object URL khi gỡ/đổi ảnh.
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";

type State = { url: string | null; failed: boolean };

export function useImageUrl(fileId: string, enabled: boolean): State {
  const { api } = useApp();
  const [state, setState] = useState<State>({ url: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let made: string | null = null;
    setState({ url: null, failed: false });
    api
      .fileObjectUrl(fileId)
      .then((u) => {
        made = u;
        if (alive) setState({ url: u, failed: false });
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setState({ url: null, failed: true }));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [api, fileId, enabled]);
  return state;
}
