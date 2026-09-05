import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import parse_paths


class PathsTest(unittest.TestCase):
    def test_path_variants(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            note = vault / '中文 space_note.md'
            note.touch()
            for value in (str(note), '"' + str(note) + '"', note.as_uri(),
                          f'[note](<{note}>)', '[[中文 space_note]]',
                          'obsidian://open?file=%E4%B8%AD%E6%96%87%20space_note.md'):
                with self.subTest(value=value):
                    self.assertEqual(parse_paths(value, vault), [note.resolve()])
            self.assertEqual(parse_paths(f'{note}\n{note}', vault), [note.resolve()])
            with self.assertRaises(ValueError):
                parse_paths('https://example.com/a.md', vault)
            with self.assertRaises(ValueError):
                parse_paths('obsidian://open?vault=other&file=note', vault)


if __name__ == '__main__':
    unittest.main()
