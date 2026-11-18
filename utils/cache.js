// ── Tiny in-memory TTL cache ──
// Dashboard aggregations दर request ला चालवायची गरज नाही — data import नंतर क्वचितच बदलतो.
// Meter update झाल्यावर clear() होतो.
const store = new Map();
const DEFAULT_TTL = (parseInt(process.env.CACHE_TTL_SECONDS) || 60) * 1000;

exports.get = (key) => {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
};

exports.set = (key, value, ttl = DEFAULT_TTL) => {
  store.set(key, { value, exp: Date.now() + ttl });
};

exports.clear = () => store.clear();
