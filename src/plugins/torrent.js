import WebTorrent from 'webtorrent';
import DHT from 'bittorrent-dht';
import { ServiceUnavailableError } from '../errors/index.js';
import config from '../config/index.js';
import logger from '../logger/index.js';

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.cyberia.is:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.si:1337/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://retracker.lanta-net.ru:2710/announce',
  'udp://bt.xxx-tracker.com:2710/announce',
  'wss://tracker.fastcast.nz',
  'wss://tracker.btorrent.xyz'
];

export class TorrentPlugin {
  constructor() {
    this.manifest = {
      name: 'torrent',
      version: '1.0.0',
      category: 'torrent',
      description: 'WebTorrent client with DHT and tracker support',
      author: 'OmniScraper',
      endpoints: ['/api/v1/torrent/info', '/api/v1/torrent/stream', '/api/v1/torrent/search'],
      dependencies: ['webtorrent', 'bittorrent-dht']
    };
    this.client = null;
    this.dht = null;
    this.trackers = [...DEFAULT_TRACKERS];
  }

  async init() {
    if (!config.featureFlags.enableTorrent) {
      logger.info('Torrent plugin disabled by feature flag');
      return;
    }
    this.client = new WebTorrent();
    this.dht = new DHT();
    await new Promise((resolve, reject) => {
      this.dht.listen(20000, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info('Torrent plugin initialized with DHT and WebTorrent');
  }

  async getTorrentInfo(magnetUri) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ServiceUnavailableError('Torrent info timeout'));
      }, config.timeouts.torrent);

      try {
        const torrent = this.client.add(magnetUri, { announce: this.trackers });
        torrent.on('metadata', () => {
          clearTimeout(timeout);
          const info = {
            name: torrent.name,
            infoHash: torrent.infoHash,
            length: torrent.length,
            files: torrent.files.map(f => ({
              name: f.name,
              length: f.length,
              path: f.path
            })),
            numPeers: torrent.numPeers,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed
          };
          this.client.remove(magnetUri);
          resolve(info);
        });
        torrent.on('error', (err) => {
          clearTimeout(timeout);
          reject(new ServiceUnavailableError(`Torrent error: ${err.message}`));
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(new ServiceUnavailableError(`Torrent error: ${err.message}`));
      }
    });
  }

  async streamTorrent(magnetUri, fileIndex = 0) {
    return new Promise((resolve, reject) => {
      try {
        const torrent = this.client.add(magnetUri, { announce: this.trackers });
        torrent.on('metadata', () => {
          if (fileIndex >= torrent.files.length) {
            reject(new Error('File index out of range'));
            return;
          }
          const file = torrent.files[fileIndex];
          resolve({
            file,
            torrent,
            stream: file.createReadStream(),
            info: {
              name: file.name,
              length: file.length,
              path: file.path
            }
          });
        });
        torrent.on('error', (err) => reject(err));
      } catch (err) {
        reject(new ServiceUnavailableError(`Stream error: ${err.message}`));
      }
    });
  }

  async searchDHT(query) {
    return new Promise((resolve) => {
      const results = [];
      const timeout = setTimeout(() => resolve(results), 10000);

      this.dht.on('peer', (peer, infoHash) => {
        results.push({ infoHash, peer: `${peer.host}:${peer.port}` });
      });

      this.dht.lookup(Buffer.from(query).toString('hex').slice(0, 40));
      setTimeout(() => clearTimeout(timeout), 10000);
    });
  }

  getActiveTorrents() {
    return this.client ? this.client.torrents.map(t => ({
      name: t.name,
      infoHash: t.infoHash,
      progress: t.progress,
      downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      numPeers: t.numPeers
    })) : [];
  }

  async start() { logger.info('Torrent plugin started'); }
  async stop() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    if (this.dht) {
      this.dht.destroy();
      this.dht = null;
    }
  }
  async destroy() { await this.stop(); }
}

export default TorrentPlugin;
