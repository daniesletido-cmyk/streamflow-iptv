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
    SETTINGS: 'streamflow_settings',
    CONTINUE_WATCHING: 'streamflow_continue_watching',
    WATCHED: 'streamflow_watched'
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

  // 4. Continuar Viendo (Playback Progress for Movies & Series)
  getContinueWatching(filterType = null) {
    try {
      const data = localStorage.getItem(this.KEYS.CONTINUE_WATCHING);
      let list = data ? JSON.parse(data) : [];
      if (!Array.isArray(list)) list = [];
      if (!filterType || filterType === 'all') return list;
      if (filterType === 'movie' || filterType === 'vod' || filterType === 'movies') {
        return list.filter(item => item.stream_type === 'movie' || item.stream_type === 'vod' || item.stream_type === 'movies');
      }
      if (filterType === 'series') {
        return list.filter(item => item.stream_type === 'series');
      }
      return list;
    } catch (e) {
      return [];
    }
  },

  getPlaybackProgress(id) {
    if (!id) return null;
    const list = this.getContinueWatching();
    return list.find(item => String(item.id || item.stream_id) === String(id)) || null;
  },

  savePlaybackProgress(item, currentTime, duration, extra = {}) {
    if (!item || !duration || duration <= 30 || currentTime < 4) return;

    const streamId = String(item.stream_id || item.id || extra.episode_id || '');
    if (!streamId) return;

    const progress = Math.min(100, Math.round((currentTime / duration) * 100));

    // If watched >= 90% or within last 60 seconds, automatically mark as WATCHED / FINALIZADA
    if (progress >= 90 || (duration - currentTime <= 60)) {
      this.markAsWatched(streamId, true, {
        stream_type: item.stream_type || extra.stream_type || 'movie',
        name: item.name || item.title || extra.series_name,
        series_id: extra.series_id,
        episode_id: extra.episode_id,
        cover: item.cover || item.stream_icon || extra.cover
      });
      this.removeContinueWatching(streamId);
      return;
    }

    // Save in Continue Watching if progress >= 1.5%
    if (progress >= 1.5) {
      let list = this.getContinueWatching();
      list = list.filter(it => String(it.id || it.stream_id) !== streamId);

      const entry = {
        id: streamId,
        stream_id: item.stream_id || item.id,
        name: item.name || item.title,
        stream_icon: item.stream_icon || item.cover || extra.cover,
        cover: item.cover || item.stream_icon || extra.cover,
        stream_type: item.stream_type || extra.stream_type || 'movie',
        container_extension: item.container_extension || extra.container_extension || 'mp4',
        currentTime: Math.floor(currentTime),
        duration: Math.floor(duration),
        progress: progress,
        series_id: extra.series_id || item.series_id,
        episode_id: extra.episode_id,
        season_num: extra.season_num,
        episode_num: extra.episode_num,
        series_name: extra.series_name,
        last_watched: Date.now()
      };

      list.unshift(entry);
      if (list.length > 50) list.pop();
      localStorage.setItem(this.KEYS.CONTINUE_WATCHING, JSON.stringify(list));
    }
  },

  removeContinueWatching(id) {
    if (!id) return;
    let list = this.getContinueWatching();
    list = list.filter(item => String(item.id || item.stream_id) !== String(id));
    localStorage.setItem(this.KEYS.CONTINUE_WATCHING, JSON.stringify(list));
  },

  // 5. Contenidos Vistos / Finalizados (Watched state)
  getWatchedMap() {
    try {
      const data = localStorage.getItem(this.KEYS.WATCHED);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  },

  isWatched(id) {
    if (!id) return false;
    const map = this.getWatchedMap();
    return Boolean(map[String(id)]?.watched);
  },

  markAsWatched(itemOrId, isWatched = true, extra = {}) {
    const id = typeof itemOrId === 'object' 
      ? String(itemOrId.stream_id || itemOrId.id || itemOrId.series_id) 
      : String(itemOrId);

    if (!id) return;
    const map = this.getWatchedMap();

    if (isWatched) {
      map[id] = {
        watched: true,
        watched_at: Date.now(),
        stream_type: extra.stream_type || (typeof itemOrId === 'object' ? itemOrId.stream_type : 'movie'),
        name: extra.name || (typeof itemOrId === 'object' ? (itemOrId.name || itemOrId.title) : ''),
        series_id: extra.series_id,
        episode_id: extra.episode_id
      };
      this.removeContinueWatching(id);
    } else {
      delete map[id];
    }

    localStorage.setItem(this.KEYS.WATCHED, JSON.stringify(map));
  },

  toggleWatched(itemOrId, extra = {}) {
    const id = typeof itemOrId === 'object' 
      ? String(itemOrId.stream_id || itemOrId.id || itemOrId.series_id) 
      : String(itemOrId);
    const currentlyWatched = this.isWatched(id);
    this.markAsWatched(itemOrId, !currentlyWatched, extra);
    return !currentlyWatched;
  },

  // 6. Global Settings
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
