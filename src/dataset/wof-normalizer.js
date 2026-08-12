const TYPE_PLACETYPES = Object.freeze({
  city: new Set(['locality']),
  country: new Set(['country', 'dependency'])
})

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function positiveId(value) {
  const id = String(value ?? '').trim()
  return /^\d+$/.test(id) && id !== '0' ? id : null
}

function list(value) {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return []
  return [value]
}

function dedupeText(values) {
  const output = []
  const seen = new Set()
  for (const raw of values) {
    const value = text(raw)
    if (!value || seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}

function localizedNames(properties, language) {
  const preferred = []
  const variants = []
  for (const key of Object.keys(properties).sort()) {
    if (!key.startsWith(`name:${language}`)) continue
    if (key.endsWith('_x_preferred')) preferred.push(...list(properties[key]))
    else if (key.endsWith('_x_variant') || key.endsWith('_x_colloquial')) variants.push(...list(properties[key]))
  }
  const safe = (value) => language !== 'vie' || !/[Ðð]/u.test(value)
  const preferredNames = dedupeText(preferred).filter(safe)
  const primary = preferredNames[0] ?? null
  const aliases = dedupeText([...preferredNames.slice(1), ...variants]).filter((value) => value !== primary && safe(value))
  return { primary, aliases }
}

function geoNamesIds(properties) {
  const values = list(properties['wof:concordances']?.['gn:id'])
  const ids = []
  const seen = new Set()
  for (const value of values) {
    const id = positiveId(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
}

export function normalizeWofFeature(feature, { type } = {}) {
  const properties = feature?.properties
  if (!properties || typeof properties !== 'object') throw new TypeError('WOF feature properties are required')
  const placetype = text(properties['wof:placetype'])
  if (!TYPE_PLACETYPES[type]?.has(placetype)) return null
  if (properties['mz:is_current'] === 0 || properties['mz:is_current'] === false) return null

  const wofId = positiveId(properties['wof:id'])
  if (!wofId) throw new TypeError('WOF feature requires a positive wof:id')
  const geonamesIds = geoNamesIds(properties)
  if (geonamesIds.length !== 1) return null

  const en = localizedNames(properties, 'eng')
  const vi = localizedNames(properties, 'vie')
  return {
    wofId,
    placetype,
    geonamesIds,
    name: { en: en.primary, vi: vi.primary },
    aliases: { en: en.aliases, vi: vi.aliases }
  }
}
