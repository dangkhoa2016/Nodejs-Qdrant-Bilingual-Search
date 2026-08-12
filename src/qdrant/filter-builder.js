const KEYWORD_FIELDS = new Set(['type', 'continent', 'region', 'country_code', 'source'])

export function buildQdrantFilter(input = {}) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('filter must be an object')
  const must = []
  for (const [key, value] of Object.entries(input)) {
    if (KEYWORD_FIELDS.has(key)) {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${key} must be a non-empty string`)
      must.push({ key, match: { value: value.trim() } })
      continue
    }
    if (key === 'population') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('population must be a range object')
      const range = {}
      for (const op of ['gt', 'gte', 'lt', 'lte']) {
        if (value[op] != null) {
          const numeric = Number(value[op])
          if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError(`population.${op} must be non-negative`)
          range[op] = numeric
        }
      }
      if (!Object.keys(range).length) throw new TypeError('population range is empty')
      must.push({ key: 'population', range })
      continue
    }
    throw new TypeError(`unsupported filter field: ${key}`)
  }
  return must.length ? { must } : undefined
}
