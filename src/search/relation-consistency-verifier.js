function normalize(value) {
  return String(value ?? '')
    .replace(/[đĐ]/g, (c) => c === 'Đ' ? 'D' : 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”‘’'"`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const CONTINENTS = [
  ['South America', ['south america', 'south american', 'nam my', 'chau nam my']],
  ['North America', ['north america', 'north american', 'bac my', 'chau bac my']],
  ['Europe', ['europe', 'european', 'chau au']],
  ['Africa', ['africa', 'african', 'chau phi']],
  ['Asia', ['asia', 'asian', 'chau a']]
]

function inferCountryIntent(text) {
  const n = normalize(text)
  if (/\bwhich\s+(?:[a-z]+\s+){0,5}(?:country|nation)\b/.test(n)) return true
  if (/\bwhat\s+(?:[a-z]+\s+){0,5}(?:country|nation)\b/.test(n)) return true
  if (/^(?:country|nation)\b/.test(n)) return true
  if (/\bquoc gia\s+(?:[a-z0-9]+\s+){0,6}nao\b/.test(n)) return true
  if (/\bnuoc\s+nao\b/.test(n)) return true
  if (/^quoc gia\b/.test(n)) return true
  return false
}

function inferContinent(text) {
  const n = ` ${normalize(text)} `
  for (const [canonical, aliases] of CONTINENTS) {
    if (aliases.some((alias) => n.includes(` ${alias} `))) return canonical
  }
  return null
}

function cleanCapital(value) {
  return String(value ?? '')
    .replace(/[?.,;:]+$/g, '')
    .replace(/\s+(?:and|va|và)\s+.*$/i, '')
    .replace(/\s+(?:as\s+its\s+capital|lam\s+thu\s+do(?:\s+quoc\s+gia)?)$/i, '')
    .trim()
}

function inferCapital(text, countryIntent) {
  if (!countryIntent) return null
  const original = String(text ?? '')
  const normalized = normalize(original)

  let match = original.match(/\b(?:has|have)\s+(.+?)\s+as\s+(?:its|the)\s+(?:national\s+)?capital\b/i)
  if (match) return cleanCapital(match[1])

  match = original.match(/(?:có|co)\s+(.+?)\s+(?:làm|lam)\s+(?:thủ|thu)\s+(?:đô|do)(?:\s+(?:quốc|quoc)\s+(?:gia))?/i)
  if (match) return cleanCapital(match[1])

  match = normalized.match(/\b(?:co)\s+(.+?)\s+lam\s+thu\s+do(?:\s+quoc\s+gia)?\b/i)
  if (match) return cleanCapital(match[1]).replace(/\bva\b.*$/i, '').trim()

  match = original.match(/(?:có|co)\s+thủ\s+đô\s+(.+?)(?:\s+và\s+|\s+va\s+|[?,;]|$)/i)
  if (match) return cleanCapital(match[1])

  match = normalized.match(/\bcapital\s+is\s+(.+?)(?:\s+and\b|[?,;]|$)/i)
  if (match) return cleanCapital(match[1])

  return null
}

export function extractStructuredQueryConstraints(query) {
  const countryIntent = inferCountryIntent(query)
  const constraints = {}
  if (countryIntent) constraints.entityType = 'country'
  const continent = inferContinent(query)
  if (continent) constraints.continent = continent
  const capital = inferCapital(query, countryIntent)
  if (capital) constraints.capital = capital
  return constraints
}

function equivalentText(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)))
}

function editSimilarity(a, b) {
  const left = normalize(a).replace(/\s+/g, '')
  const right = normalize(b).replace(/\s+/g, '')
  if (!left || !right) return 0
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const old = previous[j]
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost)
      diagonal = old
    }
  }
  return 1 - (previous[right.length] / Math.max(left.length, right.length))
}

function capitalEquivalent(actual, requested) {
  if (equivalentText(actual, requested)) return true
  return editSimilarity(actual, requested) >= 0.70
}

export function verifyResultAgainstConstraints(result, constraints) {
  const reasons = []
  if (constraints?.entityType && result?.type !== constraints.entityType) reasons.push('entity-type-mismatch')
  if (constraints?.continent && !equivalentText(result?.continent, constraints.continent)) reasons.push('continent-mismatch')
  if (constraints?.capital) {
    const capital = typeof result?.facts?.capital === 'string' ? result.facts.capital : null
    if (!capitalEquivalent(capital, constraints.capital)) reasons.push('capital-mismatch')
  }
  return { accepted: reasons.length === 0, reasons }
}

export function applyConsistencyVerification(query, results) {
  const constraints = extractStructuredQueryConstraints(query)
  const acceptedResults = []
  const rejectedResults = []
  for (const result of Array.isArray(results) ? results : []) {
    const verification = verifyResultAgainstConstraints(result, constraints)
    if (verification.accepted) acceptedResults.push(result)
    else rejectedResults.push({ ...result, consistency_rejection_reasons: verification.reasons })
  }
  return { constraints, acceptedResults, rejectedResults }
}
