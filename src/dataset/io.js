import { readFile } from 'node:fs/promises'
import { normalizeEntity } from '../domain/entity.js'

export async function loadEntities(path) {
  const raw = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(raw)) throw new TypeError('dataset root must be an array')
  const seen = new Set()
  return raw.map((record, index) => {
    const entity = normalizeEntity(record)
    if (seen.has(entity.id)) throw new TypeError(`duplicate entity id ${entity.id} at index ${index}`)
    seen.add(entity.id)
    return entity
  })
}
