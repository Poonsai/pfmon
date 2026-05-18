import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
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
});
