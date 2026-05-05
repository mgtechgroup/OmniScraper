# OmniScraper - Universal Web Scraping Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org)
[![Scrapers](https://img.shields.io/badge/Scrapers-802-orange.svg)]()
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](Dockerfile)

## 🕷️ Overview

OmniScraper is a high-performance, all-in-one universal web scraping engine designed to extract data from virtually any source on the internet. With **802 integrated scrapers**, it supports web pages, torrents, media files, music platforms, RSS feeds, and decentralized networks (WebTorrent, DHT).

Built for scalability and reliability, OmniScraper powers the data ingestion pipeline for the BLBGenSix AI platform and can be deployed as a standalone service or integrated into custom applications.

---

## ✨ Features

### Core Capabilities
- **802 Scrapers**: Pre-built scrapers for e-commerce, social media, news, media, and more
- **WebTorrent Integration**: P2P file sharing and streaming via WebTorrent protocol
- **DHT Network**: Distributed Hash Table for decentralized content discovery
- **RSS Aggregation**: Parse and monitor RSS/Atom feeds from thousands of sources
- **Music Platform Support**: Extract metadata from 28+ music sources (Spotify, Apple Music, etc.)
- **IMDB Integration**: Comprehensive movie, TV, and celebrity data extraction
- **Unified Search**: Cross-platform search across all integrated sources
- **Proxy Rotation**: Built-in proxy management with automatic rotation
- **Rate Limiting**: Respectful scraping with configurable rate limits
- **Retry Logic**: Exponential backoff and automatic retry for failed requests
- **Caching**: Redis-based response caching to minimize redundant requests
- **Plugin System**: Extensible architecture for custom scrapers

### Supported Platforms (802 Scrapers)

| Category | Count | Examples |
|----------|-------|----------|
| **E-commerce** | 150+ | Amazon, eBay, Shopify, WooCommerce |
| **Social Media** | 100+ | Twitter/X, Reddit, Instagram, LinkedIn |
| **News & Media** | 120+ | CNN, BBC, Reuters, AP News |
| **Torrents** | 80+ | The Pirate Bay, 1337x, RARBG |
| **Music** | 28 | Spotify, Apple Music, SoundCloud, Tidal |
| **Video** | 60+ | YouTube, Vimeo, Dailymotion |
| **Marketplaces** | 90+ | Etsy, Fiverr, Upwork |
| **Tech** | 70+ | GitHub, Stack Overflow, Hacker News |
| **Other** | 104+ | IMDB, Goodreads, TripAdvisor |

---

## ⚡ Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/mgtechgroup/OmniScraper.git
cd OmniScraper

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env

# Start the server
npm start
```

### Basic Usage

```javascript
const OmniScraper = require('omniscaper');

const scraper = new OmniScraper();

// Search across all sources
const results = await scraper.search('artificial intelligence', {
  limit: 10,
  sources: ['web', 'news', 'torrent']
});

console.log(results);
```

---

## 📡 API Documentation

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication
All API requests require an API key passed in the header:
```
X-API-Key: your_api_key_here
```

---

### Endpoints

#### 1. Search All Sources
Perform a unified search across all integrated scrapers.

```
GET /api/v1/search
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `sources` | string | No | Comma-separated source types (web,torrent,music,news) |
| `limit` | integer | No | Max results per source (default: 10) |
| `offset` | integer | No | Pagination offset (default: 0) |
| `sort` | string | No | Sort order (relevance, date, popularity) |

**Example Request:**
```bash
curl -H "X-API-Key: your_key" \
  "http://localhost:3000/api/v1/search?q=python+tutorial&sources=web,news&limit=5"
```

**Response:**
```json
{
  "success": true,
  "query": "python tutorial",
  "total_results": 2450,
  "results": [
    {
      "source": "web",
      "title": "Python Tutorial - W3Schools",
      "url": "https://www.w3schools.com/python/",
      "snippet": "Python is a popular programming language...",
      "date": "2024-01-15T10:30:00Z"
    }
  ],
  "sources_searched": ["web", "news"],
  "execution_time_ms": 1234
}
```

---

#### 2. Scrape Specific URL
Extract structured data from a specific URL.

```
POST /api/v1/scrape
```

**Request Body:**
```json
{
  "url": "https://example.com/page",
  "selectors": {
    "title": "h1.title",
    "content": "div.content",
    "author": "span.author"
  },
  "options": {
    "useProxy": true,
    "timeout": 30000,
    "javascript": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://example.com/page",
  "data": {
    "title": "Page Title",
    "content": "Page content here...",
    "author": "John Doe"
  },
  "metadata": {
    "status_code": 200,
    "content_type": "text/html",
    "scraped_at": "2024-01-15T10:30:00Z"
  }
}
```

---

#### 3. Torrent Search
Search for torrents across multiple torrent sites.

```
GET /api/v1/torrent/search
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `category` | string | No | Category (movies, tv, music, games, software) |
| `sort` | string | No | Sort by (seeders, leechers, size, date) |
| `limit` | integer | No | Max results (default: 20) |

**Example:**
```bash
curl -H "X-API-Key: your_key" \
  "http://localhost:3000/api/v1/torrent/search?q=ubuntu&category=software&limit=10"
```

**Response:**
```json
{
  "success": true,
  "query": "ubuntu",
  "results": [
    {
      "name": "Ubuntu 24.04 LTS",
      "magnet": "magnet:?xt=urn:btih:...",
      "size": "4.2 GB",
      "seeders": 1500,
      "leechers": 300,
      "source": "1337x",
      "category": "software"
    }
  ]
}
```

---

#### 4. Music Search
Search for music across 28+ platforms.

```
GET /api/v1/music/search
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query (track, artist, album) |
| `type` | string | No | Type (track, artist, album) |
| `sources` | string | No | Comma-separated (spotify,apple,soundcloud) |
| `limit` | integer | No | Max results per source (default: 10) |

**Response:**
```json
{
  "success": true,
  "query": "bohemian rhapsody",
  "results": [
    {
      "source": "spotify",
      "type": "track",
      "title": "Bohemian Rhapsody",
      "artist": "Queen",
      "album": "A Night at the Opera",
      "duration_ms": 354000,
      "preview_url": "https://p.scdn.co/...",
      "external_url": "https://open.spotify.com/track/..."
    }
  ]
}
```

---

#### 5. RSS Feed Parser
Fetch and parse RSS/Atom feeds.

```
GET /api/v1/rss
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | RSS feed URL |
| `limit` | integer | No | Max items to return (default: 20) |

**Response:**
```json
{
  "success": true,
  "feed": {
    "title": "Hacker News",
    "description": "New stories",
    "link": "https://news.ycombinator.com/",
    "items": [
      {
        "title": "New AI Breakthrough",
        "link": "https://example.com/article",
        "pubDate": "2024-01-15T10:30:00Z",
        "description": "Article summary..."
      }
    ]
  }
}
```

---

#### 6. IMDB Data Extraction
Get movie, TV show, and celebrity data from IMDB.

```
GET /api/v1/imdb/{type}/{id}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | Yes | Type (title, name, company) |
| `id` | string | Yes | IMDB ID (e.g., tt0111161) |

**Response:**
```json
{
  "success": true,
  "data": {
    "title": "The Shawshank Redemption",
    "year": 1994,
    "rating": 9.3,
    "genre": ["Drama"],
    "director": "Frank Darabont",
    "cast": ["Tim Robbins", "Morgan Freeman"],
    "plot": "Two imprisoned men bond over...",
    "poster": "https://m.media-amazon.com/..."
  }
}
```

---

#### 7. WebTorrent Stream
Stream files via WebTorrent protocol.

```
GET /api/v1/webtorrent/stream
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `infoHash` | string | Yes | Torrent info hash |
| `fileIndex` | integer | No | File index in torrent (default: 0) |

---

#### 8. Plugin Execution
Execute a custom plugin scraper.

```
POST /api/v1/plugin/{pluginName}/run
```

**Request Body:**
```json
{
  "params": {
    "query": "search term",
    "filters": {}
  }
}
```

---

## 🔌 Plugin System Documentation

OmniScraper features an extensible plugin architecture. Plugins are Node.js modules that follow a simple interface.

### Creating a Plugin

1. Create a new directory in `plugins/`:
```bash
mkdir plugins/my-scraper
cd plugins/my-scraper
```

2. Create `index.js`:
```javascript
module.exports = {
  name: 'my-scraper',
  version: '1.0.0',
  description: 'Scrapes example.com',

  async scrape(query, options = {}) {
    // Your scraping logic here
    const results = await fetch(`https://example.com/search?q=${query}`)
      .then(res => res.json());

    return results.map(item => ({
      title: item.title,
      url: item.url,
      snippet: item.description
    }));
  },

  getInfo() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      supportedQueries: ['text', 'url']
    };
  }
};
```

3. Register the plugin in `config/plugins.json`:
```json
{
  "plugins": [
    {
      "name": "my-scraper",
      "enabled": true,
      "config": {
        "apiKey": "optional_api_key"
      }
    }
  ]
}
```

### Plugin API Reference

All plugins must implement:

| Method | Required | Description |
|--------|----------|-------------|
| `scrape(query, options)` | Yes | Main scraping method |
| `getInfo()` | Yes | Return plugin metadata |
| `validateConfig(config)` | No | Validate plugin configuration |

### Plugin Examples

See `plugins/examples/` for sample plugins:
- `github-scraper.js` - GitHub repository search
- `hackernews-scraper.js` - Hacker News stories
- `weather-scraper.js` - Weather data from OpenWeatherMap

---

## 🐳 Docker Deployment

### Using Pre-built Image

```bash
docker pull mgtechgroup/omniscaper:latest

