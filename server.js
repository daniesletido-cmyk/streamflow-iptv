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
  if (apiCache.size > 40) {
    const firstKey = apiCache.keys().next().value;
    if (firstKey) apiCache.delete(firstKey);
  }
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

// Route for iOS / iPadOS Direct Installer
app.get('/instalar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'instalar.html'));
});

// Route for Native iOS Anti-Revoke DNS Profile
app.get('/api/ios-dns-profile', (req, res) => {
  const profilePath = path.join(__dirname, 'public', 'StreamFlow-AntiRevoke.mobileconfig');
  res.setHeader('Content-Type', 'application/x-apple-aspen-config; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="StreamFlow-AntiRevoke.mobileconfig"');
  res.sendFile(profilePath);
});

function cleanServerUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  // Strip any query parameters (e.g. if an M3U URL with ?username= was pasted)
  const qIdx = url.indexOf('?');
  if (qIdx !== -1) {
    url = url.substring(0, qIdx);
  }
  // Remove known endpoint suffixes and trailing paths that cause HTTP 404
  url = url.replace(/\/(player_api|panel_api|get)\.php.*$/i, '');
  url = url.replace(/\/(c|stalker_portal|live|movie|series)\/?$/i, '');
  url = url.replace(/\/+$/, '');
  
  // Map known ISP-blocked domains to their direct IP to bypass Spanish ISP DPI blocks (HTTP 451)
  if (url.includes('westream.sbs')) {
    url = url.replace('westream.sbs', '81.31.194.120');
  }
  return url;
}

// 0. Server Info & Dynamic Local IPs
app.get('/api/info', (req, res) => {
  res.json({
    port: PORT,
    localIps: getLocalIps(),
    serverTime: Date.now()
  });
});

// Server-Side Persistent Multi-Profile Management
const fs = require('fs');
let inMemoryProfiles = null;
const PROFILES_FILE = process.env.VERCEL 
  ? path.join('/tmp', 'streamflow_saved_profiles.json') 
  : path.join(__dirname, 'streamflow_saved_profiles.json');

const LEGACY_PROFILE_FILE = process.env.VERCEL 
  ? path.join('/tmp', 'streamflow_saved_profile.json') 
  : path.join(__dirname, 'streamflow_saved_profile.json');

function readServerProfiles() {
  if (inMemoryProfiles && Array.isArray(inMemoryProfiles)) return inMemoryProfiles;
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
      if (Array.isArray(data)) {
        inMemoryProfiles = data;
        return data;
      }
    }
  } catch (e) {}

  // Fallback to legacy single-profile file
  try {
    if (fs.existsSync(LEGACY_PROFILE_FILE)) {
      const single = JSON.parse(fs.readFileSync(LEGACY_PROFILE_FILE, 'utf8'));
      if (single && single.username) {
        const list = [single];
        inMemoryProfiles = list;
        return list;
      }
    }
  } catch (e) {}

  inMemoryProfiles = [];
  return [];
}

