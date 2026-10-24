import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import prepare_markdown, convert


class DisplayMathTest(unittest.TestCase):
    def test_shared_cases_and_source_preservation(self):
        cases = json.loads(Path(__file__).with_name('math-cases.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'note.md'
            output = root / 'prepared'
            output.mkdir()
            for case in cases:
                with self.subTest(case=case['name']):
                    original = case['input'].encode('utf-8')
                    source.write_bytes(original)
                    prepared = prepare_markdown(source, output)
                    self.assertEqual(prepared.read_bytes().decode('utf-8'), case['expected'])
                    self.assertEqual(source.read_bytes(), original)

    @unittest.skipUnless(os.environ.get('PANDOC_INTEGRATION'), 'Set PANDOC_INTEGRATION=1 for real PDF conversion')
    def test_blank_lines_pdf_and_pandoc_math_ast(self):
        original = '# Alignment\n\n$$\n\\begin{align*}\nx &= 1 \\\\\n\n% Keep this comment on its own line\n\ny &= 2\n\\end{align*}\n$$\n'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'align.md'
            source.write_text(original, encoding='utf-8')
            prepared_dir = root / 'prepared'
            prepared_dir.mkdir()
            prepared = prepare_markdown(source, prepared_dir)
            ast = json.loads(subprocess.check_output(['pandoc', str(prepared), '-t', 'json'], encoding='utf-8'))
            math = ast['blocks'][1]['c'][0]
            self.assertEqual(math['t'], 'Math')
            self.assertEqual(math['c'][0]['t'], 'DisplayMath')
            self.assertIn('% Keep this comment on its own line\ny', math['c'][1])
            convert(source, root / 'align.pdf', 'PDF', 'xelatex', '', True)
            self.assertGreater((root / 'align.pdf').stat().st_size, 1000)
            self.assertEqual(source.read_text(encoding='utf-8'), original)


if __name__ == '__main__':
    unittest.main()
