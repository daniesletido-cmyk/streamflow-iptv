/**
 * StreamFlow IPTV - Ultimate Universal Video Engine
 * Supports:
 * 1. mpegts.js for Live MPEG-TS streams (.ts) in PC browsers (Chrome, Edge, Firefox)
 * 2. Hls.js for HLS streams (.m3u8) with adaptive buffering
 * 3. Native iOS Safari hardware-accelerated HLS & PiP
 * 4. Automatic fallback pipeline with connection timeout & zero-freeze watchdog
 */
class StreamPlayer {
  constructor() {
    this.video = document.getElementById('mainVideo');
    this.hls = null;
    this.mpegtsPlayer = null;
    this.currentItem = null;
    this.currentUrls = null;
    this.isPlaying = false;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.isLoading = false;
    this.currentStrategyIndex = 0;
    this.connectTimeout = null;

    this.lastTime = 0;
    this.stalledSeconds = 0;
    this.watchdogInterval = null;
    this.osdTimeout = null;

    this.currentStreamType = 'live';
    this.seriesContext = null;
    this.lastProgressSave = 0;
    this.resumeTime = null;

    this.initEvents();
  }

  initEvents() {
    if (!this.video) return;

    this.video.addEventListener('playing', () => {
      this.isPlaying = true;
      this.isLoading = false;
      this.clearConnectionTimeout();
      this.retryCount = 0;
      this.updateStatus('En reproducción');
      this.hideBuffering();

      // Check if we need to resume from saved timestamp
      if (this.resumeTime && this.resumeTime > 0) {
        try {
          if (this.video.duration && this.resumeTime < this.video.duration) {
            this.video.currentTime = this.resumeTime;
          }
        } catch (e) {}
        this.resumeTime = null;
      }
    });

    this.video.addEventListener('loadedmetadata', () => {
      if (this.resumeTime && this.resumeTime > 0) {
        try {
          if (this.video.duration && this.resumeTime < this.video.duration) {
            this.video.currentTime = this.resumeTime;
          }
        } catch (e) {}
        this.resumeTime = null;
      }
    });

    this.video.addEventListener('waiting', () => {
      if (this.isPlaying) {
        this.showBuffering('Almacenando búfer...');
      }
    });

    this.video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseBtn();
      // Save progress on pause immediately
      if (this.currentStreamType !== 'live' && this.video.duration > 0 && this.currentItem) {
        Storage.savePlaybackProgress(this.currentItem, this.video.currentTime, this.video.duration, this.seriesContext);
      }
    });

    this.video.addEventListener('error', (e) => {
      console.warn('Video element error:', e);
      this.tryNextFallbackStrategy('Error en elemento de vídeo');
    });

    this.video.addEventListener('timeupdate', () => {
      if (this.video.currentTime > 0) {
        this.hideBuffering();
      }

      // Track continue watching for Movies & Series
      if (this.currentStreamType !== 'live' && this.video.duration > 0 && this.currentItem) {
        const now = Date.now();
        if (now - this.lastProgressSave > 3000) {
          this.lastProgressSave = now;
          Storage.savePlaybackProgress(this.currentItem, this.video.currentTime, this.video.duration, this.seriesContext);
        }
      }
    });

    this.video.addEventListener('ended', () => {
      if (this.currentStreamType !== 'live' && this.currentItem) {
        Storage.markAsWatched(this.currentItem, true, this.seriesContext);
        if (window.App && typeof window.App.showToast === 'function') {
          window.App.showToast(`✓ Finalizado: ${this.currentItem.name || 'Vídeo'}`);
        }
      }
    });

    const container = document.getElementById('playerContainer');
    if (container) {
      container.addEventListener('mousemove', () => this.showOsdTemporarily());
      container.addEventListener('touchstart', () => this.showOsdTemporarily(), { passive: true });
    }
  }

  clearConnectionTimeout() {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  async play(item, profile, streamType = 'live', extra = {}) {
    this.cleanupEngines();
    this.clearConnectionTimeout();
    this.isLoading = true;
    this.isPlaying = false;
    this.currentItem = item;
    this.currentStreamType = streamType;
    this.seriesContext = extra;
    this.lastProgressSave = 0;
    this.resumeTime = null;
    this.retryCount = 0;
    this.currentStrategyIndex = 0;
    this.stopWatchdog();

    // Check if this movie or series has a saved resume position
    if (streamType !== 'live') {
      const saved = Storage.getPlaybackProgress(item.stream_id || item.id || extra.episode_id);
      if (saved && saved.currentTime > 10 && (saved.duration - saved.currentTime > 25)) {
        this.resumeTime = saved.currentTime;
        console.log(`[Player] Posición guardada encontrada: ${saved.currentTime}s (${saved.progress}%)`);
      }
    }

    document.getElementById('playerView').classList.remove('hidden');
    this.updatePlayerInfo(item);
    this.showBuffering(this.resumeTime ? `Reanudando desde ${this.formatTime(this.resumeTime)}...` : 'Conectando canal...');
    this.showOsdTemporarily(4000);

    const urls = Api.getStreamUrls(profile, item, streamType);
    this.currentUrls = urls;
    Storage.addRecent(item);

    // Build ordered playback strategies
    this.strategies = this.buildPlaybackStrategies(urls, streamType);
    console.log('[Player] Estrategias disponibles:', this.strategies.map(s => `[${s.engine}] ${s.label}`));

    await this.executeStrategy(0);
    this.startWatchdog();
  }

  buildPlaybackStrategies(urls, streamType) {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const canNative = this.video.canPlayType('application/vnd.apple.mpegurl');
    const list = [];

    if (streamType === 'live') {
      if (isIos || (canNative && !window.Hls?.isSupported())) {
        // iOS Safari / iPad: Direct native stream from user's IP first (bypasses cloud datacenter IP blocks)
        if (urls.hls) list.push({ engine: 'native', url: urls.hls, label: 'iOS HLS Directo' });
        if (urls.directLive) list.push({ engine: 'native', url: urls.directLive, label: 'iOS TS Directo' });
        if (urls.direct) list.push({ engine: 'native', url: urls.direct, label: 'iOS Bare Directo' });
        if (urls.proxiedHls) list.push({ engine: 'native', url: urls.proxiedHls, label: 'iOS HLS Proxied' });
        if (urls.proxiedDirectLive) list.push({ engine: 'native', url: urls.proxiedDirectLive, label: 'iOS TS Live Proxied' });
        if (urls.proxiedDirect) list.push({ engine: 'native', url: urls.proxiedDirect, label: 'iOS TS Direct Proxied' });
      } else {
        // PC & Android Chrome/Edge:
        // Strategy 1: mpegts.js with /live/ TS stream (official Xtream Codes standard)
        if (window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
          if (urls.proxiedDirectLive) {
            list.push({ engine: 'mpegts', url: urls.proxiedDirectLive, label: 'MPEG-TS Live (/live/...)' });
          }
          if (urls.proxiedDirect) {
            list.push({ engine: 'mpegts', url: urls.proxiedDirect, label: 'MPEG-TS Direct' });
          }
          if (urls.directLive) {
            list.push({ engine: 'mpegts', url: urls.directLive, label: 'MPEG-TS Directo sin proxy' });
          }
        }

        // Strategy 2: Hls.js with M3U8
        if (window.Hls && Hls.isSupported()) {
          if (urls.proxiedHls) list.push({ engine: 'hls', url: urls.proxiedHls, label: 'HLS Playlist Proxied' });
          if (urls.hls) list.push({ engine: 'hls', url: urls.hls, label: 'HLS Playlist Directa' });
        }

        // Strategy 3: Raw bare stream
        if (window.mpegts && mpegts.getFeatureList().mseLivePlayback && urls.proxiedBare) {
          list.push({ engine: 'mpegts', url: urls.proxiedBare, label: 'MPEG-TS Raw' });
        }

        // Strategy 4: Native video element
        if (urls.proxiedDirectLive) {
          list.push({ engine: 'native', url: urls.proxiedDirectLive, label: 'Nativo Fallback' });
        }
      }
    } else {
      // VOD / Movies / Series: Proxied direct first (guarantees Xtream Codes user-agent headers)
      if (urls.proxiedDirect) {
        list.push({ engine: 'native', url: urls.proxiedDirect, label: 'VOD Proxied' });
      }
      if (isIos && urls.direct) {
        list.push({ engine: 'native', url: urls.direct, label: 'VOD Nativo iOS' });
      }
      if (urls.direct) {
        list.push({ engine: 'native', url: urls.direct, label: 'VOD Sin Proxy' });
      }
    }

    return list;
  }

  async executeStrategy(index) {
    if (!this.strategies || index >= this.strategies.length) {
      this.clearConnectionTimeout();
      this.showBuffering('No se pudo conectar a este canal con ninguna alternativa.');
      this.stopWatchdog();
      return;
    }

    this.currentStrategyIndex = index;
    const strategy = this.strategies[index];
    console.log(`[Player] Probando opción #${index + 1}/${this.strategies.length}: [${strategy.engine}] ${strategy.label} -> ${strategy.url}`);
    this.showBuffering(`Conectando (${strategy.label})...`);

    this.cleanupEngines();

    // Guard timeout: dynamic per stream type (live channels 9s, movies/series 25s)
    this.clearConnectionTimeout();
    const timeoutMs = (this.currentStreamType === 'live') ? 9000 : 25000;
    this.connectTimeout = setTimeout(() => {
      if (!this.isPlaying) {
        console.warn(`[Player] Opción #${index + 1} (${strategy.label}) no comenzó en ${timeoutMs/1000}s. Pasando a la siguiente opción...`);
        this.tryNextFallbackStrategy('Tiempo de espera agotado');
      }
    }, timeoutMs);

    try {
      if (strategy.engine === 'mpegts') {
        this.loadWithMpegTs(strategy.url);
      } else if (strategy.engine === 'hls') {
        this.loadWithHls(strategy.url);
      } else {
        this.loadWithNative(strategy.url);
      }
    } catch (err) {
      console.warn('Fallo ejecutando estrategia:', err);
      this.tryNextFallbackStrategy(err.message);
    }
  }

  loadWithMpegTs(url) {
    this.mpegtsPlayer = mpegts.createPlayer({
      type: 'mse',
      isLive: true,
      url: url
    }, {
      enableWorker: false,
      lazyLoad: false,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 2.5,
      liveBufferLatencyMinRemain: 0.5,
      autoCleanupSourceBuffer: true
    });

    this.mpegtsPlayer.attachMediaElement(this.video);
    this.mpegtsPlayer.load();

    const playPromise = this.mpegtsPlayer.play();
    if (playPromise) {
      playPromise.catch(e => console.log('Autoplay mpegts:', e));
    }

    this.mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
      console.warn('mpegts error:', errorType, errorDetail);
      this.tryNextFallbackStrategy(`MpegTS Error: ${errorType}`);
    });
  }

  loadWithHls(url) {
    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 20,
      maxBufferLength: 10,
      maxMaxBufferLength: 20,
      fragLoadingTimeOut: 6000,
      manifestLoadingTimeOut: 6000
    });

    this.hls.loadSource(url);
    this.hls.attachMedia(this.video);

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.video.play().catch(() => {});
    });

    this.hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn('Hls fatal error:', data.type);
        this.tryNextFallbackStrategy(`Hls Error: ${data.type}`);
      }
    });
  }

  loadWithNative(url) {
    this.video.preload = 'auto';
    this.video.src = url;
    this.video.play().catch(e => console.log('Play native:', e));
  }

  tryNextFallbackStrategy(reason) {
    this.clearConnectionTimeout();
    console.warn('Intentando siguiente alternativa. Motivo:', reason);
    const next = this.currentStrategyIndex + 1;
    if (next < this.strategies.length) {
      setTimeout(() => this.executeStrategy(next), 400);
    } else {
      const msg = (this.currentStreamType === 'live')
        ? 'El canal no emite en directo en este momento (emisión apagada o evento no iniciado).'
        : 'El contenido no responde en este momento. Inténtalo de nuevo más tarde.';
      this.showBuffering(msg);
      this.stopWatchdog();
    }
  }

  startWatchdog() {
    this.stopWatchdog();
    const settings = Storage.getSettings();
    if (!settings.watchdog) return;

    this.lastTime = this.video.currentTime;
    this.stalledSeconds = 0;

    this.watchdogInterval = setInterval(() => {
      if (!this.isPlaying || this.video.paused) {
        this.stalledSeconds = 0;
        return;
      }

      if (Math.abs(this.video.currentTime - this.lastTime) < 0.2) {
        this.stalledSeconds++;
        if (this.stalledSeconds >= 6) {
          console.warn('Watchdog: Congelado durante 6s en reproducción. Probando reconexión...');
          this.showBuffering('Recuperando conexión...');
          this.tryNextFallbackStrategy('Watchdog timeout');
          this.stalledSeconds = 0;
        }
      } else {
        this.stalledSeconds = 0;
        this.lastTime = this.video.currentTime;
      }
    }, 1000);
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  cleanupEngines() {
    this.clearConnectionTimeout();
    if (this.mpegtsPlayer) {
      try {
        this.mpegtsPlayer.pause();
        this.mpegtsPlayer.unload();
        this.mpegtsPlayer.detachMediaElement();
        this.mpegtsPlayer.destroy();
      } catch (e) {}
      this.mpegtsPlayer = null;
    }

    if (this.hls) {
      try {
        this.hls.destroy();
      } catch (e) {}
      this.hls = null;
    }

    try {
      this.video.removeAttribute('src');
      this.video.load();
    } catch (e) {}
  }

  stop() {
    if (this.currentStreamType !== 'live' && this.video && this.video.currentTime > 4 && this.currentItem) {
      Storage.savePlaybackProgress(this.currentItem, this.video.currentTime, this.video.duration, this.seriesContext);
    }
    this.clearConnectionTimeout();
    this.stopWatchdog();
    this.cleanupEngines();
    this.isPlaying = false;
    this.currentItem = null;
    this.resumeTime = null;
    document.getElementById('playerView').classList.add('hidden');

    if (window.App && typeof window.App.renderContinueWatching === 'function') {
      window.App.renderContinueWatching();
      window.App.refreshWatchedBadges();
    }
  }

  togglePlayPause() {
    if (this.video.paused) {
      this.video.play();
    } else {
      this.video.pause();
    }
    this.updatePlayPauseBtn();
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    const btn = document.getElementById('muteBtn');
    if (btn) {
      btn.innerHTML = this.video.muted 
        ? '<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.73 4.73H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
        : '<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
    }
  }

  toggleFullscreen() {
    const container = document.getElementById('playerContainer');
    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      } else if (this.video.webkitEnterFullscreen) {
        this.video.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  togglePip() {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else if (this.video.requestPictureInPicture) {
      this.video.requestPictureInPicture().catch(() => {});
    } else if (this.video.webkitSetPresentationMode) {
      const mode = this.video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
      this.video.webkitSetPresentationMode(mode);
    }
  }

  cycleAspectRatio() {
    const ratios = ['contain', 'cover', 'fill'];
    const current = this.video.style.objectFit || 'contain';
    const nextIdx = (ratios.indexOf(current) + 1) % ratios.length;
    const next = ratios[nextIdx];
    this.video.style.objectFit = next;
    this.showBuffering(`Escala: ${next.toUpperCase()}`, 1200);
  }

  updatePlayerInfo(item) {
    const titleEl = document.getElementById('playerTitle');
    const badgeEl = document.getElementById('playerBadge');
    const logoEl = document.getElementById('playerLogo');

    if (titleEl) titleEl.textContent = item.name || 'Canal en directo';
    if (badgeEl) badgeEl.textContent = item.stream_type === 'live' ? '🔴 EN VIVO' : 'VOD';
    
    if (logoEl) {
      if (item.stream_icon) {
        logoEl.src = item.stream_icon;
        logoEl.classList.remove('hidden');
      } else {
        logoEl.classList.add('hidden');
      }
    }

    this.updateFavBtn(item);
  }

  updateFavBtn(item) {
    const favBtn = document.getElementById('playerFavBtn');
    if (!favBtn || !item) return;
    const isFav = Storage.isFavorite(item.stream_id);
    favBtn.classList.toggle('text-yellow-400', isFav);
    favBtn.classList.toggle('text-white', !isFav);
  }

  updatePlayPauseBtn() {
    const btn = document.getElementById('playPauseBtn');
    if (!btn) return;
    btn.innerHTML = this.video.paused
      ? '<svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
      : '<svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  }

  showBuffering(text = 'Cargando...', autoHideMs = null) {
    const buf = document.getElementById('playerBuffering');
    const txt = document.getElementById('bufferingText');
    if (buf) {
      buf.classList.remove('hidden');
      if (txt) txt.textContent = text;
    }
    if (autoHideMs) {
      setTimeout(() => this.hideBuffering(), autoHideMs);
    }
  }

  hideBuffering() {
    const buf = document.getElementById('playerBuffering');
    if (buf) buf.classList.add('hidden');
  }

  updateStatus(text) {
    const el = document.getElementById('playerStatus');
    if (el) el.textContent = text;
  }

  showOsdTemporarily(duration = 3500) {
    const osd = document.getElementById('playerControls');
    if (!osd) return;
    osd.classList.remove('opacity-0', 'pointer-events-none');
    clearTimeout(this.osdTimeout);
    this.osdTimeout = setTimeout(() => {
      if (this.isPlaying && !this.video.paused) {
        osd.classList.add('opacity-0', 'pointer-events-none');
      }
    }, duration);
  }
}
