import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm sets npm_package_version only when started via `npm start`. Production
// runs the binary directly (`node src/index.js` in the Dockerfile's CMD), so
// that env var is undefined there. Read package.json once at startup instead.
const __dirname = dirname(fileURLToPath(import.meta.url));
let pkgVersion = 'dev';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  if (pkg?.version) pkgVersion = pkg.version;
} catch (_e) {
  // Fall through with 'dev'. Health stays usable even if package.json is missing.
}

export function buildHealthRouter() {
  return (_req, res) => {
    res.json({ status: 'ok', version: pkgVersion });
  };
}
