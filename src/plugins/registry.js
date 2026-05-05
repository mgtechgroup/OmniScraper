import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import logger from '../logger/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class PluginRegistry extends EventEmitter {
  constructor() {
    super();
    this.plugins = new Map();
    this.categories = new Map();
    this.dependencies = new Map();
  }

  register(manifest, instance) {
    if (!manifest || !manifest.name) {
      throw new Error('Plugin manifest must have a name');
    }

    if (this.plugins.has(manifest.name)) {
      throw new Error(`Plugin ${manifest.name} is already registered`);
    }

    const plugin = {
      manifest: { ...manifest, registeredAt: new Date().toISOString() },
      instance,
      status: 'registered'
    };

    this.plugins.set(manifest.name, plugin);

    if (manifest.category) {
      if (!this.categories.has(manifest.category)) {
        this.categories.set(manifest.category, []);
      }
      this.categories.get(manifest.category).push(manifest.name);
    }

    if (manifest.dependencies) {
      this.dependencies.set(manifest.name, manifest.dependencies);
    }

    this.emit('plugin:registered', manifest.name);
    logger.info({ plugin: manifest.name }, `Plugin registered: ${manifest.name}`);
    return this;
  }

  unregister(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    if (plugin.status === 'started') {
      this.stop(name);
    }

    this.plugins.delete(name);
    for (const [cat, names] of this.categories.entries()) {
      const idx = names.indexOf(name);
      if (idx > -1) names.splice(idx, 1);
    }
    this.dependencies.delete(name);

    this.emit('plugin:unregistered', name);
    logger.info({ plugin: name }, `Plugin unregistered: ${name}`);
    return true;
  }

  get(name) {
    const plugin = this.plugins.get(name);
    return plugin ? plugin.instance : null;
  }

  getAll() {
    return Array.from(this.plugins.entries()).map(([name, plugin]) => ({
      name,
      ...plugin.manifest,
      status: plugin.status
    }));
  }

  getByCategory(category) {
    const names = this.categories.get(category) || [];
    return names.map(name => this.plugins.get(name)).filter(Boolean);
  }

  async init(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin ${name} not found`);
    if (typeof plugin.instance.init === 'function') {
      await plugin.instance.init();
    }
    plugin.status = 'initialized';
    this.emit('plugin:initialized', name);
    return this;
  }

  async start(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin ${name} not found`);
    if (typeof plugin.instance.start === 'function') {
      await plugin.instance.start();
    }
    plugin.status = 'started';
    this.emit('plugin:started', name);
    logger.info({ plugin: name }, `Plugin started: ${name}`);
    return this;
  }

  async stop(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    if (typeof plugin.instance.stop === 'function') {
      await plugin.instance.stop();
    }
    plugin.status = 'stopped';
    this.emit('plugin:stopped', name);
    return true;
  }

  async destroy(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    await this.stop(name);
    if (typeof plugin.instance.destroy === 'function') {
      await plugin.instance.destroy();
    }
    this.unregister(name);
    return true;
  }

  async startAll() {
    for (const [name] of this.plugins) {
      try {
        await this.start(name);
      } catch (err) {
        logger.error({ plugin: name, error: err.message }, `Failed to start plugin: ${name}`);
      }
    }
  }

  async stopAll() {
    for (const [name] of this.plugins) {
      try {
        await this.stop(name);
      } catch (err) {
        logger.error({ plugin: name, error: err.message }, `Failed to stop plugin: ${name}`);
      }
    }
  }

  async loadFromDirectory(dir = __dirname) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'registry.js');
    for (const file of files) {
      try {
        const mod = await import(path.join(dir, file));
        const PluginClass = mod.default || mod;
        if (typeof PluginClass === 'function') {
          const instance = new PluginClass();
          if (instance.manifest) {
            this.register(instance.manifest, instance);
          }
        }
      } catch (err) {
        logger.error({ file, error: err.message }, `Failed to load plugin: ${file}`);
      }
    }
  }
}

export default PluginRegistry;
