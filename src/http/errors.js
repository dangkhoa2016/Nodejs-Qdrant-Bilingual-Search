import { QdrantConnectionError } from '../qdrant/qdrant-connection.js'

export function mapInfrastructureError(error) {
  if (error instanceof QdrantConnectionError) {
    return {
      status: 503,
      body: { error: { code: 'QDRANT_UNAVAILABLE', message: 'Qdrant is temporarily unavailable' } }
    }
  }
  return null
}
