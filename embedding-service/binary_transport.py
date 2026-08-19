from __future__ import annotations

from array import array
import math
import sys
from typing import Sequence


def encode_float32_matrix(vectors: Sequence[Sequence[float]], *, dimension: int) -> bytes:
    if dimension < 1:
        raise ValueError("dimension must be positive")
    if not vectors:
        raise ValueError("vectors must be non-empty")
    if any(len(vector) != dimension for vector in vectors):
        raise ValueError(f"expected vectors with dimension {dimension}")
    if any(not math.isfinite(float(value)) for vector in vectors for value in vector):
        raise ValueError("vectors must contain only finite values")

    flat = array("f", (float(value) for vector in vectors for value in vector))
    if flat.itemsize != 4:
        raise RuntimeError("platform float array is not 32-bit")
    if sys.byteorder != "little":
        flat.byteswap()
    return flat.tobytes()
