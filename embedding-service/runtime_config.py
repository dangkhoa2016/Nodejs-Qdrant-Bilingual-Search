from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RuntimeConfig:
    device: str
    accelerator: str
    dtype: str
    runtime: str


def resolve_runtime_config(
    *,
    device: str = "auto",
    dtype: str = "auto",
    cuda_available: bool,
) -> RuntimeConfig:
    requested_device = str(device or "auto").strip().lower()
    if requested_device == "auto":
        resolved_device = "cuda" if cuda_available else "cpu"
    elif requested_device in {"cuda", "cpu"}:
        resolved_device = requested_device
    else:
        raise ValueError("EMBEDDING_DEVICE must be one of auto, cuda or cpu")

    if resolved_device == "cuda" and not cuda_available:
        raise RuntimeError("CUDA was requested but is not available")

    requested_dtype = str(dtype or "auto").strip().lower()
    if requested_dtype == "auto":
        resolved_dtype = "float16" if resolved_device == "cuda" else "float32"
    elif requested_dtype in {"float16", "float32"}:
        resolved_dtype = requested_dtype
    else:
        raise ValueError("EMBEDDING_DTYPE must be one of auto, float16 or float32")

    if resolved_device == "cpu":
        accelerator = "cpu"
        runtime = "pytorch-cpu"
    else:
        accelerator = "gpu"
        runtime = "pytorch-cuda"
    return RuntimeConfig(
        device=resolved_device,
        accelerator=accelerator,
        dtype=resolved_dtype,
        runtime=runtime,
    )
