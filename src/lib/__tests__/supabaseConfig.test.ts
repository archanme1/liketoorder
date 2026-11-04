// The app's tsconfig loads no Node types, so the two Node calls are typed here (require comes from
// the jest types, as in env.test.ts). __dirname is set by jest's module wrapper.
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolve } = require('path') as { resolve: (...segments: string[]) => string };

const CONFIG_PATH = resolve(__dirname, '../../../supabase/config.toml');

// Returns the text of one top-level TOML table, from its header to the next table header.
function readSection(toml: string, name: string): string | null {
  const header = new RegExp(`^\\[${name}\\][ \\t]*(?:#.*)?$`, 'm').exec(toml);
  if (!header) return null;
  const rest = toml.slice(header.index + header[0].length);
  const next = /^\[/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// Reads the `schemas = [...]` array of a section. The array may span several lines.
function readSchemas(section: string): string[] | null {
  const line = /^[ \t]*schemas[ \t]*=[ \t]*\[([^\]]*)\]/m.exec(section);
  if (!line) return null;
  const withoutComments = line[1].replace(/#.*$/gm, '');
  return Array.from(withoutComments.matchAll(/"([^"]*)"|'([^']*)'/g), (m) => m[1] ?? m[2]);
}

describe('supabase/config.toml', () => {
  const toml = readFileSync(CONFIG_PATH, 'utf8');

  it('has an [api] section with a schemas list', () => {
    const section = readSection(toml, 'api');
    expect(section).not.toBeNull();
    expect(readSchemas(section ?? '')).not.toBeNull();
  });

  it('exposes exactly public and graphql_public through the API', () => {
    const schemas = readSchemas(readSection(toml, 'api') ?? '');
    expect(schemas).toEqual(['public', 'graphql_public']);
  });

  it('never exposes the private helper schema', () => {
    const schemas = readSchemas(readSection(toml, 'api') ?? '') ?? [];
    expect(schemas).not.toContain('private');
  });
});