docker run -d \
  --name omniscaper \
  -p 3000:3000 \
  -e API_KEY=your_secure_key \
  -e REDIS_URL=redis://redis:6379 \
  mgtechgroup/omniscaper:latest
```

### Using Docker Compose

Create `docker-compose.yml`:
```yaml
version: '3.8'

services:
  omniscaper:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - API_KEY=your_secure_key
      - REDIS_URL=redis://redis:6379
      - LOG_LEVEL=info
    volumes:
      - ./logs:/app/logs
      - ./plugins:/app/plugins
    depends_on:
      - redis
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  redis_data:
```

Run:
```bash
docker-compose up -d
```

### Building Custom Image

```bash
# Build image
docker build -t omniscaper:custom .

# Run with custom config
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/plugins:/app/plugins \
  omniscaper:custom
```

---

## ⚙️ Configuration Reference

### Environment Variables (.env)

```env
# Server
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Security
API_KEY=your_secure_api_key_here
ENABLE_CORS=true
ALLOWED_ORIGINS=https://blbgensixai.club

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=

# Proxy
USE_PROXY=false
PROXY_URL=http://proxy.example.com:8080
PROXY_ROTATION_ENABLED=true
PROXY_LIST_FILE=./config/proxies.txt

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Caching
CACHE_ENABLED=true
CACHE_TTL=3600

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/omniscaper.log

