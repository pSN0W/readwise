"""VectorIndex managing FAISS flat inner-product cosine index for cards."""

import re
from pathlib import Path

import faiss
import numpy as np


def card_id_to_int(cid: str) -> int:
    m = re.search(r"\d+", cid)
    if not m:
        raise ValueError(f"Cannot extract integer ID from card {cid}")
    return int(m.group(0))


def int_to_card_id(num: int) -> str:
    return f"c_{num:04d}"


class VectorIndex:
    """FAISS index mapping card IDs to normalized vectors for exact cosine search."""

    def __init__(self, dim: int = 64):
        self.dim = dim
        self.raw_index = faiss.IndexFlatIP(dim)
        self.index = faiss.IndexIDMap2(self.raw_index)

    def upsert(self, card_id: str, vector: np.ndarray) -> None:
        """Insert or replace card embedding vector."""
        cid_int = card_id_to_int(card_id)
        # Remove existing if present
        id_arr = np.array([cid_int], dtype=np.int64)
        self.index.remove_ids(id_arr)

        v = np.asarray(vector, dtype=np.float32)
        if v.ndim == 1:
            v = v.reshape(1, -1)
        norm = np.linalg.norm(v, axis=1, keepdims=True) + 1e-12
        v = v / norm

        self.index.add_with_ids(v, id_arr)

    def delete(self, card_id: str) -> None:
        """Remove card embedding vector."""
        cid_int = card_id_to_int(card_id)
        id_arr = np.array([cid_int], dtype=np.int64)
        self.index.remove_ids(id_arr)

    def search(self, vector: np.ndarray, top_k: int) -> list[tuple[str, float]]:
        """Find top_k nearest cards by cosine similarity."""
        if self.index.ntotal == 0:
            return []

        v = np.asarray(vector, dtype=np.float32)
        if v.ndim == 1:
            v = v.reshape(1, -1)
        norm = np.linalg.norm(v, axis=1, keepdims=True) + 1e-12
        v = v / norm

        k = min(top_k, self.index.ntotal)
        sims, ids = self.index.search(v, k)

        results: list[tuple[str, float]] = []
        for sim, cid_num in zip(sims[0], ids[0]):
            if cid_num != -1:
                results.append((int_to_card_id(int(cid_num)), float(sim)))
        return results

    def save(self, path: Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self.index, str(path))

    @classmethod
    def load(cls, path: Path, dim: int = 64) -> "VectorIndex":
        obj = cls(dim=dim)
        path = Path(path)
        if path.exists():
            obj.index = faiss.read_index(str(path))
            obj.dim = obj.index.d
        return obj
