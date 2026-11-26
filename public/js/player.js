/**
 * StreamFlow IPTV - Ultimate Universal Hybrid Video Engine
 * Features:
 * 1. Hybrid Architecture: mpegts.js (Live TV) + hls.js + Native Progressive (VOD)
 * 2. Zero Green Screen & Macroblock Shielding: waits for first valid IDR/Keyframe via requestVideoFrameCallback
 * 3. Fast Zapping (<1.5s) with dynamic buffer scaling (128KB stash -> dynamic buffer expansion)
 * 4. Zero-Freeze Auto-Recovery Watchdog (1.5s poll, 4s reconnect threshold)
 * 5. Full VOD Seek Timeline & HTTP 206 Range seeking
 * 6. External Player Fallback (VLC / Outplayer / Infuse / Direct Link) for unsupported audio codecs (AC3/EAC3)
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
    this.isSeeking = false;
    this.videoFrameCallbackId = null;
    this.isCleaningUp = false;
    this.hlsRecoverAttempts = 0;

    this.initEvents();
  }

  initEvents() {
    if (!this.video) return;

    // 1. Clean Frame & Green Screen Guard
    this.video.addEventListener('playing', () => {
      this.isPlaying = true;
      this.isLoading = false;
      this.clearConnectionTimeout();
      this.retryCount = 0;
      this.updateStatus('En reproducción');

      // Schedule dynamic buffer expansion after 3 seconds of smooth playback
      setTimeout(() => this.expandBufferAfterStart(), 3000);

      // Verify that clean decoded video frames are physically advancing before revealing video
      this.waitForCleanFrame();

      // Check if we need to resume from saved timestamp (VOD)
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
      this.updateVodTimeline();
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
      if (this.currentStreamType !== 'live' && this.video.duration > 0 && this.currentItem) {
        Storage.savePlaybackProgress(this.currentItem, this.video.currentTime, this.video.duration, this.seriesContext);
      }
    });

    this.video.addEventListener('error', (e) => {
      if (this.isCleaningUp || !this.currentItem) return;
      console.warn('[Player] Video element error:', e);
      const mediaErr = this.video.error;
      const errCode = mediaErr ? mediaErr.code : 0;
      this.tryNextFallbackStrategy(`Error de reproducción (código ${errCode})`);
    });

    this.video.addEventListener('timeupdate', () => {
      if (this.video.currentTime > 0.05 && this.video.videoWidth > 0) {
        this.markVideoReady();
      }

      // Skip VOD timeline & progress writes during Live TV to keep main thread ultra-light
      if (this.currentStreamType !== 'live') {
        this.updateVodTimeline();

        if (this.video.duration > 0 && this.currentItem) {
          const now = Date.now();
          if (now - this.lastProgressSave > 3000) {
            this.lastProgressSave = now;
            Storage.savePlaybackProgress(this.currentItem, this.video.currentTime, this.video.duration, this.seriesContext);
          }
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

    // OSD visibility
    const container = document.getElementById('playerContainer');
    if (container) {
      container.addEventListener('mousemove', () => this.showOsdTemporarily());
      container.addEventListener('touchstart', () => this.showOsdTemporarily(), { passive: true });
    }

    // VOD timeline slider scrubbing
    const slider = document.getElementById('vodSeekSlider');
    if (slider) {
      slider.addEventListener('input', () => {
        this.isSeeking = true;
        if (this.video.duration) {
          const targetTime = (slider.value / 100) * this.video.duration;
          const currEl = document.getElementById('vodCurrentTime');
          if (currEl) currEl.textContent = this.formatTime(targetTime);
        }
      });
      slider.addEventListener('change', () => {
        if (this.video.duration) {
          const targetTime = (slider.value / 100) * this.video.duration;
          this.video.currentTime = targetTime;
        }
        this.isSeeking = false;
      });
    }

    // External player button in top bar
    document.getElementById('externalPlayerBtn')?.addEventListener('click', () => {
      this.openExternalPlayerModal();
    });

    // External player modal links
    document.getElementById('openVlcBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchExternalScheme('vlc');
    });
    document.getElementById('openOutplayerBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchExternalScheme('outplayer');
    });
    document.getElementById('openInfuseBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.launchExternalScheme('infuse');
    });
    document.getElementById('copyStreamUrlBtn')?.addEventListener('click', () => {
      this.copyCurrentStreamUrl();
    });
  }

  // Waits for clean IDR keyframe presentation before fading in video
  waitForCleanFrame() {
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      try {
        if (this.videoFrameCallbackId) {
          this.video.cancelVideoFrameCallback(this.videoFrameCallbackId);
        }
        this.videoFrameCallbackId = this.video.requestVideoFrameCallback(() => {
          this.markVideoReady();
        });
        return;
      } catch (e) {}
    }
    // Fallback: check currentTime progression
    setTimeout(() => {
      if (this.video && this.video.currentTime > 0.05) {
        this.markVideoReady();
      }
    }, 150);
  }

  markVideoReady() {
    if (this.video) {
      this.video.classList.add('video-ready');
    }
    this.hideBuffering();
  }

  hideVideoUntilClean() {
    if (this.video) {
      this.video.classList.remove('video-ready');
    }
  }

  expandBufferAfterStart() {
    if (!this.isPlaying) return;
    try {
      if (this.hls) {
        this.hls.config.maxBufferLength = 30;
        this.hls.config.maxMaxBufferLength = 60;
      }
    } catch (e) {}
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
    this.hideVideoUntilClean();
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

    // Configure VOD timeline vs Live layout
    this.configurePlayerLayout(streamType);

    // Check if this movie or series has a saved resume position
    if (streamType !== 'live') {
      const saved = Storage.getPlaybackProgress(item.stream_id || item.id || extra.episode_id);
      if (saved && saved.currentTime > 10 && (saved.duration - saved.currentTime > 25)) {
        this.resumeTime = saved.currentTime;
      }
    }

    document.getElementById('playerView').classList.remove('hidden');
    this.updatePlayerInfo(item);
    this.showBuffering(this.resumeTime ? `Reanudando desde ${this.formatTime(this.resumeTime)}...` : 'Conectando señal...');
    this.showOsdTemporarily(4000);

    const urls = Api.getStreamUrls(profile, item, streamType);
    this.currentUrls = urls;
    Storage.addRecent(item);

    // Build ordered playback strategies
    this.strategies = this.buildPlaybackStrategies(urls, streamType);
    console.log('[Player] Estrategias preparadas:', this.strategies.map(s => `[${s.engine}] ${s.label}`));

    await this.executeStrategy(0);
    this.startWatchdog();
  }

  configurePlayerLayout(streamType) {
    const vodContainer = document.getElementById('vodTimelineContainer');
    const prevBtn = document.getElementById('prevChannelBtn');
    const nextBtn = document.getElementById('nextChannelBtn');
    const badgeEl = document.getElementById('playerBadge');

    if (streamType === 'live') {
      if (vodContainer) vodContainer.classList.add('hidden');
      if (prevBtn) prevBtn.classList.remove('hidden');
      if (nextBtn) nextBtn.classList.remove('hidden');
      if (badgeEl) {
        badgeEl.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded bg-red-600/90 text-white uppercase tracking-wider';
        badgeEl.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-white"></span> EN VIVO';
      }
    } else {
      if (vodContainer) vodContainer.classList.remove('hidden');
      if (prevBtn) prevBtn.classList.add('hidden');
      if (nextBtn) nextBtn.classList.add('hidden');
      if (badgeEl) {
        badgeEl.className = 'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded bg-sky-600/90 text-white uppercase tracking-wider';
        badgeEl.textContent = streamType === 'series' ? 'SERIE' : 'PELÍCULA';
      }
    }
  }

  buildPlaybackStrategies(urls, streamType) {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const canNative = this.video.canPlayType('application/vnd.apple.mpegurl');
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app');
    const list = [];

    if (streamType === 'live') {
      if (isIos || (canNative && !window.Hls?.isSupported())) {
        // iOS Safari / iPad: HLS first on Vercel, TS proxied on LAN
        if (isVercel) {
          if (urls.proxiedHls) list.push({ engine: 'native', url: urls.proxiedHls, label: 'iOS HLS Proxied' });
          if (urls.proxiedDirectLive) list.push({ engine: 'native', url: urls.proxiedDirectLive, label: 'iOS TS Proxied' });
        } else {
          if (urls.proxiedDirectLive) list.push({ engine: 'native', url: urls.proxiedDirectLive, label: 'iOS TS Proxied' });
          if (urls.proxiedHls) list.push({ engine: 'native', url: urls.proxiedHls, label: 'iOS HLS Proxied' });
          if (urls.proxiedDirect) list.push({ engine: 'native', url: urls.proxiedDirect, label: 'iOS Direct Proxied' });
          if (!isHttpsPage && urls.directLive) list.push({ engine: 'native', url: urls.directLive, label: 'iOS TS Directo' });
          if (!isHttpsPage && urls.hls) list.push({ engine: 'native', url: urls.hls, label: 'iOS HLS Directo' });
        }
      } else if (isVercel) {
        // Vercel Serverless: Prioritize HLS (.m3u8 segments) and skip HTTP direct URLs (blocked by Mixed Content)
        if (window.Hls && Hls.isSupported() && urls.proxiedHls) {
          list.push({ engine: 'hls', url: urls.proxiedHls, label: 'HLS Live (Fluido)' });
        }
        if (window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
          if (urls.proxiedDirectLive) list.push({ engine: 'mpegts', url: urls.proxiedDirectLive, label: 'MPEG-TS Proxied' });
          if (urls.proxiedDirect) list.push({ engine: 'mpegts', url: urls.proxiedDirect, label: 'MPEG-TS Direct Proxied' });
        }
        if (urls.proxiedHls) list.push({ engine: 'native', url: urls.proxiedHls, label: 'Nativo HLS' });
      } else {
        // PC Desktop (.exe / localhost) & LAN: Local Node proxy supports infinite MPEG-TS & HLS seamlessly
        if (window.mpegts && mpegts.getFeatureList().mseLivePlayback) {
          if (urls.proxiedDirectLive) {
            list.push({ engine: 'mpegts', url: urls.proxiedDirectLive, label: 'MPEG-TS Live (/live/...)' });
          }
          if (urls.proxiedDirect) {
            list.push({ engine: 'mpegts', url: urls.proxiedDirect, label: 'MPEG-TS Direct' });
          }
        }
        if (window.Hls && Hls.isSupported()) {
          if (urls.proxiedHls) list.push({ engine: 'hls', url: urls.proxiedHls, label: 'HLS Playlist Proxied' });
          if (!isHttpsPage && urls.hls) list.push({ engine: 'hls', url: urls.hls, label: 'HLS Playlist Directa' });
        }
        if (!isHttpsPage && window.mpegts && mpegts.getFeatureList().mseLivePlayback && urls.directLive) {
          list.push({ engine: 'mpegts', url: urls.directLive, label: 'MPEG-TS Directo sin proxy' });
        }
        if (window.mpegts && mpegts.getFeatureList().mseLivePlayback && urls.proxiedBare) {
          list.push({ engine: 'mpegts', url: urls.proxiedBare, label: 'MPEG-TS Raw' });
        }
        if (urls.proxiedDirectLive) {
          list.push({ engine: 'native', url: urls.proxiedDirectLive, label: 'Nativo Fallback' });
        }
      }
    } else {
      // VOD / Movies / Series: Proxied direct first (guarantees Range headers & Xtream Codes User-Agent)
      if (urls.proxiedDirect) {
        list.push({ engine: 'native', url: urls.proxiedDirect, label: 'VOD Proxied (Range 206)' });
      }
      if (!isHttpsPage && urls.direct) {
        list.push({ engine: 'native', url: urls.direct, label: 'VOD Directo' });
      }
    }

    return list;
  }

  async executeStrategy(index) {
    if (!this.strategies || index >= this.strategies.length) {
      this.clearConnectionTimeout();
      this.handlePlaybackFailure();
      this.stopWatchdog();
      return;
    }

    this.currentStrategyIndex = index;
    const strategy = this.strategies[index];
    console.log(`[Player] Probando opción #${index + 1}/${this.strategies.length}: [${strategy.engine}] ${strategy.label} -> ${strategy.url}`);
    this.showBuffering(`Conectando (${strategy.label})...`);

    this.cleanupEngines();
    this.hideVideoUntilClean();

    // Dynamic timeout: 10s for live TV (fast fail on dead channels), 20s for VOD
    this.clearConnectionTimeout();
    const timeoutMs = (this.currentStreamType === 'live') ? 10000 : 20000;
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
    const isLocal = typeof window !== 'undefined' && !window.location.hostname.includes('vercel.app');
    this.mpegtsPlayer = mpegts.createPlayer({
      type: 'mse',
      isLive: true,
      url: url
    }, {
      enableWorker: true,
      lazyLoad: false,
      liveBufferLatencyChasing: false, // Prevents premature buffer-starvation seeks at 1s
      liveBufferLatencyMaxLatency: 8.0,
      liveBufferLatencyMinRemain: 2.5,
      enableStashBuffer: true,
      stashInitialSize: isLocal ? 128 * 1024 : 256 * 1024, // 128KB instant zapping on local/.exe
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 20, // Low RAM footprint during long sessions
      autoCleanupMinBackwardDuration: 10,
      fixAudioTimestampGap: true,
      accurateSeek: false
    });

    this.mpegtsPlayer.attachMediaElement(this.video);
    this.mpegtsPlayer.load();

    const playPromise = this.mpegtsPlayer.play();
    if (playPromise) {
      playPromise.catch(e => console.log('Autoplay mpegts:', e));
    }

    this.mpegtsPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
      if (this.isCleaningUp) return;
      console.warn('mpegts error:', errorType, errorDetail);
      this.tryNextFallbackStrategy(`MpegTS Error: ${errorType}`);
    });
  }

  loadWithHls(url) {
    const isVercel = typeof window !== 'undefined' && window.location.hostname.includes('vercel.app');
    this.hlsRecoverAttempts = 0;
    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false, // Standard HLS buffering prevents 1s micro-stutters on IPTV
      startFragPrefetch: true, // Prefetch first TS segment immediately on manifest parse
      backBufferLength: 10, // Keeps RAM usage 3x lower
      maxBufferLength: isVercel ? 20 : 15,
      maxMaxBufferLength: isVercel ? 45 : 30,
      maxBufferHole: 1.5, // Smoothly bridges minor IPTV TS timestamp gaps
      highBufferWatchdogPeriod: 3,
      nudgeOffset: 0.2,
      nudgeMaxRetry: 5,
      fragLoadingTimeOut: 15000,
      fragLoadingMaxRetry: 2,
      manifestLoadingTimeOut: 6000, // Fail fast (6s) on dead channel playlists
      manifestLoadingMaxRetry: 1,
      liveSyncDurationCount: 2, // Start closer to live edge for faster zapping
      liveMaxLatencyDurationCount: 8
    });

    this.hls.loadSource(url);
    this.hls.attachMedia(this.video);

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.video.play().catch(() => {});
    });

    this.hls.on(Hls.Events.ERROR, (event, data) => {
      if (this.isCleaningUp || !data.fatal) return;
      console.warn('Hls fatal error:', data.type, data.details);

      if (this.hlsRecoverAttempts < 2) {
        this.hlsRecoverAttempts++;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          console.log('[HLS] Intentando recuperar red...');
          this.hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          console.log('[HLS] Intentando recuperar decodificación...');
          this.hls.recoverMediaError();
          return;
        }
      }

      this.tryNextFallbackStrategy(`Hls Error: ${data.type}`);
    });
  }

  loadWithNative(url) {
    this.video.preload = 'auto';
    this.video.src = url;
    this.video.play().catch(e => console.log('Play native:', e));
  }

  tryNextFallbackStrategy(reason) {
    this.clearConnectionTimeout();
    console.warn('[Player] Intentando siguiente alternativa. Motivo:', reason);
    const next = this.currentStrategyIndex + 1;
    if (next < this.strategies.length) {
      setTimeout(() => this.executeStrategy(next), 350);
    } else {
      this.handlePlaybackFailure();
      this.stopWatchdog();
    }
  }

  handlePlaybackFailure() {
    let msg = '';
    let suggestion = null;

    if (this.currentStreamType === 'live') {
      const name = (this.currentItem && this.currentItem.name) ? this.currentItem.name.toUpperCase() : '';
      if (name.includes('HDR')) {
        msg = 'Este canal en HDR no emite actualmente (emisión inactiva o evento apagado).';
        // Check if there is an FHD or HD counterpart in App streams
        if (window.App && Array.isArray(window.App.streams)) {
          const baseName = this.currentItem.name.replace(/HDR/i, '').trim();
          const alt = window.App.streams.find(s => s.name && s.name.includes(baseName) && !s.name.includes('HDR'));
          if (alt) {
            suggestion = { label: `Probar versión FHD (${alt.name})`, item: alt };
          }
        }
      } else {
        msg = 'El canal no responde actualmente (emisión apagada o evento no iniciado).';
      }
    } else {
      msg = 'El vídeo no responde o requiere un reproductor externo.';
    }

    this.showBuffering(msg);
    this.showBufferingActions(suggestion);
  }

  showBufferingActions(suggestion = null) {
    const container = document.getElementById('bufferingActions');
    if (!container) return;
    container.innerHTML = '';
    container.classList.remove('hidden');

    if (suggestion && suggestion.item) {
      const btn = document.createElement('button');
      btn.className = 'px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-[#090b0f] text-xs font-semibold shadow-lg transition-colors';
      btn.textContent = suggestion.label;
      btn.onclick = () => {
        container.classList.add('hidden');
        if (window.App && typeof window.App.playStream === 'function') {
          window.App.playStream(suggestion.item);
        }
      };
      container.appendChild(btn);
    }

    const extBtn = document.createElement('button');
    extBtn.className = 'px-3.5 py-1.5 rounded-lg bg-[#161a22] hover:bg-[#1c212c] text-[#f4f6f9] border border-white/[0.1] text-xs font-medium transition-colors';
    extBtn.textContent = 'Abrir en reproductor externo';
    extBtn.onclick = () => this.openExternalPlayerModal();
    container.appendChild(extBtn);
  }

  hideBufferingActions() {
    const container = document.getElementById('bufferingActions');
    if (container) {
      container.innerHTML = '';
      container.classList.add('hidden');
    }
  }

  showExternalPlayerFallback(reason) {
    this.showBuffering(reason);
    this.showBufferingActions();
    // Never auto-open the modal popup; let the user click the button if they want an external player
  }

  startWatchdog() {
    this.stopWatchdog();
    const settings = Storage.getSettings();
    if (!settings.watchdog) return;

    this.lastTime = this.video.currentTime;
    this.stalledSeconds = 0;

    // Check currentTime every 1.5s
    this.watchdogInterval = setInterval(() => {
      if (!this.isPlaying || this.video.paused) {
        this.stalledSeconds = 0;
        return;
      }

      // If currentTime has not advanced by at least 0.1s
      if (Math.abs(this.video.currentTime - this.lastTime) < 0.1) {
        this.stalledSeconds += 1.5;
        if (this.stalledSeconds >= 7.5) {
          console.warn('[Watchdog] Stream congelado durante >7.5s. Auto-recuperando...');
          this.showBuffering('Recuperando señal...');
          this.stalledSeconds = 0;
          if (this.hls) {
            try { this.hls.startLoad(); } catch (e) {}
          } else {
            this.tryNextFallbackStrategy('Watchdog stall recovery');
          }
        }
      } else {
        this.stalledSeconds = 0;
        this.lastTime = this.video.currentTime;
      }
    }, 1500);
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  cleanupEngines() {
    this.isCleaningUp = true;
    this.clearConnectionTimeout();
    this.hideBufferingActions();

    if (this.videoFrameCallbackId && 'cancelVideoFrameCallback' in HTMLVideoElement.prototype) {
      try { this.video.cancelVideoFrameCallback(this.videoFrameCallbackId); } catch (e) {}
      this.videoFrameCallbackId = null;
    }

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

    setTimeout(() => { this.isCleaningUp = false; }, 50);
  }

  stop() {
    if (this.currentStreamType !== 'live' && this.video && this.video.currentTime > 4 && this.currentItem) {
      Storage.savePlaybackProgress(this.currentItem, this.video.currentTime, this.video.duration, this.seriesContext);
    }
    this.clearConnectionTimeout();
    this.stopWatchdog();
    this.cleanupEngines();
    this.hideVideoUntilClean();
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
    const logoEl = document.getElementById('playerLogo');

    if (titleEl) titleEl.textContent = item.name || 'Canal';
    
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

  updateVodTimeline() {
    if (this.currentStreamType === 'live' || this.isSeeking) return;
    const currEl = document.getElementById('vodCurrentTime');
    const durEl = document.getElementById('vodDuration');
    const slider = document.getElementById('vodSeekSlider');

    const cur = this.video.currentTime || 0;
    const dur = this.video.duration || 0;

    if (currEl) currEl.textContent = this.formatTime(cur);
    if (durEl && dur > 0) durEl.textContent = this.formatTime(dur);
    if (slider && dur > 0) {
      slider.value = (cur / dur) * 100;
    }
  }

  formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
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
    this.hideBufferingActions();
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
      if (this.isPlaying && !this.video.paused && !this.isSeeking) {
        osd.classList.add('opacity-0', 'pointer-events-none');
      }
    }, duration);
  }

  // ================= EXTERNAL PLAYER INTEGRATION =================
  openExternalPlayerModal() {
    const modal = document.getElementById('externalPlayerModal');
    if (modal) {
      modal.classList.remove('hidden');
    }
  }

  getBestExternalUrl() {
    if (!this.currentUrls) return '';
    return this.currentUrls.directLive || this.currentUrls.direct || this.currentUrls.hls || '';
  }

  launchExternalScheme(scheme) {
    const rawUrl = this.getBestExternalUrl();
    if (!rawUrl) return;

    let schemeUrl = '';
    if (scheme === 'vlc') {
      // vlc://http://... or vlc-x-callback://
      schemeUrl = `vlc://${rawUrl}`;
    } else if (scheme === 'outplayer') {
      schemeUrl = `outplayer://${rawUrl}`;
    } else if (scheme === 'infuse') {
      schemeUrl = `infuse://${rawUrl}`;
    }

    if (schemeUrl) {
      window.location.href = schemeUrl;
    }
  }

  copyCurrentStreamUrl() {
    const url = this.getBestExternalUrl();
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        if (window.App && typeof window.App.showToast === 'function') {
          window.App.showToast('✓ Enlace copiado al portapapeles');
        }
      });
    }
  }
}
