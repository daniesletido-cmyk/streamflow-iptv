const app = require('../server.js');

module.exports = (req, res) => {
  if (req.headers['x-matched-path'] && req.headers['x-matched-path'].startsWith('/api/')) {
    req.url = req.headers['x-matched-path'];
  }
  return app(req, res);
};
