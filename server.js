const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// High performance HTTP agents with Keep-Alive
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 150,
  maxFreeSockets: 40,
  timeout: 15000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 150,
  maxFreeSockets: 40,
  timeout: 15000
});

// In-Memory cache for categories & stream lists
const apiCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCached(key) {
  const item = apiCache.get(key);
  if (item && (Date.now() - item.timestamp < CACHE_TTL_MS)) {
    return item.data;
  }
  return null;
}

function setCache(key, data) {
  apiCache.set(key, { timestamp: Date.now(), data });
}

app.use(cors());
app.use((req, res, next) => {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') {
    return next();
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      req.body = JSON.parse(req.body);
      return next();
    } catch (e) {}
  }
  express.json({ limit: '15mb' })(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true
}));

function cleanServerUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  return url.replace(/\/+$/, '');
}

// 0. Server Info & Dynamic Local IPs
app.get('/api/info', (req, res) => {
  res.json({
    port: PORT,
    localIps: getLocalIps(),
    serverTime: Date.now()
  });
});

// Server-Side Persistent Profile Management (Permanent Storage across devices & restarts)
const fs = require('fs');
let inMemoryProfile = null;
const PROFILE_FILE = process.env.VERCEL 
  ? path.join('/tmp', 'streamflow_saved_profile.json') 
  : path.join(__dirname, 'streamflow_saved_profile.json');

function readServerProfile() {
  if (inMemoryProfile) return inMemoryProfile;
  try {
    if (fs.existsSync(PROFILE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
      inMemoryProfile = data;
      return data;
    }
  } catch (e) {}
  return null;
}

function writeServerProfile(profile) {
  inMemoryProfile = profile;
  try {
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf8');
  } catch (e) {
    console.error('Error escribiendo perfil en servidor:', e.message);
  }
}

app.get('/api/saved-profile', (req, res) => {
  const profile = readServerProfile();
  return res.json({ success: true, profile: profile || null });
});

app.post('/api/saved-profile', (req, res) => {
  const { profile } = req.body || {};
  if (profile && profile.username && profile.password) {
    writeServerProfile(profile);
    const cookieVal = encodeURIComponent(JSON.stringify(profile));
    res.setHeader('Set-Cookie', `streamflow_active_profile=${cookieVal}; Path=/; Max-Age=315360000; SameSite=Lax`);
    return res.json({ success: true, saved: true });
  }
  return res.json({ success: false });
});

// 1. Authentication
app.post('/api/login', async (req, res) => {
  try {
    const { serverUrl, username, password } = req.body;
    if (!serverUrl || !username || !password) {
      return res.status(400).json({ success: false, error: 'Faltan parámetros requeridos.' });
    }

    const base = cleanServerUrl(serverUrl);
    const targetUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

    console.log(`[LOGIN] Verificando cuenta en: ${base} para usuario: ${username}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)' },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ success: false, error: `Error del servidor: HTTP ${resp.status}` });
    }

    const data = await resp.json();
    if (data.user_info && data.user_info.auth === 0) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas según el proveedor.' });
    }

    apiCache.clear();
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[LOGIN ERROR]', err.message);
    return res.status(500).json({ success: false, error: 'Error de conexión: ' + err.message });
  }
});

// 2. Categories
app.post('/api/categories', async (req, res) => {
  try {
    const { serverUrl, username, password, type } = req.body;
    const base = cleanServerUrl(serverUrl);
    
    let action = 'get_live_categories';
    if (type === 'vod' || type === 'movies') action = 'get_vod_categories';
    if (type === 'series') action = 'get_series_categories';

    const cacheKey = `cat_${base}_${username}_${action}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, categories: cached, fromCache: true });
    }

    const targetUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=${action}`;

    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)' },
      signal: AbortSignal.timeout(15000)
    });

    const data = await resp.json();
    const categories = Array.isArray(data) ? data : [];
    setCache(cacheKey, categories);

    return res.json({ success: true, categories });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, categories: [] });
  }
});

// 3. Streams
app.post('/api/streams', async (req, res) => {
  try {
    const { serverUrl, username, password, type, categoryId } = req.body;
    const base = cleanServerUrl(serverUrl);

    let action = 'get_live_streams';
    if (type === 'vod' || type === 'movies') action = 'get_vod_streams';
    if (type === 'series') action = 'get_series';

    const cacheKey = `str_${base}_${username}_${action}_${categoryId || 'all'}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, streams: cached, fromCache: true });
    }

    let targetUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=${action}`;
    if (categoryId && categoryId !== 'all') {
      targetUrl += `&category_id=${encodeURIComponent(categoryId)}`;
    }

    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)' },
      signal: AbortSignal.timeout(25000)
    });

    const data = await resp.json();
    const streams = Array.isArray(data) ? data : [];
    setCache(cacheKey, streams);

    return res.json({ success: true, streams });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, streams: [] });
  }
});

// 4. Series Details
app.post('/api/series-info', async (req, res) => {
  try {
    const { serverUrl, username, password, seriesId } = req.body;
    const base = cleanServerUrl(serverUrl);
    
    const cacheKey = `series_${base}_${seriesId}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, info: cached, fromCache: true });
    }

    const targetUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_series_info&series_id=${encodeURIComponent(seriesId)}`;

    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)' },
      signal: AbortSignal.timeout(15000)
    });

    const data = await resp.json();
    setCache(cacheKey, data);
    return res.json({ success: true, info: data });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Short EPG
app.post('/api/epg', async (req, res) => {
  try {
    const { serverUrl, username, password, streamId } = req.body;
    const base = cleanServerUrl(serverUrl);
    const targetUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=5`;

    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)' },
      signal: AbortSignal.timeout(8000)
    });

    const data = await resp.json();
    return res.json({ success: true, epg: data.epg_listings || [] });
  } catch (err) {
    return res.json({ success: false, epg: [] });
  }
});

