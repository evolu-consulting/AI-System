"""WRK-FR-05 · WRK-FR-24 · AC-W10 · review H1 v2 N2 — pipe stdout của job host do cha tự tạo.

Cha giữ đầu đọc (transport riêng) nên: biết inode → tìm mọi process còn giữ đầu ghi (cháu `setsid`
mồ côi về Runtime, không còn trong cây `ppid`/group của job host) để giết; bỏ đọc → đóng transport
(không rò fd). `proc.wait()` của asyncio không còn chờ stdout (chỉ chờ thoát + stdin).
"""

from __future__ import annotations

import asyncio
import contextlib
import os


class StdoutPipe:
    """`os.pipe()`: đầu ghi truyền cho job host (`stdout=write_fd`), đầu đọc `attach()` vào loop."""

    def __init__(self) -> None:
        self.read_fd, self.write_fd = os.pipe()  # O_CLOEXEC: job host chỉ nhận đầu ghi (fd 1)
        self.inode = os.fstat(self.read_fd).st_ino
        self.transport: asyncio.BaseTransport | None = None

    def close_write(self) -> None:
        """Sau spawn: cha bỏ đầu ghi (EOF chỉ còn phụ thuộc job host + cháu)."""
        if self.write_fd >= 0:
            os.close(self.write_fd)
            self.write_fd = -1

    async def attach(self, limit: int) -> asyncio.StreamReader:
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader(limit=limit, loop=loop)
        pipe = os.fdopen(self.read_fd, "rb", buffering=0)
        self.read_fd = -1  # `pipe` sở hữu fd, transport đóng nó
        self.transport, _ = await loop.connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(reader, loop=loop), pipe
        )
        return reader

    def close(self) -> None:
        """Đóng mọi fd còn giữ (idempotent)."""
        self.close_write()
        if self.transport is not None:
            self.transport.close()
            self.transport = None
        if self.read_fd >= 0:
            with contextlib.suppress(OSError):
                os.close(self.read_fd)
            self.read_fd = -1
