from __future__ import annotations

import os

from runtime_config import RuntimeConfig


def resolve_model_load_target(model_name: str, model_path: str | None = None) -> str:
    canonical = str(model_name or "").strip()
    if not canonical:
        raise ValueError("EMBEDDING_MODEL must not be empty")
    local = str(model_path or "").strip()
    return local or canonical


def _param_dtype_name(dtype, torch_module):
    for name, kind in (
        ("float32", torch_module.float32),
        ("float16", torch_module.float16),
        ("bfloat16", torch_module.bfloat16),
    ):
        if dtype is kind:
            return name
    return None


def detect_loaded_model_dtype(model, *, torch_module) -> str:
    names = set()
    for param in model.parameters():
        name = _param_dtype_name(param.dtype, torch_module)
        if name:
            names.add(name)
    if not names:
        raise RuntimeError("embedding model has no supported floating parameters")
    if len(names) > 1:
        raise RuntimeError(f"embedding model has mixed floating parameter dtypes: {', '.join(sorted(names))}")
    return next(iter(names))


def assert_loaded_model_dtype(model, expected_dtype: str, *, torch_module) -> str:
    actual = detect_loaded_model_dtype(model, torch_module=torch_module)
    if actual != expected_dtype:
        raise RuntimeError(
            f"loaded model dtype mismatch: requested={expected_dtype} actual={actual}"
        )
    return actual


def assert_model_on_cpu(model) -> None:
    for parameter in model.parameters():
        device_type = getattr(getattr(parameter, "device", None), "type", None)
        if device_type != "cpu":
            raise RuntimeError(
                f"CPU-only invariant failed: observed parameter device={device_type!r}"
            )


def disable_model_cache(model) -> None:
    config = getattr(model, "config", None)
    if config is not None and hasattr(config, "use_cache"):
        config.use_cache = False


def _torch_dtype(dtype: str, torch_module):
    mapping = {
        "float16": torch_module.float16,
        "float32": torch_module.float32,
        "bfloat16": torch_module.bfloat16,
    }
    try:
        return mapping[dtype]
    except KeyError as exc:
        raise ValueError(f"unsupported runtime dtype: {dtype}") from exc


def build_transformers_model_kwargs(
    runtime: RuntimeConfig,
    *,
    torch_module,
    offline: bool | None = None,
) -> dict[str, object]:
    kwargs: dict[str, object] = {
        "torch_dtype": _torch_dtype(runtime.dtype, torch_module),
        "low_cpu_mem_usage": True,
        "trust_remote_code": False,
    }
    if offline is None:
        offline = bool(os.getenv("TRANSFORMERS_OFFLINE") or os.getenv("HF_HUB_OFFLINE"))
    if offline:
        kwargs["local_files_only"] = True
    return kwargs


def build_transformers_tokenizer_kwargs(*, profile_name: str | None = None) -> dict[str, object]:
    kwargs: dict[str, object] = {
        "trust_remote_code": False,
    }
    if profile_name == "qwen3":
        kwargs["padding_side"] = "left"
    return kwargs
