import unittest

import torch

from pooling import (
    format_documents,
    format_query,
    last_token_pool,
    normalize_embeddings,
)


class FormattingTest(unittest.TestCase):
    def test_format_query_appends_text_to_complete_prompt_prefix(self):
        self.assertEqual(
            format_query("Hà Nội", "Instruct: Retrieve\nQuery:"),
            "Instruct: Retrieve\nQuery:Hà Nội",
        )

    def test_format_documents_leaves_text_unchanged(self):
        self.assertEqual(format_documents(["a", "b"]), ["a", "b"])


class LastTokenPoolTest(unittest.TestCase):
    def test_left_padded_uses_final_position(self):
        hidden = torch.randn(2, 4, 8)
        mask = torch.tensor([[0, 1, 1, 1], [0, 0, 1, 1]])
        pooled = last_token_pool(hidden, mask)
        expected = hidden[:, -1]
        self.assertTrue(torch.equal(pooled, expected))
        self.assertEqual(pooled.shape, (2, 8))

    def test_non_left_padded_uses_last_unmasked_index(self):
        hidden = torch.randn(2, 4, 8)
        mask = torch.tensor([[1, 1, 1, 0], [1, 1, 0, 0]])
        pooled = last_token_pool(hidden, mask)
        expected = torch.stack([hidden[0, 2], hidden[1, 1]])
        self.assertTrue(torch.allclose(pooled, expected))
        self.assertEqual(pooled.shape, (2, 8))

    def test_rejects_wrong_shapes(self):
        with self.assertRaises(ValueError):
            last_token_pool(torch.randn(2, 4, 8), torch.randn(3, 4))
        with self.assertRaises(ValueError):
            last_token_pool(torch.randn(2, 4), torch.randn(2, 4))
        with self.assertRaises(ValueError):
            last_token_pool(torch.randn(2, 4, 8), torch.randn(2, 5))


class NormalizeTest(unittest.TestCase):
    def test_returns_unit_norm_rows(self):
        vectors = torch.tensor([[3.0, 4.0], [0.0, 5.0]])
        normalized = normalize_embeddings(vectors)
        norms = normalized.norm(p=2, dim=1)
        self.assertTrue(torch.allclose(norms, torch.ones(2), atol=1e-5))
        self.assertEqual(normalized.dtype, torch.float32)

    def test_promotes_float16_to_float32_before_normalizing(self):
        vectors = torch.tensor([[3.0, 4.0]], dtype=torch.float16)
        normalized = normalize_embeddings(vectors)
        self.assertEqual(normalized.dtype, torch.float32)
        self.assertTrue(torch.allclose(normalized.norm(p=2, dim=1), torch.ones(1), atol=1e-3))

    def test_promotes_bfloat16_to_float32_before_normalizing(self):
        vectors = torch.tensor([[3.0, 4.0]], dtype=torch.bfloat16)
        normalized = normalize_embeddings(vectors)
        self.assertEqual(normalized.dtype, torch.float32)
        self.assertTrue(torch.allclose(normalized.norm(p=2, dim=1), torch.ones(1), atol=1e-2))


if __name__ == "__main__":
    unittest.main()
