export function buildHealthRouter() {
  return (_req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version });
  };
}
