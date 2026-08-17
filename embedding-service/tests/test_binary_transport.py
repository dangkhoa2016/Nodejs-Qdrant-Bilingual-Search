import struct
import unittest

from binary_transport import encode_float32_matrix


class BinaryTransportTest(unittest.TestCase):
    def test_encodes_row_major_little_endian_float32(self):
        body = encode_float32_matrix([[1.5, -2.25], [3.0, 4.5]], dimension=2)
        self.assertEqual(len(body), 4 * 4)
        self.assertEqual(struct.unpack('<4f', body), (1.5, -2.25, 3.0, 4.5))

    def test_rejects_non_finite_values(self):
        with self.assertRaisesRegex(ValueError, 'finite'):
            encode_float32_matrix([[1.0, float('nan')]], dimension=2)

    def test_rejects_vector_count_or_dimension_mismatch(self):
        with self.assertRaisesRegex(ValueError, 'dimension 2'):
            encode_float32_matrix([[1.0]], dimension=2)
        with self.assertRaisesRegex(ValueError, 'non-empty'):
            encode_float32_matrix([], dimension=2)


if __name__ == '__main__':
    unittest.main()