function writeServerProfiles(profiles) {
  inMemoryProfiles = profiles;
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
    if (profiles.length > 0) {
      fs.writeFileSync(LEGACY_PROFILE_FILE, JSON.stringify(profiles[0], null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Error escribiendo perfiles en servidor:', e.message);
  }
}

// Multi-profile endpoints
app.get('/api/saved-profiles', (req, res) => {
  const profiles = readServerProfiles();
  return res.json({ success: true, profiles });
});

app.post('/api/saved-profiles', (req, res) => {
  const { profiles, activeId } = req.body || {};
  if (Array.isArray(profiles)) {
    writeServerProfiles(profiles);
    const active = profiles.find(p => p.id === activeId) || profiles[0];
    if (active) {
      const cookieVal = encodeURIComponent(JSON.stringify(active));
      res.setHeader('Set-Cookie', `streamflow_active_profile=${cookieVal}; Path=/; Max-Age=315360000; SameSite=Lax`);
    }
    return res.json({ success: true, saved: true, count: profiles.length });
  }
  return res.json({ success: false, error: 'Lista de perfiles inválida' });
});

// Backward compatibility single-profile endpoints
app.get('/api/saved-profile', (req, res) => {
  const profiles = readServerProfiles();
  return res.json({ success: true, profile: profiles[0] || null });
});

app.post('/api/saved-profile', (req, res) => {
  const { profile } = req.body || {};
  if (profile && profile.username && profile.password) {
    const profiles = readServerProfiles();
    const idx = profiles.findIndex(p => p.id === profile.id || (p.username === profile.username && p.serverUrl === profile.serverUrl));
    if (idx >= 0) {
      profiles[idx] = { ...profiles[idx], ...profile };
    } else {
      profiles.push(profile);
    }
    writeServerProfiles(profiles);
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
      return res.status(400).json({ success: false, error: 'Faltan parámetros requeridos (Servidor, Usuario o Contraseña).' });
    }

    let base = cleanServerUrl(serverUrl);

    async function tryFetchAuth(baseUrl) {
      const targetUrl = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      console.log(`[LOGIN] Intentando conexión en: ${targetUrl}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const resp = await fetch(targetUrl, {
          headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)' },
          signal: controller.signal
        });
        clearTimeout(timeout);
        return { resp, url: targetUrl, base: baseUrl };
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    }

    let result = null;
    let lastError = null;

    try {
      result = await tryFetchAuth(base);
    } catch (e) {
      lastError = e;
      // If HTTPS failed (e.g. SSL error on raw IPTV ports), try HTTP automatically
      if (base.startsWith('https://')) {
        const httpBase = 'http://' + base.slice(8);
        try {
          console.log(`[LOGIN] Falló HTTPS, reintentando con HTTP en: ${httpBase}`);
          result = await tryFetchAuth(httpBase);
          base = httpBase;
        } catch (e2) {}
      }
    }

    // If 404 on player_api.php, try panel_api.php
    if (result && result.resp && result.resp.status === 404) {
      try {
        const altUrl = `${base}/panel_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
        console.log(`[LOGIN] 404 detectado. Intentando endpoint alternativo: ${altUrl}`);
        const altController = new AbortController();
        const altTimeout = setTimeout(() => altController.abort(), 8000);
        const altResp = await fetch(altUrl, {
          headers: { 'User-Agent': 'IPTVSmartersPro/2.2.1 (Linux; Android 10)' },
          signal: altController.signal
        });
        clearTimeout(altTimeout);
        if (altResp.ok) {
          result = { resp: altResp, url: altUrl, base };
        }
      } catch (e3) {}
    }

    if (!result || !result.resp) {
      return res.status(500).json({ 
        success: false, 
        error: 'No se pudo conectar con el servidor: ' + (lastError ? lastError.message : 'Tiempo de espera agotado') 
      });
    }

    const { resp } = result;

    if (!resp.ok) {
      let friendlyError = `Error del servidor: HTTP ${resp.status}`;
      if (resp.status === 404) {
        friendlyError = 'Servidor respondió HTTP 404 (No encontrado). Verifica la URL del servidor (ejemplo: http://servidor.com:8080 sin rutas extras).';
      } else if (resp.status === 401 || resp.status === 403) {
        friendlyError = 'Acceso denegado (HTTP ' + resp.status + '). Revisa que tu usuario y contraseña sean correctos.';
      } else if (resp.status === 451) {
        friendlyError = 'Bloqueo legal/operador (HTTP 451). Activa el modo proxy en Ajustes para reproducir.';
      }
      return res.status(resp.status).json({ success: false, error: friendlyError });
    }

    const data = await resp.json();
    if (data.user_info && data.user_info.auth === 0) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas según el proveedor (Usuario o Contraseña incorrectos).' });
    }

    apiCache.clear();
    return res.json({ success: true, data, serverUrl: base });
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

// 6. Transparent Media Stream Proxy with Server-Side Redirect Following & Range (HTTP 206) Support
function sanitizeStreamUrl(targetUrl) {
  let url = targetUrl || '';
  if (url.includes('westream.sbs')) {
    url = url.replace('westream.sbs', '81.31.194.120');
  }
  return url;
}

function handleStreamProxy(rawTargetUrl, req, res, redirectDepth = 0) {
  const targetUrl = sanitizeStreamUrl(rawTargetUrl);
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

  // If connecting to direct IP, enforce IP Host header to prevent ISP DPI inspection
  if (parsedUrl.hostname === '81.31.194.120') {
    requestHeaders['Host'] = '81.31.194.120';
  }

  const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (clientIp) {
    requestHeaders['X-Forwarded-For'] = clientIp;
    requestHeaders['X-Real-IP'] = clientIp;
  }

  // Forward Range header from client for VOD seeking (HTTP 206)
  if (req.headers.range) {
    requestHeaders['Range'] = req.headers.range;
  }

  console.log(`[STREAM PROXY #${redirectDepth}] Solicitando: ${targetUrl} (Range: ${req.headers.range || 'none'})`);

  const proxyReq = client.request(parsedUrl, {
    method: 'GET',
    agent: agent,
    headers: requestHeaders
  }, (proxyRes) => {
    console.log(`[STREAM PROXY] Respuesta IPTV: ${proxyRes.statusCode} (${proxyRes.headers['content-type'] || 'sin content-type'})`);

    // Handle ISP block 451: if encountered, attempt IP fallback
    if (proxyRes.statusCode === 451 && !targetUrl.includes('81.31.194.120')) {
      console.warn('[STREAM PROXY] Detectado bloqueo ISP (HTTP 451). Reintentando con IP directa...');
      return handleStreamProxy(targetUrl.replace(parsedUrl.hostname, '81.31.194.120'), req, res, redirectDepth + 1);
    }

    // Follow HTTP redirects server-side directly (preserving Range header)
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

    // Binary Stream (.ts, .mp4, .mkv, live MPEG-TS, VOD)
    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Accel-Buffering': 'no'
    };

    if (res.socket) {
      try { res.socket.setNoDelay(true); } catch (e) {}
    }

    if (proxyRes.headers['content-type']) {
      responseHeaders['Content-Type'] = proxyRes.headers['content-type'];
    } else if (parsedUrl.pathname.endsWith('.ts')) {
      responseHeaders['Content-Type'] = 'video/mp2t';
    } else if (parsedUrl.pathname.endsWith('.mp4')) {
      responseHeaders['Content-Type'] = 'video/mp4';
    } else if (parsedUrl.pathname.endsWith('.mkv')) {
      responseHeaders['Content-Type'] = 'video/x-matroska';
    }

    if (proxyRes.headers['content-length']) responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
    if (proxyRes.headers['content-range']) responseHeaders['Content-Range'] = proxyRes.headers['content-range'];

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);

    proxyRes.on('error', (err) => {
      console.warn(`[STREAM PROXY] upstream error: ${err.message}`);
      try { res.end(); } catch (e) {}
    });

    res.on('error', (err) => {
      console.warn(`[STREAM PROXY] client response error: ${err.message}`);
      try { proxyReq.destroy(); } catch (e) {}
    });

    res.on('close', () => {
      try { proxyReq.destroy(); } catch (e) {}
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[STREAM PROXY ERROR] ${err.message}`);
    if (!res.headersSent) {
      res.status(502).send('Error conectando al stream: ' + err.message);
    }
  });

  req.on('close', () => {
    try { proxyReq.destroy(); } catch (e) {}
  });

  req.on('aborted', () => {
    try { proxyReq.destroy(); } catch (e) {}
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
