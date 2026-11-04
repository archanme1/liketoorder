// The app's tsconfig loads no Node types, so the Node calls are typed here (as in
// src/lib/__tests__/supabaseConfig.test.ts). __dirname is set by jest's module wrapper.
declare const __dirname: string;
type DirEntry = { name: string; isDirectory: () => boolean };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => DirEntry[];
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as {
  join: (...segments: string[]) => string;
  resolve: (...segments: string[]) => string;
  relative: (from: string, to: string) => string;
};

const MEDIA_DIR = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) specs.push(match[1]);
  return specs;
}

describe('src/features/media isolation', () => {
  const files = sourceFiles(MEDIA_DIR);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports no seller or menu code', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (/(^|\/)(sellers|menu)(\/|$)/.test(spec)) {
          offenders.push(`${path.relative(MEDIA_DIR, file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
