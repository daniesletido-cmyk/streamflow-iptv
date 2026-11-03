/**
 * StreamFlow IPTV - Main Application Controller (High Performance Edition)
 * Optimized with Virtual Infinite Scroll, In-Memory Caching & Debounced Search
 */
const App = {
  currentTab: 'live',
  lastContentTab: 'live',
  activeFavSubTab: 'all',
  currentCategory: 'all',
  categories: [],
  streams: [],
  filteredStreams: [],
  currentChannelIndex: -1,
  activeProfile: null,
  player: null,

  // Infinite Scroll & Virtual Rendering
  PAGE_SIZE: 48,
  renderedCount: 0,
  observer: null,
  searchDebounceTimer: null,

  async init() {
    this.player = new StreamPlayer();
    RemoteNav.init(this);

    this.bindDomEvents();
    this.initInfiniteScroll();
    this.registerServiceWorker();
    this.loadServerInfo();

    this.activeProfile = Storage.getActiveProfile();
    if (!this.activeProfile) {
      this.openLoginModal(true);
    } else {
      this.updateProfileUi();
      await this.loadCurrentTab();
    }
  },

  bindDomEvents() {
    // Navigation Tabs
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        this.switchTab(tab);
      });
    });

    // Debounced Search input for maximum fluidity
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.filterStreams(e.target.value);
        }, 180);
      });
    }

    // Dedicated Categories/Groups Search Input (Real-time Filter)
    const catSearchInput = document.getElementById('categorySearchInput');
    if (catSearchInput) {
      catSearchInput.addEventListener('input', (e) => {
        this.filterCategories(e.target.value);
      });
    }

    // Quick Access Shortcut Buttons (Spain, Favs, Todos)
    document.getElementById('quickSpainBtn')?.addEventListener('click', async () => {
      if (this.currentTab === 'favorites' || this.currentTab === 'recents') {
        await this.switchTab(this.lastContentTab || 'live');
      }
      this.selectUnifiedCountry('spain');
    });
    document.getElementById('quickFavsBtn')?.addEventListener('click', () => this.switchTab('favorites'));
    document.getElementById('quickAllBtn')?.addEventListener('click', async () => {
      if (this.currentTab === 'favorites' || this.currentTab === 'recents') {
        await this.switchTab(this.lastContentTab || 'live');
      }
      this.selectCategory('all');
    });

    // Favorites Sub-Nav Buttons (🌟 Todos, 🔴 Canales, 🎬 Pelis, 📺 Series)
    document.querySelectorAll('.fav-sub-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-fav-type');
        this.switchFavSubTab(type);
      });
    });

    // Mobile Groups Sidebar Triggers
    document.getElementById('mobileGroupsBtn')?.addEventListener('click', () => this.toggleMobileSidebar(true));
    document.getElementById('closeSidebarBtn')?.addEventListener('click', () => this.toggleMobileSidebar(false));
    document.getElementById('sidebarBackdrop')?.addEventListener('click', () => this.toggleMobileSidebar(false));

    // Login Form Submit
    document.getElementById('loginForm')?.addEventListener('submit', (e) => this.handleLoginSubmit(e));
    document.getElementById('demoModeBtn')?.addEventListener('click', () => this.startDemoMode());

    // Player action buttons
    document.getElementById('playPauseBtn')?.addEventListener('click', () => this.player.togglePlayPause());
    document.getElementById('muteBtn')?.addEventListener('click', () => this.player.toggleMute());
    document.getElementById('fullscreenBtn')?.addEventListener('click', () => this.player.toggleFullscreen());
    document.getElementById('pipBtn')?.addEventListener('click', () => this.player.togglePip());
    document.getElementById('aspectBtn')?.addEventListener('click', () => this.player.cycleAspectRatio());
    document.getElementById('closePlayerBtn')?.addEventListener('click', () => this.closePlayer());
    document.getElementById('nextChannelBtn')?.addEventListener('click', () => this.nextChannel());
    document.getElementById('prevChannelBtn')?.addEventListener('click', () => this.prevChannel());
    document.getElementById('drawerBtn')?.addEventListener('click', () => this.toggleChannelDrawer());
    document.getElementById('closeDrawerBtn')?.addEventListener('click', () => this.toggleChannelDrawer(false));

    // Player favorite toggle
    document.getElementById('playerFavBtn')?.addEventListener('click', () => {
      if (this.player.currentItem) {
        this.toggleFavorite(this.player.currentItem);
        this.player.updateFavBtn(this.player.currentItem);
      }
    });

    // Modal triggers
    document.getElementById('profileBtn')?.addEventListener('click', () => this.openLoginModal());
    document.getElementById('settingsBtn')?.addEventListener('click', () => this.openSettingsModal());
    document.getElementById('iosInstallBtn')?.addEventListener('click', () => this.openIosModal());
    document.getElementById('favoriteCountryBtn')?.addEventListener('click', () => this.toggleCategoryFavorites());
    document.getElementById('clearFavoritesBtn')?.addEventListener('click', () => this.handleClearFavorites());
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });

    // Settings
    const proxyToggle = document.getElementById('settingProxy');
    const watchdogToggle = document.getElementById('settingWatchdog');
    if (proxyToggle) {
      proxyToggle.checked = Storage.getSettings().useProxy;
      proxyToggle.addEventListener('change', (e) => Storage.saveSettings({ useProxy: e.target.checked }));
    }
    if (watchdogToggle) {
      watchdogToggle.checked = Storage.getSettings().watchdog;
      watchdogToggle.addEventListener('change', (e) => Storage.saveSettings({ watchdog: e.target.checked }));
    }
  },

  initInfiniteScroll() {
    // Observer for appending cards without freezing the main thread
    this.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && this.renderedCount < this.filteredStreams.length) {
        this.appendNextBatch();
      }
    }, { rootMargin: '300px' });
  },

  async switchTab(tab) {
    if (this.currentTab === tab) return;
    this.currentTab = tab;
    if (['live', 'vod', 'series'].includes(tab)) {
      this.lastContentTab = tab;
    }
    this.currentCategory = 'all';

    document.querySelectorAll('[data-tab]').forEach(btn => {
      const match = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('nav-active', match);
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    const catSearch = document.getElementById('categorySearchInput');
    if (catSearch) catSearch.value = '';

    this.updateSidebarShortcuts();
    await this.loadCurrentTab();
  },

  updateSidebarShortcuts() {
    const sidebarTitle = document.getElementById('sidebarSectionTitle');
    const searchInput = document.getElementById('searchInput');
    const catSearchInput = document.getElementById('categorySearchInput');
    const quickCountryText = document.getElementById('quickCountryText');
    const quickFavsText = document.getElementById('quickFavsText');
    const quickAllText = document.getElementById('quickAllText');
    const favSubNav = document.getElementById('favoritesSubNav');
    const grid = document.getElementById('streamGrid');

    // Adapt grid poster ratio: vertical 2:3 for cinema movies & series, standard for TV
    if (grid) {
      grid.classList.toggle('grid-vertical', this.currentTab === 'vod' || this.currentTab === 'series');
    }

    // Toggle Favorites SubNav visibility
    if (favSubNav) {
      favSubNav.classList.toggle('hidden', this.currentTab !== 'favorites');
    }

    if (this.currentTab === 'vod') {
      if (sidebarTitle) sidebarTitle.textContent = 'Géneros / Películas';
      if (searchInput) searchInput.placeholder = 'Buscar película...';
      if (catSearchInput) catSearchInput.placeholder = 'Buscar género o categoría...';
      if (quickCountryText) quickCountryText.textContent = 'Pelis Spain';
      if (quickFavsText) quickFavsText.textContent = 'Pelis Favs';
      if (quickAllText) quickAllText.textContent = 'Todas';
    } else if (this.currentTab === 'series') {
      if (sidebarTitle) sidebarTitle.textContent = 'Categorías / Series';
      if (searchInput) searchInput.placeholder = 'Buscar serie...';
      if (catSearchInput) catSearchInput.placeholder = 'Buscar categoría de series...';
      if (quickCountryText) quickCountryText.textContent = 'Series Spain';
      if (quickFavsText) quickFavsText.textContent = 'Series Favs';
      if (quickAllText) quickAllText.textContent = 'Todas';
    } else if (this.currentTab === 'favorites') {
      if (sidebarTitle) sidebarTitle.textContent = 'Mis Favoritos';
      if (searchInput) searchInput.placeholder = 'Buscar en favoritos...';
      if (catSearchInput) catSearchInput.placeholder = 'Filtrar favoritos...';
      if (quickCountryText) quickCountryText.textContent = 'Todo Spain';
      if (quickFavsText) quickFavsText.textContent = 'Favoritos';
      if (quickAllText) quickAllText.textContent = 'Todos';
    } else { // live or recents
      if (sidebarTitle) sidebarTitle.textContent = 'Grupos / Países';
      if (searchInput) searchInput.placeholder = 'Buscar canal...';
      if (catSearchInput) catSearchInput.placeholder = 'Buscar grupo o país...';
      if (quickCountryText) quickCountryText.textContent = 'Todo Spain';
      if (quickFavsText) quickFavsText.textContent = 'Favoritos';
      if (quickAllText) quickAllText.textContent = 'Todos';
    }
  },

  switchFavSubTab(type) {
    this.activeFavSubTab = type || 'all';
    document.querySelectorAll('.fav-sub-btn').forEach(b => {
      const match = b.getAttribute('data-fav-type') === this.activeFavSubTab;
      b.classList.toggle('active', match);
      b.classList.toggle('text-cyan-300', match);
      b.classList.toggle('bg-cyan-950/60', match);
      b.classList.toggle('border-cyan-800/50', match);
      b.classList.toggle('text-gray-400', !match);
    });

    this.streams = Storage.getFavorites(this.activeFavSubTab);
    this.filteredStreams = [...this.streams];
    this.updateFavoritesBadges();

    const grid = document.getElementById('streamGrid');
    if (grid) {
      grid.classList.toggle('grid-vertical', this.activeFavSubTab === 'movie' || this.activeFavSubTab === 'series');
    }

    this.renderFavoritesSidebarCategories();
    this.initStreamGrid();
  },

  updateFavoritesBadges() {
    const counts = Storage.getFavoriteCounts();
    const cAll = document.getElementById('favCountAll');
    const cLive = document.getElementById('favCountLive');
    const cMovies = document.getElementById('favCountMovies');
    const cSeries = document.getElementById('favCountSeries');
    if (cAll) cAll.textContent = counts.total;
    if (cLive) cLive.textContent = counts.live;
    if (cMovies) cMovies.textContent = counts.movies;
    if (cSeries) cSeries.textContent = counts.series;
  },

  renderFavoritesSidebarCategories() {
    const container = document.getElementById('categoryVerticalList');
    const badgeEl = document.getElementById('categoryCountBadge');
    if (!container) return;

    const counts = Storage.getFavoriteCounts();
    if (badgeEl) badgeEl.textContent = counts.total;

    const items = [
      { id: 'all', name: '🌟 Todos los Favoritos', count: counts.total },
      { id: 'live', name: '🔴 Canales En Directo', count: counts.live },
      { id: 'movie', name: '🎬 Películas Guardadas', count: counts.movies },
      { id: 'series', name: '📺 Series Guardadas', count: counts.series }
    ];

    let html = '';
    items.forEach(item => {
      const isActive = this.activeFavSubTab === item.id;
      html += `
        <div class="category-nav-item ${isActive ? 'active' : ''} focusable" data-fav-filter="${item.id}">
          <div class="flex items-center gap-2 min-w-0">
            <span class="category-nav-title font-semibold">${item.name}</span>
          </div>
          <span class="category-nav-badge">${item.count}</span>
        </div>
      `;
    });

    container.innerHTML = html;
    container.querySelectorAll('.category-nav-item[data-fav-filter]').forEach(el => {
      el.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-fav-filter');
        this.switchFavSubTab(type);
        this.toggleMobileSidebar(false);
      });
    });
  },

  async loadCurrentTab() {
    this.showLoadingGrid(true);

    // Reset category search input
    const catSearch = document.getElementById('categorySearchInput');
    if (catSearch) catSearch.value = '';

    if (this.currentTab === 'favorites') {
      this.streams = Storage.getFavorites(this.activeFavSubTab);
      this.filteredStreams = [...this.streams];
      this.categories = [];
      this.updateFavoritesBadges();
      this.renderFavoritesSidebarCategories();
      this.initStreamGrid();
      this.showLoadingGrid(false);
      return;
    }

    if (this.currentTab === 'recents') {
      this.streams = Storage.getRecents();
      this.filteredStreams = [...this.streams];
      this.categories = [];
      this.renderCategoryList([]);
      this.initStreamGrid();
      this.showLoadingGrid(false);
      return;
    }

    if (!this.activeProfile) {
      this.showLoadingGrid(false);
      return;
    }

    try {
      // Parallel loading: fetch categories and streams at the same time
      const [cats, streams] = await Promise.all([
        Api.getCategories(this.activeProfile, this.currentTab),
        Api.getStreams(this.activeProfile, this.currentTab)
      ]);

      this.categories = cats || [];
      this.streams = streams || [];
      this.filteredStreams = [...this.streams];

      this.renderCategoryList(this.categories);
      this.initStreamGrid();
    } catch (e) {
      console.error('Error cargando contenidos:', e);
      this.renderEmptyGrid('No se pudieron cargar los canales. Comprueba la conexión con el servidor Xtream.');
    } finally {
      this.showLoadingGrid(false);
    }
  },

  renderCategoryList(categoriesToRender, query = '') {
    const container = document.getElementById('categoryVerticalList');
    const badgeEl = document.getElementById('categoryCountBadge');
    if (!container) return;

    if (badgeEl) {
      badgeEl.textContent = categoriesToRender ? categoriesToRender.length : 0;
    }

    if (!categoriesToRender || categoriesToRender.length === 0) {
      if (this.currentTab === 'favorites') {
        container.innerHTML = `
          <div class="p-3 rounded-xl bg-gray-900/60 text-xs text-gray-400 text-center">
            Mostrando todos tus canales marcados como favoritos ⭐
          </div>
        `;
      } else {
        container.innerHTML = `
          <div class="p-3 text-xs text-gray-500 text-center">
            No se encontraron grupos para "${query}"
          </div>
        `;
      }
      return;
    }

    // Count channels per category
    const counts = {};
    this.streams.forEach(s => {
      const cid = String(s.category_id);
      counts[cid] = (counts[cid] || 0) + 1;
    });

    let html = '';

    // If searching (e.g. 'spain') and more than 1 category matched, show UNIFIED COUNTRY CARD at the very top!
    if (query && categoriesToRender.length > 1) {
      const matchingCatIds = new Set(categoriesToRender.map(c => String(c.category_id)));
      let totalInMatching = 0;
      this.streams.forEach(s => {
        if (matchingCatIds.has(String(s.category_id))) totalInMatching++;
      });

      const isUnifiedActive = this.currentCategory === 'unified_' + query.toLowerCase();
      const isSpain = query.toLowerCase().includes('spain') || query.toLowerCase().includes('es');

      html += `
        <div class="category-nav-item unified-special-btn ${isUnifiedActive ? 'active' : ''} focusable" data-unified-query="${query}">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-base">${isSpain ? '🇪🇸' : '🎯'}</span>
            <div class="flex flex-col min-w-0">
              <span class="category-nav-title font-extrabold text-cyan-300">TODO "${query.toUpperCase()}" (${categoriesToRender.length} grupos)</span>
              <span class="text-[10px] text-gray-400">Ver y guardar todos juntos</span>
            </div>
          </div>
          <span class="category-nav-badge font-bold text-cyan-300 bg-cyan-950/80 border-cyan-800">${totalInMatching}</span>
        </div>
      `;
    }

    // All channels option (if not searching)
    if (!query) {
      html += `
        <div class="category-nav-item ${this.currentCategory === 'all' ? 'active' : ''} focusable" data-cat-id="all">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm">🌐</span>
            <span class="category-nav-title">Todos los canales</span>
          </div>
          <span class="category-nav-badge">${this.streams.length}</span>
        </div>
      `;
    }

    categoriesToRender.forEach(cat => {
      const catId = String(cat.category_id);
      const catName = cat.category_name;
      const count = counts[catId] || 0;
      const isActive = String(this.currentCategory) === catId;

      html += `
        <div class="category-nav-item ${isActive ? 'active' : ''} focusable" data-cat-id="${catId}">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm opacity-70">📺</span>
            <span class="category-nav-title" title="${catName}">${catName}</span>
          </div>
          <span class="category-nav-badge">${count}</span>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach click events to individual categories
    container.querySelectorAll('.category-nav-item[data-cat-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const catId = e.currentTarget.getAttribute('data-cat-id');
        this.selectCategory(catId);
        this.toggleMobileSidebar(false);
      });
    });

    // Attach click events to unified group button
    container.querySelectorAll('.unified-special-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const uq = e.currentTarget.getAttribute('data-unified-query');
        this.selectUnifiedCategory(uq, categoriesToRender);
        this.toggleMobileSidebar(false);
      });
    });

    // ==========================================
    // RENDER HORIZONTAL CATEGORIES BAR (Chips)
    // ==========================================
    const horizontalContainer = document.getElementById('categoryHorizontalBar');
    if (horizontalContainer) {
      if (this.currentTab === 'favorites' || this.currentTab === 'recents' || !categoriesToRender || categoriesToRender.length === 0) {
        horizontalContainer.classList.add('hidden');
      } else {
        horizontalContainer.classList.remove('hidden');
        let hHtml = '';

        // Unified Spain Chip
        const isSpainActive = this.currentCategory && this.currentCategory.startsWith('unified_');
        hHtml += `
          <button class="category-chip ${isSpainActive ? 'active' : ''} focusable flex items-center gap-1.5 font-bold" data-chip-action="spain">
            <span>🇪🇸</span>
            <span>Todo Spain</span>
          </button>
        `;

        // All Channels Chip
        hHtml += `
          <button class="category-chip ${this.currentCategory === 'all' ? 'active' : ''} focusable flex items-center gap-1.5" data-cat-id="all">
            <span>🌐</span>
            <span>Todos (${this.streams.length})</span>
          </button>
        `;

        // Each individual category chip
        categoriesToRender.forEach(cat => {
          const catId = String(cat.category_id);
          const catName = cat.category_name;
          const count = counts[catId] || 0;
          const isActive = String(this.currentCategory) === catId;
          hHtml += `
            <button class="category-chip ${isActive ? 'active' : ''} focusable flex items-center gap-1.5 whitespace-nowrap" data-cat-id="${catId}">
              <span>${catName}</span>
              <span class="opacity-75 text-[10px] ml-1 bg-black/40 px-1.5 py-0.5 rounded-full font-bold">${count}</span>
            </button>
          `;
        });

        horizontalContainer.innerHTML = hHtml;

        // Attach click events to horizontal category chips
        horizontalContainer.querySelectorAll('.category-chip[data-cat-id]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const catId = e.currentTarget.getAttribute('data-cat-id');
            this.selectCategory(catId);
          });
        });

        horizontalContainer.querySelector('.category-chip[data-chip-action="spain"]')?.addEventListener('click', () => {
          this.selectUnifiedCountry('spain');
        });
      }
    }
  },

  filterCategories(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      this.renderCategoryList(this.categories);
    } else {
      const filtered = this.categories.filter(c => (c.category_name || '').toLowerCase().includes(q));
      this.renderCategoryList(filtered, q);
    }
  },

  async selectUnifiedCountry(countryKeyword) {
    if (this.currentTab === 'favorites' || this.currentTab === 'recents') {
      await this.switchTab(this.lastContentTab || 'live');
    }
    const kw = countryKeyword.toLowerCase().trim();
    const matched = this.categories.filter(c => {
      const name = (c.category_name || '').toLowerCase();
      return name.includes(kw) || name.includes('españa') || name.startsWith('es:') || name.startsWith('es |') || name.startsWith('es-') || name.startsWith('spain');
    });

    if (!matched.length) {
      this.showToast('No se encontraron grupos para ' + countryKeyword);
      return;
    }

    const catSearch = document.getElementById('categorySearchInput');
    if (catSearch) catSearch.value = countryKeyword;

    this.renderCategoryList(matched, countryKeyword);
    this.selectUnifiedCategory(countryKeyword, matched);
    this.toggleMobileSidebar(false);
  },

  selectUnifiedCategory(query, matchedCategories) {
    const q = query.toLowerCase().trim();
    this.currentCategory = 'unified_' + q;
    this.currentCategoryUnifiedName = q.includes('spain') || q.includes('es')
      ? '🇪🇸 Todo Spain / España'
      : `🎯 Todo "${query.toUpperCase()}"`;
    this.currentMatchedCount = matchedCategories.length;

    const catIds = new Set(matchedCategories.map(c => String(c.category_id)));
    this.filteredStreams = this.streams.filter(s => catIds.has(String(s.category_id)));

    // Highlight sidebar and horizontal chip items
    document.querySelectorAll('.category-nav-item').forEach(c => {
      const isMatch = c.getAttribute('data-unified-query') === query;
      c.classList.toggle('active', isMatch);
    });
    document.querySelectorAll('.category-chip').forEach(c => {
      const isSpainMatch = c.getAttribute('data-chip-action') === 'spain';
      c.classList.toggle('active', isSpainMatch);
    });

    this.initStreamGrid();
    this.showToast(`⭐ Cargados ${this.filteredStreams.length} canales de ${matchedCategories.length} grupos.`);
  },

  toggleMobileSidebar(isOpen) {
    const sidebar = document.getElementById('categorySidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar) return;

    if (isOpen) {
      sidebar.classList.add('sidebar-open');
      backdrop?.classList.remove('hidden');
    } else {
      sidebar.classList.remove('sidebar-open');
      backdrop?.classList.add('hidden');
    }
  },

  async selectCategory(catId) {
    if (this.currentTab === 'favorites' || this.currentTab === 'recents') {
      await this.switchTab(this.lastContentTab || 'live');
    }
    this.currentCategory = catId;
    document.querySelectorAll('.category-nav-item').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-cat-id') === String(catId));
    });
    document.querySelectorAll('.category-chip').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-cat-id') === String(catId));
    });

    if (catId === 'all') {
      this.filteredStreams = [...this.streams];
    } else {
      this.filteredStreams = this.streams.filter(s => String(s.category_id) === String(catId));
    }
    this.initStreamGrid();
  },

  filterStreams(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      this.filteredStreams = this.currentCategory === 'all'
        ? [...this.streams]
        : this.streams.filter(s => String(s.category_id) === String(this.currentCategory));
    } else {
      this.filteredStreams = this.streams.filter(s => (s.name || '').toLowerCase().includes(q));
    }
    this.initStreamGrid();
  },

  // Initialize and render first batch
  initStreamGrid() {
    this.updateCategoryToolbar();
    const grid = document.getElementById('streamGrid');
    if (!grid) return;

    // Reset infinite scroll state
    this.renderedCount = 0;
    grid.innerHTML = '';

    // Remove existing sentinel if any
    document.getElementById('scrollSentinel')?.remove();

    if (!this.filteredStreams || this.filteredStreams.length === 0) {
      this.renderEmptyGrid('No se encontraron canales o contenidos en esta categoría.');
      return;
    }

    // Render first batch
    this.appendNextBatch();

    // Create sentinel for infinite scroll
    const sentinel = document.createElement('div');
    sentinel.id = 'scrollSentinel';
    sentinel.className = 'col-span-full h-8 w-full';
    grid.parentNode.appendChild(sentinel);
    this.observer.observe(sentinel);
  },

  // Append next slice of cards
  appendNextBatch() {
    const grid = document.getElementById('streamGrid');
    if (!grid) return;

    const start = this.renderedCount;
    const end = Math.min(start + this.PAGE_SIZE, this.filteredStreams.length);
    if (start >= end) return;

    const batch = this.filteredStreams.slice(start, end);
    const fragment = document.createDocumentFragment();

    const isSeries = this.currentTab === 'series';
    const isVod = this.currentTab === 'vod';

    batch.forEach((item, i) => {
      const overallIndex = start + i;
      const isFav = Storage.isFavorite(item.stream_id);
      const poster = item.stream_icon || item.cover || '';

      const card = document.createElement('div');
      card.className = 'stream-card group focusable';
      card.setAttribute('data-stream-index', overallIndex);
      card.tabIndex = 0;

      card.innerHTML = `
        <div class="stream-poster-wrap">
          ${poster 
            ? `<img src="${poster}" alt="${item.name}" loading="lazy" decoding="async" class="stream-poster" onerror="this.onerror=null;this.src='/icons/icon.svg';">`
            : `<div class="stream-poster-placeholder"><span>${(item.name || 'TV').slice(0, 3).toUpperCase()}</span></div>`
          }
          <div class="stream-card-overlay">
            <button class="play-card-btn" title="Reproducir">
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
          <button class="fav-star-btn ${isFav ? 'active' : ''}" data-fav-id="${item.stream_id}" title="Favorito">
            <svg class="w-5 h-5" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
            </svg>
          </button>
        </div>
        <div class="stream-card-details">
          <h3 class="stream-title" title="${item.name}">${item.name || 'Sin título'}</h3>
          <span class="stream-sub">${isSeries ? 'Serie' : isVod ? 'Película' : 'En vivo'}</span>
        </div>
      `;

      // Event delegation on card
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-star-btn')) {
          e.stopPropagation();
          this.toggleFavorite(item);
          const starBtn = card.querySelector('.fav-star-btn');
          const isNowFav = Storage.isFavorite(item.stream_id);
          starBtn.classList.toggle('active', isNowFav);
          starBtn.querySelector('svg').setAttribute('fill', isNowFav ? 'currentColor' : 'none');
          return;
        }
        this.onStreamSelected(overallIndex);
      });

      fragment.appendChild(card);
    });

    grid.appendChild(fragment);
    this.renderedCount = end;
  },

  onStreamSelected(index) {
    const item = this.filteredStreams[index];
    if (!item) return;

    this.currentChannelIndex = index;

    const isSeries = item.series_id || item.stream_type === 'series' || this.currentTab === 'series';
    const isVod = item.stream_type === 'movie' || item.stream_type === 'vod' || this.currentTab === 'vod';

    if (isSeries) {
      this.openSeriesModal(item);
    } else {
      this.player.play(item, this.activeProfile, isVod ? 'vod' : 'live');
      this.updateDrawerChannelsList();
    }
  },

  toggleFavorite(item) {
    Storage.toggleFavorite(item);
    this.updateFavoritesBadges();
    if (this.currentTab === 'favorites') {
      this.streams = Storage.getFavorites(this.activeFavSubTab);
      this.filteredStreams = [...this.streams];
      this.renderFavoritesSidebarCategories();
      this.initStreamGrid();
    }
  },

  nextChannel() {
    if (!this.filteredStreams.length) return;
    this.currentChannelIndex = (this.currentChannelIndex + 1) % this.filteredStreams.length;
    const item = this.filteredStreams[this.currentChannelIndex];
    this.player.play(item, this.activeProfile, 'live');
    this.updateDrawerChannelsList();
  },

  prevChannel() {
    if (!this.filteredStreams.length) return;
    this.currentChannelIndex = (this.currentChannelIndex - 1 + this.filteredStreams.length) % this.filteredStreams.length;
    const item = this.filteredStreams[this.currentChannelIndex];
    this.player.play(item, this.activeProfile, 'live');
    this.updateDrawerChannelsList();
  },

  toggleChannelDrawer(forcedState) {
    const drawer = document.getElementById('channelDrawer');
    if (!drawer) return;
    const isOpen = drawer.classList.contains('drawer-open');
    const newState = forcedState !== undefined ? forcedState : !isOpen;
    drawer.classList.toggle('drawer-open', newState);
    if (newState) {
      this.updateDrawerChannelsList();
    }
  },

  updateDrawerChannelsList() {
    const container = document.getElementById('drawerChannelList');
    if (!container) return;

    // Show a slice of around 60 channels around current index for speed
    const total = this.filteredStreams.length;
    const start = Math.max(0, this.currentChannelIndex - 20);
    const end = Math.min(total, start + 60);

    let html = '';
    for (let idx = start; idx < end; idx++) {
      const stream = this.filteredStreams[idx];
      const isCurrent = idx === this.currentChannelIndex;
      html += `
        <div class="drawer-channel-item ${isCurrent ? 'active' : ''}" data-idx="${idx}">
          <span class="drawer-num">${idx + 1}</span>
          <span class="drawer-name">${stream.name}</span>
        </div>
      `;
    }
    container.innerHTML = html;

    container.querySelectorAll('.drawer-channel-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        this.onStreamSelected(idx);
        this.toggleChannelDrawer(false);
      });
    });

    const activeEl = container.querySelector('.drawer-channel-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  closePlayer() {
    this.player.stop();
    this.toggleChannelDrawer(false);
  },

  // Series Details & Episodes Modal
  async openSeriesModal(seriesItem) {
    const modal = document.getElementById('seriesModal');
    const content = document.getElementById('seriesModalContent');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    content.innerHTML = `
      <div class="flex items-center justify-center p-12">
        <div class="spinner"></div>
        <span class="ml-4 text-gray-300">Cargando temporadas y capítulos...</span>
      </div>
    `;

    try {
      const info = await Api.getSeriesInfo(this.activeProfile, seriesItem.series_id);
      if (!info || !info.episodes) {
        content.innerHTML = `<p class="p-8 text-center text-gray-400">No se encontraron episodios disponibles.</p>`;
        return;
      }

      let episodesHtml = '';
      const seasons = Object.keys(info.episodes);

      seasons.forEach(seasonNum => {
        const eps = info.episodes[seasonNum] || [];
        episodesHtml += `
          <div class="mb-6">
            <h4 class="text-lg font-bold text-cyan-400 mb-3 border-b border-gray-700 pb-1">Temporada ${seasonNum}</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              ${eps.map(ep => `
                <div class="episode-card flex items-center justify-between p-3 rounded-lg bg-gray-800 hover:bg-gray-700 cursor-pointer" data-ep-id="${ep.id}" data-ep-ext="${ep.container_extension || 'mp4'}">
                  <div>
                    <span class="font-semibold text-white">E${ep.episode_num || ''} - ${ep.title || 'Episodio'}</span>
                  </div>
                  <button class="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-bold text-white">Ver</button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });

      content.innerHTML = `
        <div class="flex flex-col md:flex-row gap-6 mb-6">
          <img src="${seriesItem.cover || ''}" class="w-40 h-56 object-cover rounded-lg shadow-lg" onerror="this.src='/icons/icon.svg'">
          <div>
            <h2 class="text-2xl font-bold text-white mb-2">${seriesItem.name}</h2>
            <p class="text-sm text-gray-400 mb-4">${info.info?.plot || 'Sin descripción disponible.'}</p>
            <div class="text-xs text-gray-500">
              <span>Género: ${info.info?.genre || 'N/A'}</span> • <span>Año: ${info.info?.releaseDate || 'N/A'}</span>
            </div>
          </div>
        </div>
        <div class="episodes-container max-h-96 overflow-y-auto pr-2">
          ${episodesHtml}
        </div>
      `;

      content.querySelectorAll('.episode-card').forEach(card => {
        card.addEventListener('click', (e) => {
          const epId = card.getAttribute('data-ep-id');
          const ext = card.getAttribute('data-ep-ext');
          const title = card.querySelector('.font-semibold').textContent;
          modal.classList.add('hidden');
          this.player.play({
            stream_id: epId,
            name: `${seriesItem.name} - ${title}`,
            container_extension: ext,
            stream_type: 'series'
          }, this.activeProfile, 'series');
        });
      });

    } catch (e) {
      content.innerHTML = `<p class="p-8 text-center text-red-400">Error al obtener información de la serie: ${e.message}</p>`;
    }
  },

  // Xtream Codes Login & Profile Modal
  openLoginModal(firstTime = false) {
    const modal = document.getElementById('loginModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    this.renderProfilesList();
    const errBox = document.getElementById('loginError');
    if (errBox) errBox.classList.add('hidden');
  },

  renderProfilesList() {
    const list = document.getElementById('savedProfilesList');
    if (!list) return;

    const profiles = Storage.getProfiles();
    if (!profiles.length) {
      list.innerHTML = `<p class="text-xs text-gray-500">No hay cuentas guardadas aún.</p>`;
      return;
    }

    let html = '';
    profiles.forEach(p => {
      const isActive = this.activeProfile?.id === p.id;
      html += `
        <div class="flex items-center justify-between p-2 rounded bg-gray-800 mb-2">
          <div class="cursor-pointer flex-1" onclick="App.selectProfile('${p.id}')">
            <span class="font-bold text-sm ${isActive ? 'text-cyan-400' : 'text-gray-200'}">${p.name || p.username}</span>
            <span class="block text-xs text-gray-500">${p.serverUrl}</span>
          </div>
          <button class="text-red-400 hover:text-red-300 text-xs px-2" onclick="App.deleteProfile('${p.id}')">Borrar</button>
        </div>
      `;
    });
    list.innerHTML = html;
  },

  async handleLoginSubmit(e) {
    e.preventDefault();
    const serverUrl = document.getElementById('loginServer').value.trim();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();
    const profileName = document.getElementById('loginName').value.trim() || username;

    const errBox = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando con el servidor...';
    if (errBox) errBox.classList.add('hidden');

    try {
      const res = await Api.testConnection(serverUrl, username, password);
      if (!res.success) {
        throw new Error(res.error || 'No se pudo conectar.');
      }

      const profile = {
        name: profileName,
        serverUrl,
        username,
        password,
        isDemo: false,
        userInfo: res.data?.user_info,
        serverInfo: res.data?.server_info
      };

      const saved = Storage.saveProfile(profile);
      Storage.setActiveProfileId(saved.id);
      this.activeProfile = saved;

      this.updateProfileUi();
      this.closeModals();
      await this.loadCurrentTab();
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Conectar Lista Xtream';
    }
  },

  startDemoMode() {
    const demoProfile = {
      id: 'demo_profile',
      name: 'Modo Demo (Pruebas)',
      serverUrl: 'https://demo-iptv.local',
      username: 'demo',
      password: 'demo',
      isDemo: true
    };
    Storage.saveProfile(demoProfile);
    Storage.setActiveProfileId(demoProfile.id);
    this.activeProfile = demoProfile;

    this.updateProfileUi();
    this.closeModals();
    this.loadCurrentTab();
  },

  selectProfile(id) {
    const profiles = Storage.getProfiles();
    const found = profiles.find(p => p.id === id);
    if (found) {
      Storage.setActiveProfileId(id);
      this.activeProfile = found;
      this.updateProfileUi();
      this.closeModals();
      this.loadCurrentTab();
    }
  },

  deleteProfile(id) {
    Storage.deleteProfile(id);
    this.renderProfilesList();
    if (this.activeProfile?.id === id) {
      this.activeProfile = Storage.getActiveProfile();
      this.updateProfileUi();
      this.loadCurrentTab();
    }
  },

  updateProfileUi() {
    const nameEl = document.getElementById('currentProfileName');
    if (nameEl) {
      nameEl.textContent = this.activeProfile ? this.activeProfile.name : 'Sin cuenta';
    }
  },

  openSettingsModal() {
    document.getElementById('settingsModal')?.classList.remove('hidden');
  },

  closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  },

  showLoadingGrid(isLoading) {
    const spinner = document.getElementById('gridSpinner');
    const grid = document.getElementById('streamGrid');
    if (spinner) spinner.classList.toggle('hidden', !isLoading);
    if (grid && isLoading) grid.innerHTML = '';
  },

  renderEmptyGrid(message) {
    const grid = document.getElementById('streamGrid');
    if (!grid) return;
    grid.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center p-12 text-center text-gray-400">
        <svg class="w-16 h-16 mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        <p class="text-base">${message}</p>
      </div>
    `;
  },

  // Category Toolbar & Batch Favorites Management
  updateCategoryToolbar() {
    const titleEl = document.getElementById('currentCategoryTitle');
    const badgeEl = document.getElementById('currentCategoryBadge');
    const favBtn = document.getElementById('favoriteCountryBtn');
    const favBtnText = document.getElementById('favoriteCountryBtnText');
    const clearBtn = document.getElementById('clearFavoritesBtn');

    if (!titleEl) return;

    if (this.currentTab === 'favorites') {
      titleEl.textContent = '⭐ Mis Favoritos';
      badgeEl.textContent = `${this.filteredStreams.length} guardados`;
      if (favBtn) favBtn.classList.add('hidden');
      if (clearBtn) clearBtn.classList.toggle('hidden', this.filteredStreams.length === 0);
      return;
    }

    if (clearBtn) clearBtn.classList.add('hidden');
    if (favBtn) favBtn.classList.remove('hidden');

    let categoryName = 'Todos los canales';
    let isUnified = false;

    if (this.currentCategory && this.currentCategory.startsWith('unified_')) {
      categoryName = this.currentCategoryUnifiedName || 'Todo el país';
      isUnified = true;
    } else if (this.currentCategory !== 'all') {
      const found = this.categories.find(c => String(c.category_id) === String(this.currentCategory));
      if (found) categoryName = found.category_name;
    }

    titleEl.textContent = categoryName;
    badgeEl.textContent = isUnified
      ? `${this.filteredStreams.length} canales (${this.currentMatchedCount || ''} grupos combinados)`
      : `${this.filteredStreams.length} ${this.currentTab === 'series' ? 'series' : this.currentTab === 'vod' ? 'películas' : 'canales'}`;

    // Update favorite button state
    const isAllFav = this.filteredStreams.length > 0 && Storage.isCategoryFavorited(this.filteredStreams);
    if (favBtn && favBtnText) {
      if (isAllFav) {
        favBtnText.textContent = `Quitar todo ${categoryName} de Favoritos`;
        favBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/40 transition-all focusable';
      } else {
        favBtnText.textContent = isUnified
          ? `⭐ Guardar todo "${categoryName}" en Favoritos (${this.filteredStreams.length})`
          : (this.currentCategory === 'all' ? 'Guardar lista en Favoritos' : 'Guardar grupo en Favoritos');
        favBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600/50 to-cyan-600/50 hover:from-indigo-600/70 hover:to-cyan-600/70 text-cyan-200 border border-cyan-500/50 transition-all focusable shadow-md';
      }
    }
  },

  toggleCategoryFavorites() {
    if (!this.filteredStreams || !this.filteredStreams.length) {
      this.showToast('No hay elementos en esta lista para guardar.');
      return;
    }

    const isAllFav = Storage.isCategoryFavorited(this.filteredStreams);
    let categoryName = 'esta lista';
    if (this.currentCategory && this.currentCategory.startsWith('unified_')) {
      categoryName = this.currentCategoryUnifiedName || 'Todo el país';
    } else if (this.currentCategory !== 'all') {
      const found = this.categories.find(c => String(c.category_id) === String(this.currentCategory));
      if (found) categoryName = found.category_name;
    }

    if (isAllFav) {
      const removed = Storage.removeCategoryFavorites(this.filteredStreams);
      this.showToast(`Eliminados ${removed} canales de ${categoryName} de Favoritos.`);
    } else {
      const added = Storage.addCategoryFavorites(this.filteredStreams);
      this.showToast(`⭐ ¡Guardados ${added} canales de ${categoryName} en Favoritos!`);
    }

    this.initStreamGrid();
  },

  handleClearFavorites() {
    if (confirm('¿Estás seguro de que deseas vaciar todos tus canales favoritos?')) {
      Storage.clearFavorites();
      this.streams = [];
      this.filteredStreams = [];
      this.initStreamGrid();
      this.showToast('Lista de favoritos vaciada.');
    }
  },

  openIosModal() {
    document.getElementById('iosModal')?.classList.remove('hidden');
  },

  showToast(message, duration = 3000) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.className = 'fixed bottom-20 md:bottom-8 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-gray-900/95 text-white text-xs font-bold shadow-2xl border border-cyan-500/40 backdrop-blur-md transition-all duration-300 pointer-events-none opacity-0';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-2');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
    }, duration);
  },

  async loadServerInfo() {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      if (data && data.localIps && data.localIps.length) {
        const ip = data.localIps[0];
        const port = data.port || 3000;
        const url = `http://${ip}:${port}`;
        document.querySelectorAll('.server-lan-ip').forEach(el => {
          el.textContent = url;
          if (el.tagName === 'A') el.href = url;
        });
      }
    } catch (e) {}
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
