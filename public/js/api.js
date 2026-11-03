/**
 * StreamFlow IPTV - Xtream Codes API Client & Stream Resolvers
 */
const Api = {
  // Demo mode channels (free legal streams for immediate testing)
  DEMO_CHANNELS: [
    {
      stream_id: 'demo_1',
      name: 'NASA TV HD (Live)',
      stream_icon: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=200&h=200&fit=crop',
      stream_type: 'live',
      category_id: 'demo',
      direct_url: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8'
    },
    {
      stream_id: 'demo_2',
      name: 'Red Bull TV Sports & Action',
      stream_icon: 'https://images.unsplash.com/photo-1517649763962-0c623266ddc0?w=200&h=200&fit=crop',
      stream_type: 'live',
      category_id: 'demo',
      direct_url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8'
    },
    {
      stream_id: 'demo_3',
      name: 'Bloomberg TV Live News',
      stream_icon: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=200&h=200&fit=crop',
      stream_type: 'live',
      category_id: 'demo',
      direct_url: 'https://liveproduseast.akamaized.net/us/Channel-HD-AWS-virginia-1/master.m3u8'
    },
    {
      stream_id: 'demo_4',
      name: 'France 24 Español',
      stream_icon: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=200&h=200&fit=crop',
      stream_type: 'live',
      category_id: 'demo',
      direct_url: 'https://f24hls-i.akamaihd.net/hls/live/221193/F24_ES_LO_HLS/master_500.m3u8'
    },
    {
      stream_id: 'demo_5',
      name: 'DW Español (Alemania)',
      stream_icon: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=200&h=200&fit=crop',
      stream_type: 'live',
      category_id: 'demo',
      direct_url: 'https://dwstream4-lh.akamaihd.net/i/dwam_es@122756/master.m3u8'
    }
  ],

  async testConnection(serverUrl, username, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, username, password })
    });
    return await res.json();
  },

  async getCategories(profile, type = 'live') {
    if (profile.isDemo) {
      return [{ category_id: 'demo', category_name: 'Canales Demo Gratuitos' }];
    }
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: profile.serverUrl,
        username: profile.username,
        password: profile.password,
        type
      })
    });
    const data = await res.json();
    return data.categories || [];
  },

  async getStreams(profile, type = 'live', categoryId = null) {
    if (profile.isDemo) {
      return this.DEMO_CHANNELS;
    }
    const res = await fetch('/api/streams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: profile.serverUrl,
        username: profile.username,
        password: profile.password,
        type,
        categoryId
      })
    });
    const data = await res.json();
    return data.streams || [];
  },

  async getSeriesInfo(profile, seriesId) {
    if (profile.isDemo) return null;
    const res = await fetch('/api/series-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: profile.serverUrl,
        username: profile.username,
        password: profile.password,
        seriesId
      })
    });
    const data = await res.json();
    return data.info;
  },

  async getEpg(profile, streamId) {
    if (profile.isDemo) return [];
    try {
      const res = await fetch('/api/epg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl: profile.serverUrl,
          username: profile.username,
          password: profile.password,
          streamId
        })
      });
      const data = await res.json();
      return data.epg || [];
    } catch (e) {
      return [];
    }
  },

  // Builds direct & proxied stream URLs
  getStreamUrls(profile, item, streamType = 'live') {
    if (item.direct_url) {
      return {
        hls: item.direct_url,
        proxied: `/api/stream/proxy?url=${encodeURIComponent(item.direct_url)}`,
        direct: item.direct_url
      };
    }

    const base = profile.serverUrl.replace(/\/+$/, '');
    const user = encodeURIComponent(profile.username);
    const pass = encodeURIComponent(profile.password);
    const id = item.stream_id;
    const ext = item.container_extension || 'mp4';

    let rawDirectUrl = '';
    let rawHlsUrl = '';

    if (streamType === 'live') {
      const rawDirectLiveUrl = `${base}/live/${user}/${pass}/${id}.ts`;
      const rawDirectUrl = `${base}/${user}/${pass}/${id}.ts`;
      const rawHlsUrl = `${base}/live/${user}/${pass}/${id}.m3u8`;
      const rawBareUrl = `${base}/${user}/${pass}/${id}`;

      return {
        directLive: rawDirectLiveUrl,
        direct: rawDirectUrl,
        hls: rawHlsUrl,
        proxiedDirectLive: `/api/stream/proxy?url=${encodeURIComponent(rawDirectLiveUrl)}`,
        proxiedDirect: `/api/stream/proxy?url=${encodeURIComponent(rawDirectUrl)}`,
        proxiedHls: `/api/stream/proxy?url=${encodeURIComponent(rawHlsUrl)}`,
        proxiedBare: `/api/stream/proxy?url=${encodeURIComponent(rawBareUrl)}`
      };
    } else if (streamType === 'vod' || streamType === 'movies') {
      rawDirectUrl = `${base}/movie/${user}/${pass}/${id}.${ext}`;
      rawHlsUrl = rawDirectUrl;
    } else if (streamType === 'series') {
      rawDirectUrl = `${base}/series/${user}/${pass}/${id}.${ext}`;
      rawHlsUrl = rawDirectUrl;
    }

    return {
      hls: rawHlsUrl,
      direct: rawDirectUrl,
      proxiedHls: `/api/stream/proxy?url=${encodeURIComponent(rawHlsUrl)}`,
      proxiedDirect: `/api/stream/proxy?url=${encodeURIComponent(rawDirectUrl)}`
    };
  }
};
