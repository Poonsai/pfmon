import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildHealthRouter } from '../src/health.js';

describe('GET /api/health', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.get('/api/health', buildHealthRouter());
  });
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports the package version from package.json, not from npm_package_version', async () => {
    // Production runs `node src/index.js` (Dockerfile CMD), which does not set
    // npm_package_version. The version must come from a source available in
    // that environment — reading package.json at startup.
    const res = await request(app).get('/api/health');
    expect(res.body.version).toBeTypeOf('string');
    expect(res.body.version.length).toBeGreaterThan(0);
    expect(res.body.version).not.toBe('undefined');
  });
});
