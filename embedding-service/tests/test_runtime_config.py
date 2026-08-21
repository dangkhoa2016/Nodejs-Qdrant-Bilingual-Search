import unittest

from runtime_config import resolve_runtime_config


class RuntimeConfigTest(unittest.TestCase):
    def test_auto_runtime_prefers_cuda_float16_when_gpu_is_available(self):
        runtime = resolve_runtime_config(device="auto", dtype="auto", cuda_available=True)
        self.assertEqual(runtime.device, "cuda")
        self.assertEqual(runtime.accelerator, "gpu")
        self.assertEqual(runtime.dtype, "float16")
        self.assertEqual(runtime.runtime, "pytorch-cuda")

    def test_auto_runtime_uses_cpu_float32_without_cuda(self):
        runtime = resolve_runtime_config(device="auto", dtype="auto", cuda_available=False)
        self.assertEqual(runtime.device, "cpu")
        self.assertEqual(runtime.accelerator, "cpu")
        self.assertEqual(runtime.dtype, "float32")
        self.assertEqual(runtime.runtime, "pytorch-cpu")

    def test_cuda_request_fails_closed_when_cuda_is_unavailable(self):
        with self.assertRaisesRegex(RuntimeError, "CUDA"):
            resolve_runtime_config(device="cuda", dtype="float16", cuda_available=False)

    def test_cpu_float16_is_allowed_for_transformers_fp16_cpu_profile(self):
        runtime = resolve_runtime_config(device="cpu", dtype="float16", cuda_available=False)
        self.assertEqual(runtime.device, "cpu")
        self.assertEqual(runtime.accelerator, "cpu")
        self.assertEqual(runtime.dtype, "float16")
        self.assertEqual(runtime.runtime, "pytorch-cpu")


if __name__ == "__main__":
    unittest.main()
