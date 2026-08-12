const EMBEDDING_TEXT_VERSION = 'v1'

function push(lines, value) {
  if (value != null && String(value).trim()) lines.push(String(value).trim())
}

export function buildEmbeddingText(entity) {
  const lines = []
  const names = [entity.name.en, entity.name.vi].filter(Boolean).join('. ')
  push(lines, names ? `${names}.` : null)
  push(lines, entity.description.en)
  push(lines, entity.description.vi)

  if (entity.aliases.en.length) push(lines, `English aliases: ${entity.aliases.en.join(', ')}.`)
  if (entity.aliases.vi.length) push(lines, `Vietnamese aliases: ${entity.aliases.vi.join(', ')}.`)
  if (entity.region) push(lines, `Region: ${entity.region}.`)
  if (entity.continent) push(lines, `Continent: ${entity.continent}.`)
  if (entity.countryCode) push(lines, `Country code: ${entity.countryCode}.`)
  if (entity.facts.country) push(lines, `Country: ${entity.facts.country}.`)
  if (entity.facts.capital) push(lines, `Capital: ${entity.facts.capital}.`)
  if (entity.facts.currency) push(lines, `Currency: ${entity.facts.currency}.`)
  if (Array.isArray(entity.facts.languages) && entity.facts.languages.length) {
    push(lines, `Languages: ${entity.facts.languages.join(', ')}.`)
  }

  return { version: EMBEDDING_TEXT_VERSION, text: lines.join('\n') }
}

const EMBEDDING_TEXT_V2_VERSION = 'v2'
const EMBEDDING_TEXT_V21_VERSION = 'v2.1'

function addLocalizedTypeRelations(lines, entity, englishType, vietnameseType) {
  if (entity.name.en) push(lines, `${entity.name.en} is ${englishType}.`)
  if (entity.name.vi) push(lines, `${entity.name.vi} ${vietnameseType}.`)
}

export function buildEmbeddingTextV2(entity) {
  const lines = []
  const names = [entity.name.en, entity.name.vi].filter(Boolean).join('. ')
  push(lines, names ? `${names}.` : null)
  push(lines, entity.description.en)
  push(lines, entity.description.vi)

  if (entity.aliases.en.length) push(lines, `English aliases: ${entity.aliases.en.join(', ')}.`)
  if (entity.aliases.vi.length) push(lines, `Vietnamese aliases: ${entity.aliases.vi.join(', ')}.`)

  if (entity.type === 'country') {
    addLocalizedTypeRelations(lines, entity, 'a country', 'là một quốc gia')
    if (entity.region) push(lines, `Region: ${entity.region}.`)
    if (entity.continent) push(lines, `Continent: ${entity.continent}.`)
    if (entity.countryCode) push(lines, `Country code: ${entity.countryCode}.`)
    if (typeof entity.facts.capital === 'string' && entity.facts.capital.trim()) {
      if (entity.name.en) push(lines, `The capital city of ${entity.name.en} is ${entity.facts.capital.trim()}.`)
      if (entity.name.vi) push(lines, `Thủ đô của ${entity.name.vi} là ${entity.facts.capital.trim()}.`)
    }
    if (typeof entity.facts.currency === 'string' && entity.facts.currency.trim()) {
      if (entity.name.en) push(lines, `${entity.name.en} uses ${entity.facts.currency.trim()} as its currency.`)
      if (entity.name.vi) push(lines, `${entity.name.vi} sử dụng ${entity.facts.currency.trim()} làm tiền tệ.`)
    }
  } else if (entity.type === 'city') {
    const country = typeof entity.facts.country === 'string' ? entity.facts.country.trim() : ''
    if (country) {
      if (entity.name.en) push(lines, `${entity.name.en} is a city in ${country}.`)
      if (entity.name.vi) push(lines, `${entity.name.vi} là một thành phố ở ${country}.`)
      if (entity.facts.capital === true) {
        if (entity.name.en) push(lines, `${entity.name.en} is the capital city of ${country}.`)
        if (entity.name.vi) push(lines, `${entity.name.vi} là thủ đô của ${country}.`)
      }
    } else {
      addLocalizedTypeRelations(lines, entity, 'a city', 'là một thành phố')
    }
    if (entity.region) push(lines, `Region: ${entity.region}.`)
    if (entity.continent) push(lines, `Continent: ${entity.continent}.`)
    if (entity.countryCode) push(lines, `Country code: ${entity.countryCode}.`)
  } else if (entity.type === 'landmark') {
    const country = typeof entity.facts.country === 'string' ? entity.facts.country.trim() : ''
    if (country) {
      if (entity.name.en) push(lines, `${entity.name.en} is a landmark in ${country}.`)
      if (entity.name.vi) push(lines, `${entity.name.vi} là một địa danh ở ${country}.`)
    } else {
      addLocalizedTypeRelations(lines, entity, 'a landmark', 'là một địa danh')
    }
    if (entity.region) push(lines, `Region: ${entity.region}.`)
    if (entity.continent) push(lines, `Continent: ${entity.continent}.`)
    if (entity.countryCode) push(lines, `Country code: ${entity.countryCode}.`)
  }

  if (Array.isArray(entity.facts.languages) && entity.facts.languages.length) {
    push(lines, `Languages: ${entity.facts.languages.join(', ')}.`)
  }

  return { version: EMBEDDING_TEXT_V2_VERSION, text: lines.join('\n') }
}