// 6. Transparent Media Stream Proxy with Server-Side Redirect Following & Logging
function handleStreamProxy(targetUrl, req, res, redirectDepth = 0) {
  if (redirectDepth > 6) {
    console.error(`[STREAM PROXY] Demasiadas redirecciones: ${targetUrl}`);
    return res.status(508).send('Demasiadas redirecciones en el stream');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    return res.status(400).send('URL inválida');
  }

  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;
  const agent = isHttps ? httpsAgent : httpAgent;

  const requestHeaders = {
    'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)',
    'Accept': '*/*',
    'Connection': 'keep-alive'
  };

  const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (clientIp) {
    requestHeaders['X-Forwarded-For'] = clientIp;
    requestHeaders['X-Real-IP'] = clientIp;
  }

  if (req.headers.range) {
    requestHeaders['Range'] = req.headers.range;
  }

  console.log(`[STREAM PROXY #${redirectDepth}] Solicitando: ${targetUrl}`);

  const proxyReq = client.request(parsedUrl, {
    method: 'GET',
    agent: agent,
    headers: requestHeaders
  }, (proxyRes) => {
    console.log(`[STREAM PROXY] Respuesta de IPTV: ${proxyRes.statusCode} (${proxyRes.headers['content-type'] || 'sin content-type'})`);

    // Follow HTTP redirects server-side directly
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
      const redirectUrl = new URL(proxyRes.headers.location, parsedUrl).href;
      console.log(`[STREAM PROXY] Siguiendo redirección a: ${redirectUrl}`);
      return handleStreamProxy(redirectUrl, req, res, redirectDepth + 1);
    }

    const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
    const isM3u8 = contentType.includes('mpegurl') || parsedUrl.pathname.toLowerCase().endsWith('.m3u8');

    // M3U8 Playlist: rewrite segment lines through proxy
    if (isM3u8 && proxyRes.statusCode === 200) {
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const lines = body.split('\n');
        const rewrittenLines = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          try {
            const absoluteSegmentUrl = new URL(trimmed, parsedUrl).href;
            return `/api/stream/proxy?url=${encodeURIComponent(absoluteSegmentUrl)}`;
          } catch (e) {
            return line;
          }
        });

        const rewrittenBody = rewrittenLines.join('\n');
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Content-Length': Buffer.byteLength(rewrittenBody),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(rewrittenBody);
      });
      return;
    }

    // Binary Stream (.ts, .mp4, live MPEG-TS)
    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    };

    if (proxyRes.headers['content-type']) {
      responseHeaders['Content-Type'] = proxyRes.headers['content-type'];
    } else if (parsedUrl.pathname.endsWith('.ts')) {
      responseHeaders['Content-Type'] = 'video/mp2t';
    }

    if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
    if (proxyRes.headers['content-range']) responseHeaders['Content-Range'] = proxyRes.headers['content-range'];

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[STREAM PROXY ERROR] ${err.message}`);
    if (!res.headersSent) {
      res.status(502).send('Error conectando al stream: ' + err.message);
    }
  });

  req.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}

app.get('/api/stream/proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Falta el parámetro url');
  }
  handleStreamProxy(targetUrl, req, res, 0);
});

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIps();
    console.log('\n======================================================');
    console.log('   📺  STREAMFLOW IPTV - APP LISTA Y ACTIVA           ');
    console.log('======================================================');
    console.log(`💻 Acceso en este PC:        http://localhost:${PORT}`);
    ips.forEach(ip => {
      console.log(`📱 Acceso en iPhone / iPad:  http://${ip}:${PORT}`);
    });
    console.log('======================================================\n');
  });
}

module.exports = app;
