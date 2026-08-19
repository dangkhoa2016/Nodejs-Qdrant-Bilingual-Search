import unittest

from profiles import resolve_embedding_profile


class EmbeddingProfileTest(unittest.TestCase):
    def test_e5_small_profile_preserves_existing_prefix_contract(self):
        profile = resolve_embedding_profile("intfloat/multilingual-e5-small")
        self.assertEqual(profile.name, "e5")
        self.assertEqual(profile.dimension, 384)
        self.assertEqual(profile.query_strategy, "prefix")
        self.assertEqual(profile.query_prefix, "query")
        self.assertEqual(profile.document_strategy, "prefix")
        self.assertEqual(profile.document_prefix, "passage")
        self.assertIsNone(profile.query_prompt)

    def test_qwen3_4b_profile_uses_domain_instruction_and_raw_documents(self):
        profile = resolve_embedding_profile("Qwen/Qwen3-Embedding-4B")
        self.assertEqual(profile.name, "qwen3")
        self.assertEqual(profile.dimension, 2560)
        self.assertEqual(profile.query_strategy, "prompt")
        self.assertEqual(profile.document_strategy, "raw")
        self.assertIn("Retrieve the geographic entity", profile.query_prompt)
        self.assertTrue(profile.query_instruction_id.startswith("geo-retrieval-v1:"))

    def test_qwen3_profile_supports_explicit_instruction_override_with_stable_identity(self):
        first = resolve_embedding_profile(
            "Qwen/Qwen3-Embedding-4B",
            query_instruction="Instruct: custom task\nQuery:",
        )
        second = resolve_embedding_profile(
            "Qwen/Qwen3-Embedding-4B",
            query_instruction="Instruct: custom task\nQuery:",
        )
        self.assertEqual(first.query_prompt, "Instruct: custom task\nQuery:")
        self.assertEqual(first.query_instruction_id, second.query_instruction_id)
        self.assertNotEqual(
            first.query_instruction_id,
            resolve_embedding_profile(
                "Qwen/Qwen3-Embedding-4B",
                query_instruction="Instruct: another task\nQuery:",
            ).query_instruction_id,
        )

    def test_known_qwen_dimension_override_must_match_full_dimension(self):
        with self.assertRaisesRegex(ValueError, "full embedding dimension"):
            resolve_embedding_profile("Qwen/Qwen3-Embedding-4B", dimension=1024)

    def test_unknown_model_fails_closed_without_explicit_profile(self):
        with self.assertRaisesRegex(ValueError, "EMBEDDING_PROFILE"):
            resolve_embedding_profile("example/unknown-model")


if __name__ == "__main__":
    unittest.main()
