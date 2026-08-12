const ALLOWED_FIELDS = new Set(['description', 'name'])

function normalizeFields(fields = ['description']) {
  if (!Array.isArray(fields) || !fields.length) throw new TypeError('translation fields must be a non-empty array')
  const normalized = [...new Set(fields.map((field) => String(field).trim()).filter(Boolean))]
  for (const field of normalized) {
    if (!ALLOWED_FIELDS.has(field)) throw new TypeError(`unsupported translation field: ${field}`)
  }
  return normalized
}

export function countTranslationCandidates(entities, fields = ['description']) {
  const normalizedFields = normalizeFields(fields)
  let count = 0
  for (const entity of entities) {
    for (const field of normalizedFields) {
      if (entity?.[field]?.en && !entity?.[field]?.vi) count += 1
    }
  }
  return count
}

export class PublicSeedOrchestrator {
  constructor({ buildDataset, createTranslator, translateEntities, seedEntities, preflightInfrastructure = async () => {}, clock = () => new Date() }) {
    if (typeof buildDataset !== 'function') throw new TypeError('buildDataset is required')
    if (typeof createTranslator !== 'function') throw new TypeError('createTranslator is required')
    if (typeof translateEntities !== 'function') throw new TypeError('translateEntities is required')
    if (typeof seedEntities !== 'function') throw new TypeError('seedEntities is required')
    if (typeof preflightInfrastructure !== 'function') throw new TypeError('preflightInfrastructure must be a function')
    this.buildDataset = buildDataset
    this.createTranslator = createTranslator
    this.translateEntities = translateEntities
    this.seedEntities = seedEntities
    this.preflightInfrastructure = preflightInfrastructure
    this.clock = clock
  }

  async run({ buildOptions = {}, translation = { provider: 'none', fields: ['description'] }, dryRun = false } = {}) {
    const provider = String(translation?.provider ?? 'none').trim().toLowerCase()
    const fields = normalizeFields(translation?.fields ?? ['description'])
    if (!dryRun) await this.preflightInfrastructure()
    const built = await this.buildDataset(buildOptions)
    if (!built || !Array.isArray(built.entities) || !built.manifest) throw new TypeError('buildDataset must return entities and manifest')

    const plan = {
      entities: built.entities.length,
      translationProvider: provider,
      translationFields: fields,
      translationCandidates: provider === 'none' ? 0 : countTranslationCandidates(built.entities, fields)
    }
    const common = {
      generatedAt: this.clock().toISOString(),
      dryRun: Boolean(dryRun),
      plan,
      build: built.manifest,
      translation: null,
      seed: null,
      entities: built.entities
    }
    if (dryRun) return common

    let entities = built.entities
    let translationReport = { provider, candidates: plan.translationCandidates, translatedCandidates: 0 }
    if (provider !== 'none') {
      const translator = await this.createTranslator(translation)
      entities = await this.translateEntities(entities, { translator, fields, translation })
      const remaining = countTranslationCandidates(entities, fields)
      translationReport = {
        provider,
        candidates: plan.translationCandidates,
        translatedCandidates: Math.max(0, plan.translationCandidates - remaining),
        remainingCandidates: remaining
      }
    }

    const seed = await this.seedEntities(entities)
    return { ...common, entities, translation: translationReport, seed }
  }
}
