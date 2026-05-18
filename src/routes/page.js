import express from 'express';

export function buildPageRouter() {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.render('layout');
  });
  return router;
}
