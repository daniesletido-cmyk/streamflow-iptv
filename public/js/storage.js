/**
 * StreamFlow IPTV - Local Storage & Profile Management
 * Includes Separated Favorites for Live TV, Movies & Series
 */
const Storage = {
  KEYS: {
    PROFILES: 'streamflow_profiles',
    ACTIVE_PROFILE_ID: 'streamflow_active_profile',
    FAVORITES: 'streamflow_favorites',
    RECENTS: 'streamflow_recents',
    SETTINGS: 'streamflow_settings'
  },

  // 1. Profiles
  getProfiles() {
    try {
      const data = localStorage.getItem(this.KEYS.PROFILES);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  setCookieProfile(profile) {
    try {
      const val = encodeURIComponent(JSON.stringify(profile));
      document.cookie = `streamflow_active_profile=${val}; path=/; max-age=315360000; SameSite=Lax`;
    } catch (e) {}
  },

  getCookieProfile() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)streamflow_active_profile=([^;]*)/);
      if (match && match[1]) {
        return JSON.parse(decodeURIComponent(match[1]));
      }
    } catch (e) {}
    return null;
  },

  saveProfile(profile) {
    const profiles = this.getProfiles();
    const existingIndex = profiles.findIndex(p => p.id === profile.id);
    if (existingIndex >= 0) {
      profiles[existingIndex] = { ...profiles[existingIndex], ...profile };
    } else {
      profile.id = profile.id || 'prof_' + Date.now();
      profiles.push(profile);
    }
    localStorage.setItem(this.KEYS.PROFILES, JSON.stringify(profiles));
    this.setCookieProfile(profile);
    return profile;
  },

  deleteProfile(id) {
    const profiles = this.getProfiles().filter(p => p.id !== id);
    localStorage.setItem(this.KEYS.PROFILES, JSON.stringify(profiles));
    if (this.getActiveProfileId() === id) {
      localStorage.removeItem(this.KEYS.ACTIVE_PROFILE_ID);
      document.cookie = 'streamflow_active_profile=; path=/; max-age=0;';
    }
  },

  getActiveProfile() {
    const profiles = this.getProfiles();
    const activeId = this.getActiveProfileId();
    if (activeId) {
      const found = profiles.find(p => p.id === activeId);
      if (found) return found;
    }
    if (profiles.length > 0) return profiles[0];

    // Fallback: check 10-year persistent cookie
    const fromCookie = this.getCookieProfile();
    if (fromCookie) {
      this.saveProfile(fromCookie);
      this.setActiveProfileId(fromCookie.id);
      return fromCookie;
    }

    return null;
  },

  setActiveProfileId(id) {
    localStorage.setItem(this.KEYS.ACTIVE_PROFILE_ID, id);
  },

  getActiveProfileId() {
    return localStorage.getItem(this.KEYS.ACTIVE_PROFILE_ID);
  },

  // 2. Favorites (Categorized by Live, Movies, Series)
  getFavorites(filterType = null) {
    try {
      const data = localStorage.getItem(this.KEYS.FAVORITES);
      const list = data ? JSON.parse(data) : [];
      if (!filterType || filterType === 'all') return list;
      if (filterType === 'movie' || filterType === 'vod' || filterType === 'movies') {
        return list.filter(f => f.stream_type === 'movie' || f.stream_type === 'vod' || f.stream_type === 'movies');
      }
      if (filterType === 'series') {
        return list.filter(f => f.stream_type === 'series');
      }
      if (filterType === 'live') {
        return list.filter(f => !f.stream_type || f.stream_type === 'live');
      }
      return list;
    } catch (e) {
      return [];
    }
  },

  getFavoriteCounts() {
    const list = this.getFavorites();
    const live = list.filter(f => !f.stream_type || f.stream_type === 'live').length;
    const movies = list.filter(f => f.stream_type === 'movie' || f.stream_type === 'vod' || f.stream_type === 'movies').length;
    const series = list.filter(f => f.stream_type === 'series').length;
    return { total: list.length, live, movies, series };
  },

  isFavorite(streamId) {
    const favs = this.getFavorites();
    return favs.some(f => String(f.stream_id || f.series_id) === String(streamId));
  },

  normalizeStreamType(item) {
    if (item.series_id || item.stream_type === 'series') return 'series';
    if (item.stream_type === 'vod' || item.stream_type === 'movie' || item.stream_type === 'movies') return 'movie';
    return 'live';
  },

  toggleFavorite(item) {
    let favs = this.getFavorites();
    const targetId = String(item.stream_id || item.series_id);
    const index = favs.findIndex(f => String(f.stream_id || f.series_id) === targetId);
    
    if (index >= 0) {
      favs.splice(index, 1);
      localStorage.setItem(this.KEYS.FAVORITES, JSON.stringify(favs));
      return false; // Removed
    } else {
      const type = this.normalizeStreamType(item);
      favs.push({
        stream_id: item.stream_id || item.series_id,
        series_id: item.series_id,
        name: item.name || item.title,
        stream_icon: item.stream_icon || item.cover,
        cover: item.cover,
        stream_type: type,
        category_id: item.category_id,
        rating: item.rating,
        year: item.year || item.releaseDate,
        added_at: Date.now()
      });
      localStorage.setItem(this.KEYS.FAVORITES, JSON.stringify(favs));
      return true; // Added
    }
  },

  // Batch Category / Country Favorites
  addCategoryFavorites(items, defaultType = 'live') {
    if (!items || !items.length) return 0;
    let favs = this.getFavorites();
    const existingIds = new Set(favs.map(f => String(f.stream_id || f.series_id)));
    let addedCount = 0;

    items.forEach(item => {
      const id = String(item.stream_id || item.series_id);
      if (!existingIds.has(id)) {
        existingIds.add(id);
        const type = this.normalizeStreamType(item) || defaultType;
        favs.push({
          stream_id: item.stream_id || item.series_id,
          series_id: item.series_id,
          name: item.name || item.title,
          stream_icon: item.stream_icon || item.cover,
          cover: item.cover,
          stream_type: type,
          category_id: item.category_id,
          rating: item.rating,
          year: item.year || item.releaseDate,
          added_at: Date.now()
        });
        addedCount++;
      }
    });

    localStorage.setItem(this.KEYS.FAVORITES, JSON.stringify(favs));
    return addedCount;
  },

  removeCategoryFavorites(items) {
    if (!items || !items.length) return 0;
    const targetIds = new Set(items.map(i => String(i.stream_id || i.series_id)));
    let favs = this.getFavorites();
    const beforeCount = favs.length;
    favs = favs.filter(f => !targetIds.has(String(f.stream_id || f.series_id)));
    localStorage.setItem(this.KEYS.FAVORITES, JSON.stringify(favs));
    return beforeCount - favs.length;
  },

  isCategoryFavorited(items) {
    if (!items || !items.length) return false;
    const favs = this.getFavorites();
    const favSet = new Set(favs.map(f => String(f.stream_id || f.series_id)));
    return items.every(item => favSet.has(String(item.stream_id || item.series_id)));
  },

  clearFavorites(filterType = null) {
    if (!filterType || filterType === 'all') {
      localStorage.removeItem(this.KEYS.FAVORITES);
    } else {
      let favs = this.getFavorites();
      if (filterType === 'movie' || filterType === 'vod') {
        favs = favs.filter(f => f.stream_type !== 'movie' && f.stream_type !== 'vod');
      } else {
        favs = favs.filter(f => f.stream_type !== filterType);
      }
      localStorage.setItem(this.KEYS.FAVORITES, JSON.stringify(favs));
    }
  },

  // 3. Recents (Last watched)
  getRecents() {
    try {
      const data = localStorage.getItem(this.KEYS.RECENTS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  addRecent(item) {
    let recents = this.getRecents();
    const streamId = String(item.stream_id || item.series_id);
    recents = recents.filter(r => String(r.stream_id || r.series_id) !== streamId);
    recents.unshift({
      stream_id: item.stream_id || item.series_id,
      series_id: item.series_id,
      name: item.name || item.title,
      stream_icon: item.stream_icon || item.cover,
      cover: item.cover,
      stream_type: this.normalizeStreamType(item),
      category_id: item.category_id,
      timestamp: Date.now()
    });
    if (recents.length > 30) recents.pop();
    localStorage.setItem(this.KEYS.RECENTS, JSON.stringify(recents));
  },

  // 4. Global Settings
  getSettings() {
    try {
      const defaultSettings = {
        useProxy: true,
        watchdog: true,
        remoteControl: true,
        aspectRatio: 'contain'
      };
      const data = localStorage.getItem(this.KEYS.SETTINGS);
      return data ? { ...defaultSettings, ...JSON.parse(data) } : defaultSettings;
    } catch (e) {
      return { useProxy: true, watchdog: true, remoteControl: true, aspectRatio: 'contain' };
    }
  },

  saveSettings(settings) {
    const current = this.getSettings();
    localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify({ ...current, ...settings }));
  }
};
