import unittest

from model_loader import (
    assert_loaded_model_dtype,
    build_transformers_model_kwargs,
    build_transformers_tokenizer_kwargs,
    detect_loaded_model_dtype,
    resolve_model_load_target,
)
from runtime_config import RuntimeConfig


class FakeTorch:
    float16 = object()
    float32 = object()
    bfloat16 = object()


class FakeParam:
    def __init__(self, dtype):
        self.dtype = dtype


class FakeModel:
    def __init__(self, dtypes):
        self._params = [FakeParam(dtype) for dtype in dtypes]

    def parameters(self):
        return iter(self._params)


class ModelLoaderTest(unittest.TestCase):
    def test_float16_model_loader_kwargs_pin_torch_dtype(self):
        kwargs = build_transformers_model_kwargs(
            RuntimeConfig(device="cpu", accelerator="cpu", dtype="float16", runtime="pytorch-cpu"),
            torch_module=FakeTorch,
        )
        self.assertIs(kwargs["torch_dtype"], FakeTorch.float16)
        self.assertIs(kwargs["low_cpu_mem_usage"], True)

    def test_float32_model_loader_kwargs_pin_torch_dtype(self):
        kwargs = build_transformers_model_kwargs(
            RuntimeConfig(device="cpu", accelerator="cpu", dtype="float32", runtime="pytorch-cpu"),
            torch_module=FakeTorch,
        )
        self.assertIs(kwargs["torch_dtype"], FakeTorch.float32)

    def test_offline_model_loader_kwargs_set_local_files_only(self):
        kwargs = build_transformers_model_kwargs(
            RuntimeConfig(device="cpu", accelerator="cpu", dtype="float16", runtime="pytorch-cpu"),
            torch_module=FakeTorch,
            offline=True,
        )
        self.assertIs(kwargs["local_files_only"], True)

    def test_qwen_profile_uses_left_padding_recommended_by_model_card(self):
        kwargs = build_transformers_tokenizer_kwargs(profile_name="qwen3")
        self.assertEqual(kwargs["padding_side"], "left")

    def test_non_qwen_profile_does_not_force_left_padding(self):
        kwargs = build_transformers_tokenizer_kwargs(profile_name="e5")
        self.assertNotIn("padding_side", kwargs)

    def test_resolve_model_load_target_uses_explicit_path(self):
        self.assertEqual(
            resolve_model_load_target(
                model_name="Qwen/Qwen3-Embedding-4B",
                model_path="/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/transformers/default/1",
            ),
            "/kaggle/input/models/dangkhoa2016/qwen-qwen3-embedding-4b/transformers/default/1",
        )

    def test_resolve_model_load_target_falls_back_to_model_name(self):
        self.assertEqual(
            resolve_model_load_target(model_name="Qwen/Qwen3-Embedding-4B", model_path=None),
            "Qwen/Qwen3-Embedding-4B",
        )

    def test_resolve_model_load_target_blank_model_name_raises(self):
        with self.assertRaises(ValueError):
            resolve_model_load_target(model_name="", model_path="/kaggle/input/some/path")
        with self.assertRaises(ValueError):
            resolve_model_load_target(model_name=None, model_path="/kaggle/input/some/path")

    def test_detect_loaded_model_dtype_all_float32(self):
        model = FakeModel([FakeTorch.float32, FakeTorch.float32])
        self.assertEqual(detect_loaded_model_dtype(model, torch_module=FakeTorch), "float32")

    def test_detect_loaded_model_dtype_all_float16(self):
        model = FakeModel([FakeTorch.float16, FakeTorch.float16])
        self.assertEqual(detect_loaded_model_dtype(model, torch_module=FakeTorch), "float16")

    def test_detect_loaded_model_dtype_mixed_raises(self):
        model = FakeModel([FakeTorch.float32, FakeTorch.float16])
        with self.assertRaises(RuntimeError):
            detect_loaded_model_dtype(model, torch_module=FakeTorch)

    def test_detect_loaded_model_dtype_no_floating_raises(self):
        model = FakeModel([])
        with self.assertRaises(RuntimeError):
            detect_loaded_model_dtype(model, torch_module=FakeTorch)

    def test_detect_loaded_model_dtype_all_bfloat16_is_truthful(self):
        model = FakeModel([FakeTorch.bfloat16])
        self.assertEqual(detect_loaded_model_dtype(model, torch_module=FakeTorch), "bfloat16")

    def test_assert_loaded_model_dtype_float32_float32_passes(self):
        model = FakeModel([FakeTorch.float32])
        self.assertEqual(assert_loaded_model_dtype(model, "float32", torch_module=FakeTorch), "float32")

    def test_assert_loaded_model_dtype_float32_bfloat16_fails(self):
        model = FakeModel([FakeTorch.bfloat16])
        with self.assertRaisesRegex(RuntimeError, "float32"):
            assert_loaded_model_dtype(model, "float32", torch_module=FakeTorch)

    def test_assert_loaded_model_dtype_float16_float16_passes(self):
        model = FakeModel([FakeTorch.float16])
        self.assertEqual(assert_loaded_model_dtype(model, "float16", torch_module=FakeTorch), "float16")


if __name__ == "__main__":
    unittest.main()
