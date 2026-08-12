const CLOUD_PROVIDERS = Object.freeze({
  openai: { prefix: 'OPENAI', fallback: 'OPENAI_API_KEY' },
  gemini: { prefix: 'GEMINI', fallback: 'GEMINI_API_KEY' },
  nvidia: { prefix: 'NVIDIA', fallback: 'NVIDIA_API_KEY' },
  groq: { prefix: 'GROQ', fallback: 'GROQ_API_KEY' }
})

function normalizedSecret(value) {
  const secret = String(value ?? '').trim()
  return secret || null
}

export function discoverProviderApiKeys(env, provider) {
  const config = CLOUD_PROVIDERS[provider]
  if (!config) throw new TypeError(`unsupported cloud translation provider: ${provider}`)

  const numbered = []
  const pattern = new RegExp(`^${config.prefix}_KEY([1-9]\\d*)$`)
  for (const [name, value] of Object.entries(env ?? {})) {
    const match = name.match(pattern)
    const secret = normalizedSecret(value)
    if (match && secret) numbered.push({ index: Number.parseInt(match[1], 10), slot: name, secret })
  }
  numbered.sort((a, b) => a.index - b.index || a.slot.localeCompare(b.slot))

  const candidates = numbered.map(({ slot, secret }) => ({ slot, secret }))
  const fallback = normalizedSecret(env?.[config.fallback])
  if (fallback) candidates.push({ slot: config.fallback, secret: fallback })

  const seen = new Set()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.secret)) return false
    seen.add(candidate.secret)
    return true
  })
}

export const CLOUD_TRANSLATION_PROVIDERS = Object.freeze(Object.keys(CLOUD_PROVIDERS))
