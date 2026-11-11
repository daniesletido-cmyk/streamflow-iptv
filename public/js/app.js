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
      try {
        const sRes = await fetch('/api/saved-profile');
        const sData = await sRes.json();
        if (sData && sData.profile) {
          Storage.saveProfile(sData.profile);
          Storage.setActiveProfileId(sData.profile.id);
          this.activeProfile = sData.profile;
        }
      } catch (e) {}
    }

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
    this.renderContinueWatching();
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
      b.classList.toggle('text-[#f4f6f9]', match);
      b.classList.toggle('bg-[#161a22]', match);
      b.classList.toggle('border', match);
      b.classList.toggle('border-white/[0.12]', match);
      b.classList.toggle('text-[#9aa4b2]', !match);
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
            <span class="text-sm shrink-0">${isSpain ? '🇪🇸' : '•'}</span>
            <div class="flex flex-col min-w-0">
              <span class="category-nav-title font-semibold text-sky-400">Todo "${query.toUpperCase()}" (${categoriesToRender.length})</span>
              <span class="text-[11px] text-[#647082]">Ver grupos combinados</span>
            </div>
          </div>
          <span class="category-nav-badge">${totalInMatching}</span>
        </div>
      `;
    }

    // All channels option (if not searching)
    if (!query) {
      html += `
        <div class="category-nav-item ${this.currentCategory === 'all' ? 'active' : ''} focusable" data-cat-id="all">
          <div class="flex items-center gap-2.5 min-w-0">
            <svg class="w-4 h-4 opacity-60 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>
            <span class="category-nav-title">Todos los contenidos</span>
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
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-1.5 h-1.5 rounded-full ${isActive ? 'bg-sky-400' : 'bg-[#647082]/50'} shrink-0"></span>
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
          <button class="category-chip ${isSpainActive ? 'active' : ''} focusable flex items-center gap-1.5 font-medium" data-chip-action="spain">
            <span>🇪🇸</span>
            <span>Spain</span>
          </button>
        `;

        // All Channels Chip
        hHtml += `
          <button class="category-chip ${this.currentCategory === 'all' ? 'active' : ''} focusable flex items-center gap-1.5" data-cat-id="all">
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
              <span class="opacity-70 text-[10px] ml-0.5 bg-white/[0.06] px-1.5 py-0.5 rounded font-semibold tabular-nums">${count}</span>
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
    this.renderContinueWatching();
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
      const targetId = String(item.stream_id || item.series_id);
      const isFav = Storage.isFavorite(targetId);
      const isWatched = Storage.isWatched(targetId);
      const inProgress = Storage.getPlaybackProgress(targetId);
      const poster = item.stream_icon || item.cover || '';

      const card = document.createElement('div');
      card.className = 'stream-card group focusable';
      card.setAttribute('data-stream-index', overallIndex);
      card.tabIndex = 0;

      card.innerHTML = `
        <div class="stream-poster-wrap relative">
          ${poster 
            ? `<img src="${poster}" alt="${item.name}" loading="lazy" decoding="async" class="stream-poster" onerror="this.onerror=null;this.src='/icons/icon.svg';">`
            : `<div class="stream-poster-placeholder"><span>${(item.name || 'TV').slice(0, 3).toUpperCase()}</span></div>`
          }

          ${isWatched ? `
            <div class="watched-indicator absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded bg-[#090b0f]/85 border border-emerald-500/40 text-emerald-400 text-[10px] font-semibold backdrop-blur-md pointer-events-none">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
              <span>${isSeries ? 'Finalizada' : 'Vista'}</span>
            </div>
          ` : ''}

          ${(inProgress && inProgress.progress > 0 && !isWatched) ? `
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-10 overflow-hidden">
              <div class="h-full bg-sky-400" style="width: ${inProgress.progress}%"></div>
            </div>
          ` : ''}

          <div class="stream-card-overlay">
            <button class="play-card-btn" title="Reproducir">
              <svg class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>

          <button class="fav-star-btn ${isFav ? 'active' : ''}" data-fav-id="${targetId}" title="Favorito">
            <svg class="w-4 h-4" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
            </svg>
          </button>

          ${(isVod || isSeries) ? `
            <button class="watched-toggle-btn ${isWatched ? 'active text-emerald-400 border-emerald-500/40' : 'text-[#9aa4b2] border-white/[0.08]'} absolute bottom-2 right-2 z-20 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full bg-[#090b0f]/75 hover:bg-[#090b0f]/95 hover:text-emerald-400 border backdrop-blur-md transition-colors" data-watched-id="${targetId}" title="${isWatched ? 'Marcar como no visto' : 'Marcar como visto'}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M5 13l4 4L19 7"/></svg>
            </button>
          ` : ''}
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
          const isNowFav = Storage.isFavorite(targetId);
          starBtn.classList.toggle('active', isNowFav);
          starBtn.querySelector('svg').setAttribute('fill', isNowFav ? 'currentColor' : 'none');
          return;
        }

        if (e.target.closest('.watched-toggle-btn')) {
          e.stopPropagation();
          const nowWatched = Storage.toggleWatched(targetId, {
            stream_type: isSeries ? 'series' : 'movie',
            name: item.name || item.title,
            cover: item.cover || item.stream_icon
          });
          this.refreshWatchedBadges();
          this.renderContinueWatching();
          this.showToast(nowWatched ? `✓ Marcado como visto: ${item.name}` : `Marcado como pendiente: ${item.name}`);
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

  renderContinueWatching() {
    const section = document.getElementById('continueWatchingSection');
    const slider = document.getElementById('continueWatchingSlider');
    const badge = document.getElementById('continueWatchingBadge');
    if (!section || !slider) return;

    if (this.currentTab === 'live') {
      section.classList.add('hidden');
      return;
    }

    const filterType = (this.currentTab === 'vod') 
      ? 'movie' 
      : (this.currentTab === 'series') 
        ? 'series' 
        : null;

    const items = Storage.getContinueWatching(filterType);
    if (!items || items.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    if (badge) badge.textContent = items.length;

    slider.innerHTML = items.map(item => {
      const poster = item.cover || item.stream_icon || '/icons/icon.svg';
      const isSeries = item.stream_type === 'series' || item.series_id;
      const subtitle = isSeries 
        ? `${item.series_name || item.name} • T${item.season_num || 1}:E${item.episode_num || 1}`
        : `${Math.round(item.currentTime / 60)} min / ${Math.round(item.duration / 60)} min`;
      const title = isSeries ? (item.name || item.series_name) : item.name;

      return `
        <div class="continue-card flex-shrink-0 w-44 sm:w-52 bg-[#161a22] hover:bg-[#1c212c] border border-white/[0.08] hover:border-white/[0.16] rounded-lg overflow-hidden transition-all group relative cursor-pointer" data-continue-id="${item.id}">
          <button class="remove-continue-btn absolute top-1.5 right-1.5 z-20 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-full bg-[#090b0f]/75 hover:bg-red-950/90 text-[#9aa4b2] hover:text-red-300 border border-white/[0.08] transition-colors" data-remove-id="${item.id}" title="Quitar de continuar viendo">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          
          <div class="relative w-full h-28 sm:h-32 bg-[#0b0d12] overflow-hidden">
            <img src="${poster}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" onerror="this.src='/icons/icon.svg'">
            <div class="absolute inset-0 bg-gradient-to-t from-[#090b0f]/80 via-transparent to-transparent"></div>
            
            <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div class="w-10 h-10 rounded-full bg-white/95 text-[#090b0f] flex items-center justify-center shadow-lg">
                <svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>

            <!-- Progress bar -->
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
              <div class="h-full bg-sky-400" style="width: ${item.progress || 0}%"></div>
            </div>
          </div>

          <div class="p-2.5 border-t border-white/[0.04]">
            <h4 class="text-xs sm:text-sm font-semibold text-[#f4f6f9] truncate" title="${title}">${title}</h4>
            <div class="flex items-center justify-between mt-1 text-[11px] text-[#9aa4b2]">
              <span class="truncate">${subtitle}</span>
              <span class="font-semibold text-sky-400 ml-1 shrink-0 tabular-nums">${item.progress}%</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners
    slider.querySelectorAll('.continue-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.remove-continue-btn')) {
          e.stopPropagation();
          const removeId = card.getAttribute('data-continue-id');
          Storage.removeContinueWatching(removeId);
          this.renderContinueWatching();
          return;
        }

        const id = card.getAttribute('data-continue-id');
        const item = items.find(it => String(it.id) === String(id));
        if (item) {
          this.player.play(item, this.activeProfile, item.stream_type || 'movie', item);
        }
      });
    });

    const clearBtn = document.getElementById('clearContinueWatchingBtn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        if (confirm('¿Vaciar la lista de continuar viendo?')) {
          items.forEach(it => Storage.removeContinueWatching(it.id));
          this.renderContinueWatching();
        }
      };
    }
  },

  refreshWatchedBadges() {
    const cards = document.querySelectorAll('.stream-card');
    cards.forEach(card => {
      const idx = card.getAttribute('data-stream-index');
      const item = this.filteredStreams ? this.filteredStreams[idx] : null;
      if (!item) return;

      const targetId = String(item.stream_id || item.series_id);
      const isWatched = Storage.isWatched(targetId);
      const existingBadge = card.querySelector('.watched-indicator');

      if (isWatched && !existingBadge) {
        const posterWrap = card.querySelector('.stream-poster-wrap');
        if (posterWrap) {
          const badge = document.createElement('div');
          badge.className = 'watched-indicator absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded bg-[#090b0f]/85 border border-emerald-500/40 text-emerald-400 text-[10px] font-semibold backdrop-blur-md pointer-events-none';
          badge.innerHTML = `
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>
            <span>${this.currentTab === 'series' ? 'Finalizada' : 'Vista'}</span>
          `;
          posterWrap.appendChild(badge);
        }
      } else if (!isWatched && existingBadge) {
        existingBadge.remove();
      }

      const watchBtn = card.querySelector('.watched-toggle-btn');
      if (watchBtn) {
        watchBtn.classList.toggle('active', isWatched);
        watchBtn.classList.toggle('text-emerald-400', isWatched);
        watchBtn.setAttribute('title', isWatched ? 'Marcar como no visto' : 'Marcar como visto');
      }
    });
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
            <h4 class="text-sm font-semibold text-[#f4f6f9] mb-3 border-b border-white/[0.08] pb-2 flex items-center justify-between">
              <span>Temporada ${seasonNum}</span>
              <span class="text-xs text-[#647082] font-normal tabular-nums">${eps.length} capítulos</span>
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              ${eps.map(ep => {
                const epIdStr = String(ep.id);
                const isEpWatched = Storage.isWatched(epIdStr);
                const epProgress = Storage.getPlaybackProgress(epIdStr);

                return `
                <div class="episode-card relative flex items-center justify-between min-h-[54px] p-3 rounded-lg bg-[#161a22] hover:bg-[#1c212c] border border-white/[0.08] hover:border-white/[0.16] cursor-pointer transition-colors overflow-hidden" data-ep-id="${ep.id}" data-ep-ext="${ep.container_extension || 'mp4'}" data-ep-num="${ep.episode_num || ''}" data-season-num="${seasonNum}">
                  <div class="flex items-center gap-2.5 overflow-hidden pr-2">
                    <span class="text-xs font-semibold px-2 py-1 rounded bg-[#0c0f14] text-[#9aa4b2] border border-white/[0.06] shrink-0 tabular-nums">E${ep.episode_num || ''}</span>
                    <div class="overflow-hidden">
                      <span class="font-medium text-[#f4f6f9] text-sm truncate block">${ep.title || 'Episodio ' + (ep.episode_num || '')}</span>
                      ${isEpWatched ? `
                        <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">✓ Visto</span>
                      ` : (epProgress && epProgress.progress > 0) ? `
                        <span class="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 tabular-nums">En progreso (${epProgress.progress}%)</span>
                      ` : ''}
                    </div>
                  </div>
                  
                  <div class="flex items-center gap-2 shrink-0">
                    <button class="toggle-ep-watch-btn min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg ${isEpWatched ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/40' : 'bg-[#0c0f14] text-[#9aa4b2] hover:text-emerald-400 border border-white/[0.08]'} transition-colors" data-ep-id="${ep.id}" title="${isEpWatched ? 'Marcar como no visto' : 'Marcar como visto'}">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M5 13l4 4L19 7"/></svg>
                    </button>
                    <button class="play-ep-btn min-h-[36px] px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 rounded-lg text-xs font-semibold text-[#090b0f] transition-colors">Ver</button>
                  </div>

                  ${(epProgress && epProgress.progress > 0 && !isEpWatched) ? `
                    <div class="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                      <div class="h-full bg-sky-400" style="width: ${epProgress.progress}%"></div>
                    </div>
                  ` : ''}
                </div>
              `;
              }).join('')}
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
          const epNum = card.getAttribute('data-ep-num');
          const sNum = card.getAttribute('data-season-num');
          const title = card.querySelector('.font-semibold')?.textContent || 'Episodio';

          if (e.target.closest('.toggle-ep-watch-btn')) {
            e.stopPropagation();
            const nowWatched = Storage.toggleWatched(epId, {
              stream_type: 'series',
              series_id: seriesItem.series_id,
              episode_id: epId,
              name: `${seriesItem.name} - E${epNum}`
            });
            this.openSeriesModal(seriesItem);
            this.refreshWatchedBadges();
            this.renderContinueWatching();
            return;
          }

          modal.classList.add('hidden');
          this.player.play({
            stream_id: epId,
            name: `${seriesItem.name} - ${title}`,
            container_extension: ext,
            stream_type: 'series'
          }, this.activeProfile, 'series', {
            series_id: seriesItem.series_id,
            series_name: seriesItem.name,
            episode_id: epId,
            season_num: sNum,
            episode_num: epNum,
            cover: seriesItem.cover,
            container_extension: ext
          });
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

    // Prefill fields if a profile is already known
    const current = this.activeProfile || Storage.getActiveProfile();
    if (current) {
      const nameInput = document.getElementById('loginName');
      const serverInput = document.getElementById('loginServer');
      const userInput = document.getElementById('loginUser');
      const passInput = document.getElementById('loginPass');
      if (nameInput && !nameInput.value) nameInput.value = current.name || '';
      if (serverInput && !serverInput.value) serverInput.value = current.serverUrl || '';
      if (userInput && !userInput.value) userInput.value = current.username || '';
      if (passInput && !passInput.value) passInput.value = current.password || '';
    }

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
        <div class="flex items-center justify-between min-h-[48px] p-2.5 rounded-lg bg-[#161a22] border ${isActive ? 'border-sky-500/40' : 'border-white/[0.08]'} mb-2">
          <div class="cursor-pointer flex-1 min-w-0 pr-2" onclick="App.selectProfile('${p.id}')">
            <span class="font-semibold text-sm block truncate ${isActive ? 'text-sky-400' : 'text-[#f4f6f9]'}">${p.name || p.username}</span>
            <span class="block text-xs text-[#647082] truncate">${p.serverUrl}</span>
          </div>
          <button class="min-h-[34px] px-2.5 text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded text-xs font-medium transition-colors" onclick="App.deleteProfile('${p.id}')">Borrar</button>
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

      // Persist to server for zero-relogin experience on all devices
      fetch('/api/saved-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: saved })
      }).catch(() => {});

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
        favBtnText.textContent = `Quitar ${categoryName} de Favoritos`;
        favBtn.className = 'min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-950/40 hover:bg-amber-950/60 text-amber-300 border border-amber-700/40 transition-colors focusable';
      } else {
        favBtnText.textContent = isUnified
          ? `Guardar "${categoryName}" (${this.filteredStreams.length})`
          : (this.currentCategory === 'all' ? 'Guardar lista en Favoritos' : 'Guardar grupo en Favoritos');
        favBtn.className = 'min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#161a22] hover:bg-[#1c212c] text-[#f4f6f9] border border-white/[0.1] transition-colors focusable';
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
      toast.className = 'fixed bottom-20 md:bottom-8 left-1/2 transform -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-[#161a22]/95 text-[#f4f6f9] text-xs font-medium shadow-xl border border-white/[0.12] backdrop-blur-md transition-all duration-300 pointer-events-none opacity-0';
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
