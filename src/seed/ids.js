import { normalizeCanonicalEntityId } from '../domain/entity.js'
import { createHash } from 'node:crypto'

const NAMESPACE_URL_UUID = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)))
}

function uuidToBytes(uuid) {
  const hex = uuid.replaceAll('-', '')
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new TypeError('namespace must be a UUID')
  return hexToBytes(hex)
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uuidV5(name, namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8') {
  if (typeof name !== 'string' || !name) throw new TypeError('name is required')
  const hash = createHash('sha1')
    .update(Buffer.from(uuidToBytes(namespace)))
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  return bytesToUuid(hash)
}

export function entityPointId(entityOrId) {
  const rawId = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id
  const id = normalizeCanonicalEntityId(rawId)
  if (!id) throw new TypeError('canonical entity id is required')
  return uuidV5(`entity:${id}`, NAMESPACE_URL_UUID)
}

export const UUID_NAMESPACE_URL = NAMESPACE_URL_UUID
