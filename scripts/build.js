import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'plugin.config.json'), 'utf8'));
const out = `${process.env.HOME}/Library/Application Support/Kepler/Plugins/${config.bundleName}.keplugin`;

// `bundle` writes index.js and manifest.json in one step. It resolves the entry
// and node_modules/.bin/tsup against the working directory, so run it from the
// project root rather than wherever the script was invoked.
execFileSync('kepler-plugin', ['bundle', 'src/index.ts', '--out', out], {
  stdio: 'inherit',
  cwd: root,
});
