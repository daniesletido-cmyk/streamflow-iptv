const app = require('../server.js');

module.exports = (req, res) => {
  if (req.headers['x-matched-path'] && req.headers['x-matched-path'].startsWith('/api/')) {
    const qIdx = (req.url || '').indexOf('?');
    const query = qIdx !== -1 ? req.url.slice(qIdx) : '';
    req.url = req.headers['x-matched-path'] + query;
  }
  return app(req, res);
};

