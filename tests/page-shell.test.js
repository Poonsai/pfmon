import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPageRouter } from '../src/routes/page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, '..', 'src', 'views'));
  app.use(buildPageRouter());
  return app;
}

describe('GET /', () => {
  it('returns HTML 200 with the page shell', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    const $ = cheerio.load(res.text);
    expect($('header.header h1').text()).toMatch(/pfmon/i);
    expect($('[data-fragment="device-list"]').length).toBe(1);
    expect($('[data-fragment="wan-summary"]').length).toBe(1);
    expect($('[data-fragment="alerts"]').length).toBe(1);
    expect($('#detail-panel').length).toBe(1);
    expect($('button.theme-toggle').length).toBe(1);
  });

  it('includes anti-FOUC inline theme script in head before stylesheet', async () => {
    const res = await request(makeApp()).get('/');
    const $ = cheerio.load(res.text);
    const head = $('head').html() ?? '';
    const inlineIdx = head.indexOf('data-theme');
    const cssIdx = head.indexOf('pfmon.css');
    expect(inlineIdx).toBeGreaterThan(-1);
    expect(cssIdx).toBeGreaterThan(-1);
    expect(inlineIdx).toBeLessThan(cssIdx);
  });
});
