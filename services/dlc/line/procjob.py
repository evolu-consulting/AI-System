"""Every process an agent call starts ends with the call (Windows Job Object).

An agent may start a dev server, a watcher or a test runner that outlives its shell command; when the Claude CLI
exits those children stay behind with no parent (DLC finding 14: three orphaned node.exe after one builder call,
and the call itself held for 25 minutes). The engine puts the CLI process into a job object before the prompt is
written, so everything it starts belongs to the job, and closes the job when the call is over: Windows then ends
every process still in it (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).

    job = Job.attach(proc)    # None off Windows or when the process cannot be assigned
    ...
    job.close()               # kills what is left; returns how many processes were still running

Never raises: a call without a job behaves as before.
"""

from __future__ import annotations

import ctypes
import os
from typing import Any, Optional

_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9
_JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1
_KILL_ON_JOB_CLOSE = 0x2000
_PROCESS_SET_QUOTA = 0x0100
_PROCESS_TERMINATE = 0x0001


class _Basic(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32),
                ("SchedulingClass", ctypes.c_uint32)]


class _Io(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint64) for n in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                                               "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class _Extended(ctypes.Structure):
    _fields_ = [("BasicLimitInformation", _Basic), ("IoInfo", _Io), ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t)]


class _Accounting(ctypes.Structure):
    _fields_ = [("TotalUserTime", ctypes.c_int64), ("TotalKernelTime", ctypes.c_int64),
                ("ThisPeriodTotalUserTime", ctypes.c_int64), ("ThisPeriodTotalKernelTime", ctypes.c_int64),
                ("TotalPageFaultCount", ctypes.c_uint32), ("TotalProcesses", ctypes.c_uint32),
                ("ActiveProcesses", ctypes.c_uint32), ("TotalTerminatedProcesses", ctypes.c_uint32)]


class Job:
    def __init__(self, handle: Any):
        self._h = handle

    @classmethod
    def attach(cls, proc: Any) -> Optional["Job"]:
        if os.name != "nt" or not getattr(proc, "pid", None):
            return None
        try:
            k32 = ctypes.WinDLL("kernel32", use_last_error=True)
            k32.CreateJobObjectW.restype = ctypes.c_void_p
            k32.OpenProcess.restype = ctypes.c_void_p
            h = k32.CreateJobObjectW(None, None)
            if not h:
                return None
            info = _Extended()
            info.BasicLimitInformation.LimitFlags = _KILL_ON_JOB_CLOSE
            if not k32.SetInformationJobObject(ctypes.c_void_p(h), _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                                               ctypes.byref(info), ctypes.sizeof(info)):
                k32.CloseHandle(ctypes.c_void_p(h))
                return None
            ph = k32.OpenProcess(_PROCESS_SET_QUOTA | _PROCESS_TERMINATE, False, int(proc.pid))
            ok = bool(ph) and bool(k32.AssignProcessToJobObject(ctypes.c_void_p(h), ctypes.c_void_p(ph)))
            if ph:
                k32.CloseHandle(ctypes.c_void_p(ph))
            if not ok:
                k32.CloseHandle(ctypes.c_void_p(h))
                return None
            return cls(h)
        except (OSError, AttributeError, ValueError):
            return None

    def active(self) -> int:
        """Processes of the job still running (0 when unknown)."""
        if not self._h:
            return 0
        try:
            k32 = ctypes.WinDLL("kernel32", use_last_error=True)
            acc = _Accounting()
            if k32.QueryInformationJobObject(ctypes.c_void_p(self._h), _JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
                                             ctypes.byref(acc), ctypes.sizeof(acc), None):
                return int(acc.ActiveProcesses)
        except (OSError, AttributeError, ValueError):
            pass
        return 0

    def close(self) -> int:
        """End every process still in the job. Returns how many were running (the orphans of the call)."""
        if not self._h:
            return 0
        left = self.active()
        try:
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(ctypes.c_void_p(self._h))
        except (OSError, AttributeError, ValueError):
            pass
        self._h = None
        return left


__all__ = ["Job"]
