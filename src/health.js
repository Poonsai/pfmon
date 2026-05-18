export function buildHealthRouter() {
  return (req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version });
  };
}
