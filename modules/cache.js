/**
 * 内存缓存模块 (可升级为 Redis)
 */
class CacheService {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0 };
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) { this.stats.misses++; return null; }
    if (item.expireAt && Date.now() > item.expireAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return item.value;
  }

  set(key, value, ttlSeconds = 300) {
    this.stats.sets++;
    const expireAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expireAt, createdAt: Date.now() });
    if (this.timers.has(key)) clearTimeout(this.timers.get(key));
    if (ttlSeconds) {
      this.timers.set(key, setTimeout(() => this.delete(key), ttlSeconds * 1000));
    }
  }

  delete(key) {
    this.stats.deletes++;
    this.store.delete(key);
    if (this.timers.has(key)) { clearTimeout(this.timers.get(key)); this.timers.delete(key); }
  }

  clear() { this.store.clear(); this.timers.forEach(t => clearTimeout(t)); this.timers.clear(); }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return { ...this.stats, size: this.store.size, hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : '0%' };
  }

  // 缓存穿透保护：防止缓存空值
  async getOrSet(key, fetchFn, ttl = 300) {
    let value = this.get(key);
    if (value !== null) return value;
    value = await fetchFn();
    this.set(key, value, ttl);
    return value;
  }
}

module.exports = new CacheService();
