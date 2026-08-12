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

function hasGeographicQuestionIntent(normalized) {
  return (
    /\bwhere\b/.test(normalized) ||
    /\blocated\b/.test(normalized) ||
    /\bwhich\s+(?:[a-z0-9]+\s+){0,2}(?:city|country|nation)\b/.test(normalized) ||
    /\bwhat\s+(?:city|country|nation)\b/.test(normalized) ||
    /\b(?:city|country|nation)\b.*\b(?:population|capital|continent|region|located)\b/.test(normalized) ||
    /\b(?:thanh pho|quoc gia|nuoc)\b/.test(normalized) ||
    /\bo dau\b/.test(normalized)
  )
}

function isMediaContentIntent(normalized) {
  const mediaMarker = /\b(?:movie|film|phim)\b/.test(normalized)
  const contentPredicate = /\b(?:plot|story|storyline|noi dung|cot truyen|noi ve)\b/.test(normalized)
  return mediaMarker && contentPredicate
}

function isSportsClubAchievementIntent(normalized) {
  const clubMarker = /\b(?:football club|soccer club|cau lac bo bong da)\b/.test(normalized)
  const achievementPredicate = /\b(?:trophy|trophies|title|titles|won|win|danh hieu|gianh|vo dich)\b/.test(normalized)
  return clubMarker && achievementPredicate
}

export function inferHighConfidenceNonGeographicIntent(query) {
  const normalized = normalize(query)
  if (!normalized || hasGeographicQuestionIntent(normalized)) return null
  if (isMediaContentIntent(normalized)) return { domain: 'media-work', reason: 'media-content-intent' }
  if (isSportsClubAchievementIntent(normalized)) return { domain: 'sports-club', reason: 'sports-club-achievement-intent' }
  return null
}

const GEOGRAPHIC_ENTITY_TYPES = new Set(['city', 'country'])

export function applyDomainEntityIntentGate(query, results) {
  const intent = inferHighConfidenceNonGeographicIntent(query)
  const acceptedResults = []
  const rejectedResults = []
  for (const result of Array.isArray(results) ? results : []) {
    if (intent && GEOGRAPHIC_ENTITY_TYPES.has(String(result?.type ?? '').toLowerCase())) {
      rejectedResults.push({
        ...result,
        domain_intent_rejection_reasons: ['geographic-entity-for-nongeographic-intent']
      })
    } else {
      acceptedResults.push(result)
    }
  }
  return { intent, acceptedResults, rejectedResults }
}
