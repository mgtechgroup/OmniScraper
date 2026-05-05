import SpotifyWebApi from 'spotify-web-api-node';
import { EventEmitter } from 'node:events';
import { ServiceUnavailableError, AuthError } from '../errors/index.js';
import config from '../config/index.js';
import logger from '../logger/index.js';

export class MusicPlugin extends EventEmitter {
  constructor() {
    super();
    this.manifest = {
      name: 'music',
      version: '1.0.0',
      category: 'music',
      description: 'Music scrobbling with Spotify, Last.fm, ListenBrainz, Jellyfin/Plex',
      author: 'OmniScraper',
      endpoints: ['/api/v1/music/now-playing', '/api/v1/music/scrobble', '/api/v1/music/analytics'],
      dependencies: ['spotify-web-api-node']
    };
    this.spotify = null;
    this.sources = new Map();
    this.nowPlaying = null;
    this.history = [];
    this.maxHistory = 1000;
  }

  async init() {
    if (!config.featureFlags.enableMusic) {
      logger.info('Music plugin disabled by feature flag');
      return;
    }
    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      this.spotify = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback'
      });
    }
  }

  async getSpotifyNowPlaying() {
    if (!this.spotify) throw new ServiceUnavailableError('Spotify not configured');
    try {
      const data = await this.spotify.getMyCurrentPlayingTrack();
      if (data.body && data.body.item) {
        return {
          source: 'spotify',
          track: data.body.item.name,
          artist: data.body.item.artists.map(a => a.name).join(', '),
          album: data.body.item.album.name,
          duration_ms: data.body.item.duration_ms,
          progress_ms: data.body.progress_ms,
          is_playing: data.body.is_playing,
          url: data.body.item.external_urls?.spotify || '',
          image: data.body.item.album.images?.[0]?.url || ''
        };
      }
      return null;
    } catch (err) {
      throw new ServiceUnavailableError(`Spotify error: ${err.message}`);
    }
  }

  async scrobbleToLastFM(track) {
    if (!process.env.LASTFM_API_KEY) return;
    try {
      const axios = (await import('axios')).default;
      await axios.post('http://ws.audioscrobbler.com/2.0/', {
        method: 'track.updateNowPlaying',
        api_key: process.env.LASTFM_API_KEY,
        artist: track.artist,
        track: track.track,
        album: track.album || '',
        format: 'json'
      });
    } catch (err) {
      logger.warn({ error: err.message }, 'Last.fm scrobble failed');
    }
  }

  async scrobbleToListenBrainz(track) {
    if (!process.env.LISTENBRAINZ_TOKEN) return;
    try {
      const axios = (await import('axios')).default;
      await axios.post('https://api.listenbrainz.org/1/submit-listens',
        { listen_type: 'playing_now', payload: [{ track_metadata: { track_name: track.track, artist_name: track.artist } }] },
        { headers: { Authorization: `Token ${process.env.LISTENBRAINZ_TOKEN}` } }
      );
    } catch (err) {
      logger.warn({ error: err.message }, 'ListenBrainz scrobble failed');
    }
  }

  async updateNowPlaying(track) {
    this.nowPlaying = {
      ...track,
      timestamp: new Date().toISOString()
    };
    this.history.unshift(this.nowPlaying);
    if (this.history.length > this.maxHistory) this.history.pop();

    this.emit('nowPlaying', this.nowPlaying);
    this.emit('sse:event', {
      event: 'now_playing',
      data: this.nowPlaying
    });

    await Promise.all([
      this.scrobbleToLastFM(track),
      this.scrobbleToListenBrainz(track)
    ]);

    return this.nowPlaying;
  }

  getListeningAnalytics() {
    const stats = {
      total_tracks: this.history.length,
      by_source: {},
      recent: this.history.slice(0, 50)
    };
    for (const entry of this.history) {
      const src = entry.source || 'unknown';
      stats.by_source[src] = (stats.by_source[src] || 0) + 1;
    }
    return stats;
  }

  async start() {
    if (this.spotify && process.env.SPOTIFY_REFRESH_TOKEN) {
      this.spotify.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);
      try {
        const tokens = await this.spotify.refreshAccessToken();
        this.spotify.setAccessToken(tokens.body.access_token);
      } catch (err) {
        logger.warn({ error: err.message }, 'Spotify token refresh failed');
      }
    }
    logger.info('Music plugin started');
  }

  async stop() { this.nowPlaying = null; }
  async destroy() { this.history = []; this.sources.clear(); }
}

export default MusicPlugin;
