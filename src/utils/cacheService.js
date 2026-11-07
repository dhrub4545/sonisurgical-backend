const Redis = require("ioredis");

// Fallback in-memory cache store with TTL & tag invalidation
class MemoryCache {
  constructor(maxSize = 1000) {
    this.store = new Map();
    this.groupMap = new Map(); // group -> Set of keys
    this.maxSize = maxSize;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.del(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlSeconds = 60, group = null) {
    if (this.store.size >= this.maxSize) {
      // Evict oldest item (first in Map)
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.del(firstKey);
    }
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value, expiresAt, group });

    if (group) {
      if (!this.groupMap.has(group)) {
        this.groupMap.set(group, new Set());
      }
      this.groupMap.get(group).add(key);
    }
  }

  del(key) {
    const entry = this.store.get(key);
    if (entry && entry.group && this.groupMap.has(entry.group)) {
      this.groupMap.get(entry.group).delete(key);
    }
    this.store.delete(key);
  }

  invalidateGroup(group) {
    if (this.groupMap.has(group)) {
      const keys = this.groupMap.get(group);
      for (const k of keys) {
        this.store.delete(k);
      }
      this.groupMap.delete(group);
    }
  }

  clear() {
    this.store.clear();
    this.groupMap.clear();
  }
}

const memoryCache = new MemoryCache();
let redisClient = null;
let isRedisAvailable = false;

// Attempt Redis connection if REDIS_URL is provided in environment
const redisUrl = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying if unreachable
        return Math.min(times * 500, 2000);
      },
    });

    redisClient.on("connect", () => {
      console.log("Redis cache connected successfully");
      isRedisAvailable = true;
    });

    redisClient.on("error", (err) => {
      console.warn("Redis connection warning (falling back to memory cache):", err.message);
      isRedisAvailable = false;
    });

    redisClient.connect().catch((err) => {
      console.warn("Redis initial connect skipped, using in-memory cache:", err.message);
      isRedisAvailable = false;
    });
  } catch (err) {
    console.warn("Redis init failed, using in-memory cache:", err.message);
    isRedisAvailable = false;
  }
}

const CacheService = {
  isRedisActive() {
    return isRedisAvailable && redisClient && redisClient.status === "ready";
  },

  async get(key) {
    try {
      if (this.isRedisActive()) {
        const val = await redisClient.get(key);
        if (val) return JSON.parse(val);
      }
    } catch (err) {
      console.warn("Redis get error, falling back to memory:", err.message);
    }
    return memoryCache.get(key);
  },

  async set(key, value, ttlSeconds = 60, group = null) {
    // Always write to memory cache for zero-latency local lookups
    memoryCache.set(key, value, ttlSeconds, group);

    try {
      if (this.isRedisActive()) {
        const str = JSON.stringify(value);
        if (ttlSeconds) {
          await redisClient.setex(key, ttlSeconds, str);
        } else {
          await redisClient.set(key, str);
        }

        // Store group mapping in Redis set for bulk invalidation
        if (group) {
          await redisClient.sadd(`group:${group}`, key);
          await redisClient.expire(`group:${group}`, Math.max(ttlSeconds * 2, 3600));
        }
      }
    } catch (err) {
      console.warn("Redis set error:", err.message);
    }
  },

  async del(key) {
    memoryCache.del(key);
    try {
      if (this.isRedisActive()) {
        await redisClient.del(key);
      }
    } catch (err) {
      console.warn("Redis del error:", err.message);
    }
  },

  async invalidateGroup(group) {
    memoryCache.invalidateGroup(group);
    try {
      if (this.isRedisActive()) {
        const groupKey = `group:${group}`;
        const keys = await redisClient.smembers(groupKey);
        if (keys && keys.length > 0) {
          await redisClient.del(...keys);
        }
        await redisClient.del(groupKey);
      }
    } catch (err) {
      console.warn("Redis invalidateGroup error:", err.message);
    }
  },

  // Express middleware generator for seamless GET caching
  cacheMiddleware(group, ttlSeconds = 60, keyGenerator = null) {
    return async (req, res, next) => {
      // Only cache GET requests
      if (req.method !== "GET") return next();

      const key = keyGenerator
        ? keyGenerator(req)
        : `cache:${group}:${req.originalUrl || req.url}`;

      try {
        const cached = await CacheService.get(key);
        if (cached !== null && cached !== undefined) {
          res.set("X-Cache", "HIT");
          res.set("X-Cache-Engine", CacheService.isRedisActive() ? "Redis" : "Memory");
          return res.json(cached);
        }
      } catch (err) {
        console.warn("Cache read middleware warning:", err.message);
      }

      // Intercept res.json to populate cache
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          CacheService.set(key, body, ttlSeconds, group).catch(() => {});
        }
        res.set("X-Cache", "MISS");
        return originalJson(body);
      };

      next();
    };
  },
};

module.exports = CacheService;
