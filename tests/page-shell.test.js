import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
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

  it('auto-refreshing device-list includes controls form so sort/filter survive refresh', async () => {
    const res = await request(makeApp()).get('/');
    const $ = cheerio.load(res.text);
    const listEl = $('[data-fragment="device-list"]');
    expect(listEl.attr('hx-trigger')).toMatch(/every/);
    expect(listEl.attr('hx-include')).toBe('.controls');
  });

  it('renders defaults when no query string is given', async () => {
    const res = await request(makeApp()).get('/');
    const $ = cheerio.load(res.text);
    expect($('input[name="q"]').attr('value')).toBe('');
    expect($('select[name="status"] option[selected]').attr('value')).toBe('');
    expect($('select[name="sort"] option[selected]').attr('value')).toBe('last_seen');
  });

  it('mounts the top-talkers fragment host div with auto-refresh wiring', async () => {
    const res = await request(makeApp()).get('/');
    const $ = cheerio.load(res.text);
    const host = $('[data-fragment="top-talkers"]');
    expect(host.length).toBe(1);
    expect(host.attr('hx-get')).toBe('/fragments/top-talkers');
    expect(host.attr('hx-trigger')).toMatch(/every/);
  });

  it('pre-fills the controls form from query string so F5 restores selections', async () => {
    const res = await request(makeApp()).get('/?q=jane&status=online&sort=bytes_today');
    expect(res.status).toBe(200);
    const $ = cheerio.load(res.text);
    expect($('input[name="q"]').attr('value')).toBe('jane');
    expect($('select[name="status"] option[selected]').attr('value')).toBe('online');
    expect($('select[name="sort"] option[selected]').attr('value')).toBe('bytes_today');
    // Form fires the URL sync handler after each request.
    expect($('form.controls').attr('hx-on::after-request')).toContain('pfmonSyncUrl');
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
