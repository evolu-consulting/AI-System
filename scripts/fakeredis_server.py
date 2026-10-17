"""Redis giả lập (fakeredis TcpFakeServer) cho dev local không có Docker/admin: có Streams, pipeline, EXPIRE.
Chạy: .venv\\Scripts\\python.exe server.py [port]. Dữ liệu chỉ trong bộ nhớ, mất khi tắt."""
import sys

from fakeredis import TcpFakeServer
from fakeredis._commands import command
from fakeredis._socket import _fakesocket


@command((), (bytes,))
def info(self, *args: bytes) -> bytes:
    """ioredis gọi INFO để kiểm "ready"; fakeredis không có lệnh này."""
    return b"# Server\r\nredis_version:7.2.0\r\nredis_mode:standalone\r\n# Persistence\r\nloading:0\r\n"


_fakesocket.FakeSocket.info = info

port = int(sys.argv[1]) if len(sys.argv) > 1 else 6379
server = TcpFakeServer(("127.0.0.1", port), server_type="redis")
server.daemon_threads = True
print(f"fakeredis listening on 127.0.0.1:{port}", flush=True)
server.serve_forever()
