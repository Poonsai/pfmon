import express from 'express';
import { buildHealthRouter } from './health.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);

app.get('/api/health', buildHealthRouter());

const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', msg: 'http listening', port }));
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
