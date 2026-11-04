const http = require('http');

async function test(headers, name) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'westream.sbs',
      port: 80,
      path: '/live/yURsbDFX7JUK/hRZqKgcfrFEA/3383.m3u8',
      headers: {
        'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)',
        ...headers
      },
      method: 'GET'
    }, (res) => {
      resolve({ name, status: res.statusCode, location: res.headers.location });
    });
    req.on('error', e => resolve({ name, error: e.message }));
    req.end();
  });
}

(async () => {
  console.log(await test({}, 'Default Smarters'));
  console.log(await test({ 'Host': 'westream.sbs' }, 'Explicit Host'));
  console.log(await test({ 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18' }, 'VLC UA'));
  console.log(await test({ 'User-Agent': 'AppleCoreMedia/1.0.0.18D70 (iPad; U; CPU OS 14_4 like Mac OS X)' }, 'iPad UA'));
})();
