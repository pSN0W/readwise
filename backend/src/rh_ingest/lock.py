"""Cross-process file lock using fcntl.flock."""

import fcntl
import os
from pathlib import Path
from types import TracebackType


class LockError(Exception):
    """Raised when the rh lock file cannot be acquired because another process holds it."""


class FileLock:
    """Non-blocking file lock context manager."""

    def __init__(self, lock_path: Path):
        self.lock_path = Path(lock_path)
        self.fd: int | None = None

    def acquire(self) -> None:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.fd = os.open(str(self.lock_path), os.O_CREAT | os.O_RDWR, 0o644)
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.write(self.fd, f"{os.getpid()}\n".encode())
        except (BlockingIOError, OSError) as e:
            if self.fd is not None:
                os.close(self.fd)
                self.fd = None
            raise LockError(f"Another rh process holds the lock at {self.lock_path}") from e

    def release(self) -> None:
        if self.fd is not None:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_UN)
            except Exception:
                pass
            try:
                os.close(self.fd)
            except Exception:
                pass
            self.fd = None

    def __enter__(self) -> "FileLock":
        self.acquire()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.release()