# Features
ENABLE_WEBTORRENT=true
ENABLE_DHT=true
ENABLE_RSS=true
ENABLE_IMDB=true

# Plugins
PLUGINS_DIR=./plugins
PLUGINS_CONFIG=./config/plugins.json

# Timeout Settings
REQUEST_TIMEOUT=30000
SCRAPE_TIMEOUT=60000
```

### Configuration File (config/default.json)

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "scrapers": {
    "maxConcurrent": 5,
    "timeout": 30000,
    "retry": {
      "maxAttempts": 3,
      "backoffMs": 1000
    }
  },
  "sources": {
    "web": { "enabled": true, "weight": 1.0 },
    "torrent": { "enabled": true, "weight": 0.8 },
    "music": { "enabled": true, "weight": 0.9 },
    "news": { "enabled": true, "weight": 0.7 }
  },
  "cache": {
    "enabled": true,
    "ttl": 3600,
    "maxSize": 1000
  }
}
```

---

## 📁 Project Structure

```
OmniScraper/
├── src/
│   ├── core/
│   │   ├── scraper.js          # Core scraping engine
│   │   ├── scheduler.js       # Job scheduling
│   │   └── proxy-manager.js   # Proxy rotation
│   ├── scrapers/               # Built-in scrapers (802)
│   │   ├── web/                # Web scrapers
│   │   ├── torrent/            # Torrent scrapers
│   │   ├── music/              # Music platform scrapers
│   │   ├── news/               # News scrapers
│   │   └── social/             # Social media scrapers
│   ├── plugins/                # Plugin system
│   │   ├── loader.js           # Plugin loader
│   │   └── examples/           # Example plugins
│   ├── services/
│   │   ├── webtorrent.js       # WebTorrent service
│   │   ├── dht.js              # DHT service
│   │   ├── rss.js              # RSS parser
│   │   └── imdb.js             # IMDB scraper
│   ├── api/
│   │   ├── routes.js           # API routes
│   │   ├── middleware.js       # Auth, rate limiting
│   │   └── controllers/        # Request handlers
│   └── utils/
│       ├── logger.js           # Logging utility
│       ├── cache.js            # Cache wrapper
│       └── helpers.js          # Helper functions
├── config/
│   ├── default.json            # Default configuration
│   ├── plugins.json            # Plugin registry
│   └── proxies.txt             # Proxy list
├── test/
│   ├── unit/                   # Unit tests
│   └── integration/            # Integration tests
├── docker/
│   ├── Dockerfile              # Docker image definition
│   └── docker-compose.yml      # Compose configuration
├── docs/                       # Additional documentation
├── .env.example                # Environment template
├── server.js                   # Entry point
└── package.json                # Dependencies
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test
npm test -- --grep "torrent search"

# Lint code
npm run lint

# Format code
npm run format
```

---

## 🤝 Contributing

We welcome contributions! Here's how:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-scraper`)
3. Commit your changes (`git commit -m 'Add amazing scraper'`)
4. Push to the branch (`git push origin feature/amazing-scraper`)
5. Open a Pull Request

### Guidelines
- Follow the existing code style (ESLint + Prettier)
- Write tests for new scrapers
- Update documentation
- Ensure all tests pass

---

## 🔒 Security

- API keys are required for all requests
- Rate limiting prevents abuse
- Proxy support for anonymity
- No user data is stored
- Regular security audits

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 📞 Support

- **GitHub Issues**: [Report bugs](https://github.com/mgtechgroup/OmniScraper/issues)
- **Documentation**: [Full API docs](https://docs.blbgensixai.club/omniscaper)
- **Email**: scraper-support@blbgensixai.club

---

## 🙏 Acknowledgments

- **Puppeteer** - Headless Chrome automation
- **Cheerio** - Fast HTML parsing
- **Axios** - HTTP client
- **WebTorrent** - P2P streaming
- All contributors who built the 802 integrated scrapers
