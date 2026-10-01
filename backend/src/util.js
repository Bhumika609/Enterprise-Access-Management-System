// Wrap async route handlers so rejected promises reach the error middleware
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Parse an integer query/body value; returns null if missing/invalid
const toInt = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

// Clamp pagination parameters
const paging = (req, defLimit = 50, maxLimit = 500) => {
  const limit = Math.min(Math.max(toInt(req.query.limit) || defLimit, 1), maxLimit);
  const offset = Math.max(toInt(req.query.offset) || 0, 0);
  return { limit, offset };
};

// Small helper to build WHERE clauses with positional parameters
function whereBuilder() {
  const clauses = [];
  const params = [];
  return {
    add(sqlWithPlaceholder, value) {
      params.push(value);
      clauses.push(sqlWithPlaceholder.replace('?', `$${params.length}`));
    },
    addRaw(sql) { clauses.push(sql); },
    get where() { return clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''; },
    params,
  };
}

module.exports = { ah, toInt, paging, whereBuilder };