export function buildEmbeddingTextV21(entity) {
  const lines = []
  const names = [entity.name.en, entity.name.vi].filter(Boolean).join('. ')
  push(lines, names ? `${names}.` : null)
  push(lines, entity.description.en)
  push(lines, entity.description.vi)

  if (entity.aliases.en.length) push(lines, `English aliases: ${entity.aliases.en.join(', ')}.`)
  if (entity.aliases.vi.length) push(lines, `Vietnamese aliases: ${entity.aliases.vi.join(', ')}.`)

  if (entity.type === 'country') {
    addLocalizedTypeRelations(lines, entity, 'a country', 'là một quốc gia')
    if (entity.region) push(lines, `Region: ${entity.region}.`)
    if (entity.continent) push(lines, `Continent: ${entity.continent}.`)
    if (entity.countryCode) push(lines, `Country code: ${entity.countryCode}.`)
    if (typeof entity.facts.capital === 'string' && entity.facts.capital.trim()) {
      if (entity.name.en) push(lines, `${entity.name.en} has ${entity.facts.capital.trim()} as its capital.`)
      if (entity.name.vi) push(lines, `${entity.name.vi} có thủ đô là ${entity.facts.capital.trim()}.`)
    }
    if (typeof entity.facts.currency === 'string' && entity.facts.currency.trim()) {
      if (entity.name.en) push(lines, `${entity.name.en} uses ${entity.facts.currency.trim()} as its currency.`)
      if (entity.name.vi) push(lines, `${entity.name.vi} sử dụng ${entity.facts.currency.trim()} làm tiền tệ.`)
    }
  } else {
    const v2 = buildEmbeddingTextV2(entity)
    return { version: EMBEDDING_TEXT_V21_VERSION, text: v2.text }
  }

  if (Array.isArray(entity.facts.languages) && entity.facts.languages.length) {
    push(lines, `Languages: ${entity.facts.languages.join(', ')}.`)
  }

  return { version: EMBEDDING_TEXT_V21_VERSION, text: lines.join('\n') }
}

export function buildEmbeddingTextByVersion(entity, version = EMBEDDING_TEXT_VERSION) {
  const normalizedVersion = String(version ?? '').trim()
  if (normalizedVersion === EMBEDDING_TEXT_VERSION) return buildEmbeddingText(entity)
  if (normalizedVersion === EMBEDDING_TEXT_V21_VERSION) return buildEmbeddingTextV21(entity)
  throw new TypeError(`unsupported embedding text version: ${normalizedVersion || '(empty)'}`)
}
