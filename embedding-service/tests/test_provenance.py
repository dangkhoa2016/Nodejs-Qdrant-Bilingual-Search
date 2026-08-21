import unittest

from provenance import embedding_runtime_identity


class EmbeddingRuntimeIdentityTest(unittest.TestCase):
    def test_real_python_service_declares_transformers_semantic_backend(self):
        self.assertEqual(
            embedding_runtime_identity(),
            {
                "backend": "transformers",
                "implementation": "python-fastapi",
                "semantic": True,
            },
        )

    def test_runtime_identity_can_report_accelerator_dtype_and_embedding_profile(self):
        self.assertEqual(
            embedding_runtime_identity(
                accelerator="cpu",
                device="cpu",
                dtype="float16",
                runtime="pytorch-cpu",
                profile="qwen3",
                query_strategy="prompt",
                query_instruction_id="geo-retrieval-v1:abc",
                document_strategy="raw",
            ),
            {
                "backend": "transformers",
                "implementation": "python-fastapi",
                "semantic": True,
                "accelerator": "cpu",
                "device": "cpu",
                "dtype": "float16",
                "runtime": "pytorch-cpu",
                "profile": "qwen3",
                "query_strategy": "prompt",
                "query_instruction_id": "geo-retrieval-v1:abc",
                "document_strategy": "raw",
            },
        )


if __name__ == "__main__":
    unittest.main()
