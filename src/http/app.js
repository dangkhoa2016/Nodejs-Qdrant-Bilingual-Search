import { Hono } from 'hono'
import { SearchValidationError } from '../search/search-service.js'
import { EntityValidationError } from '../entities/entity-service.js'
import { buildOpenApiSpec, docsHtml } from './openapi.js'
import { mapInfrastructureError } from './errors.js'

export function createApp({ readiness = async () => ({ ready: true }), searchService, entityService, info = () => null } = {}) {
  const app = new Hono()

  app.get('/openapi.json', (c) => c.json(buildOpenApiSpec()))
  app.get('/docs', (c) => c.html(docsHtml()))

  app.get('/health', (c) => c.json({ status: 'ok', service: 'nodejs-qdrant-bilingual-search' }))
  app.get('/ready', async (c) => {
    const state = await readiness()
    return c.json(state, state.ready ? 200 : 503)
  })
  app.get('/api/v1/info', (c) => c.json({ info: info() }))

  app.post('/api/v1/search', async (c) => {
    if (!searchService) return c.json({ error: { code: 'COLLECTION_NOT_READY', message: 'Search service is not configured' } }, 503)
    let body
    try { body = await c.req.json() }
    catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' } }, 400) }
    try {
      return c.json(await searchService.search(body))
    } catch (error) {
      if (error instanceof SearchValidationError) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, 400)
      }
      throw error
    }
  })

  app.get('/api/v1/entities/:id', async (c) => {
    if (!entityService) return c.json({ error: { code: 'COLLECTION_NOT_READY', message: 'Entity service is not configured' } }, 503)
    try {
      const entity = await entityService.getById(c.req.param('id'))
      if (!entity) return c.json({ error: { code: 'ENTITY_NOT_FOUND', message: 'Entity not found' } }, 404)
      return c.json({ entity })
    } catch (error) {
      if (error instanceof EntityValidationError) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, 400)
      }
      throw error
    }
  })

  app.get('/api/v1/stats', async (c) => {
    if (!entityService) return c.json({ error: { code: 'COLLECTION_NOT_READY', message: 'Entity service is not configured' } }, 503)
    return c.json({ stats: await entityService.stats() })
  })

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))
  app.onError((error, c) => {
    const infrastructure = mapInfrastructureError(error)
    if (infrastructure) return c.json(infrastructure.body, infrastructure.status)
    console.error(error)
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }, 500)
  })
  return app
}
