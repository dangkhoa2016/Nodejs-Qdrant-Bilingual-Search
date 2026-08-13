const jsonSchema = (ref) => ({ content: { 'application/json': { schema: { $ref: ref } } } })

export function buildOpenApiSpec({ version = '1.0.0' } = {}) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Node.js Qdrant Bilingual Search API',
      version,
      description: 'English/Vietnamese semantic search over Wikidata-derived open knowledge.'
    },
    paths: {
      '/health': { get: { summary: 'Liveness check', responses: { 200: { description: 'Process is alive' } } } },
      '/ready': {
        get: {
          summary: 'Dependency readiness check',
          responses: {
            200: { description: 'Ready', ...jsonSchema('#/components/schemas/ReadinessState') },
            503: { description: 'Dependency unavailable', ...jsonSchema('#/components/schemas/ReadinessState') }
          }
        }
      },
      '/api/v1/info': { get: { summary: 'Sanitized runtime and model configuration', responses: { 200: { description: 'Runtime information' } } } },
      '/api/v1/entities/{id}': {
        get: {
          summary: 'Get one entity by Wikidata QID',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^Q[1-9][0-9]*$' }, example: 'Q869' }],
          responses: { 200: { description: 'Entity' }, 400: { description: 'Invalid QID' }, 404: { description: 'Not found' }, 503: { description: 'Qdrant unavailable' } }
        }
      },
      '/api/v1/stats': { get: { summary: 'Normalized Qdrant collection statistics', responses: { 200: { description: 'Collection statistics' }, 503: { description: 'Qdrant unavailable' } } } },
      '/api/v1/search': {
        post: {
          summary: 'Dense multilingual semantic search with validated filters and structured consistency verification',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SearchRequest' },
                examples: {
                  vietnamese: { value: { query: 'quốc gia Đông Nam Á sử dụng đồng baht', language: 'vi', limit: 5 } },
                  filtered: { value: { query: 'large city in Asia', language: 'en', filter: { type: 'city', continent: 'Asia', population: { gte: 5000000 } }, limit: 10 } }
                }
              }
            }
          },
          responses: { 200: { description: 'Search results' }, 400: { description: 'Validation error' }, 503: { description: 'Search dependency unavailable' } }
        }
      }
    },
    components: {
      schemas: {
        ReadinessState: {
          type: 'object',
          required: ['ready', 'qdrant', 'embedding'],
          additionalProperties: false,
          properties: {
            ready: { type: 'boolean' },
            qdrant: {
              type: 'object',
              required: ['ready', 'provider', 'status', 'http_status', 'transport_code', 'latency_ms'],
              additionalProperties: false,
              properties: {
                ready: { type: 'boolean' },
                provider: { type: 'string', enum: ['local', 'beam', 'modal'] },
                status: { type: 'string', enum: ['ready', 'unavailable', 'unauthorized', 'error'] },
                http_status: { type: ['integer', 'null'] },
                transport_code: { type: ['string', 'null'] },
                latency_ms: { type: 'number', minimum: 0 }
              }
            },
            embedding: {
              type: 'object',
              required: ['ready', 'status'],
              additionalProperties: false,
              properties: {
                ready: { type: 'boolean' },
                status: { type: 'string', enum: ['ready', 'unavailable'] }
              }
            }
          }
        },
        SearchRequest: {
          type: 'object', required: ['query'], additionalProperties: false,
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 1000 },
            language: { type: 'string', enum: ['auto', 'en', 'vi'], default: 'auto' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
            score_threshold: { type: 'number', minimum: 0, maximum: 1 },
            filter: { $ref: '#/components/schemas/SearchFilter' }
          }
        },
        SearchFilter: {
          type: 'object', additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['country', 'city', 'landmark'] },
            continent: { type: 'string' }, region: { type: 'string' }, country_code: { type: 'string' }, source: { type: 'string' },
            population: {
              type: 'object', additionalProperties: false,
              properties: { gte: { type: 'number', minimum: 0 }, gt: { type: 'number', minimum: 0 }, lte: { type: 'number', minimum: 0 }, lt: { type: 'number', minimum: 0 } }
            }
          }
        }
      }
    }
  }
}

export function docsHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bilingual Search API Docs</title></head><body><main><h1>Node.js Qdrant Bilingual Search API</h1><p>The machine-readable OpenAPI 3.1 document is available at <a href="/openapi.json">/openapi.json</a>.</p><h2>Quick example</h2><pre>POST /api/v1/search\n{\n  "query": "quốc gia Đông Nam Á sử dụng đồng baht",\n  "language": "vi",\n  "limit": 5\n}</pre></main></body></html>`
}
