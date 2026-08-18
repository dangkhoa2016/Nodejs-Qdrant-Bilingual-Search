import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOpenApiSpec, docsHtml } from '../../src/http/openapi.js'

test('OpenAPI specification documents the stable search contract and safe filter surface', () => {
  const spec = buildOpenApiSpec({ version: '1.2.3' })
  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.info.version, '1.2.3')
  const request = spec.components.schemas.SearchRequest
  assert.deepEqual(request.required, ['query'])
  assert.equal(request.properties.query.maxLength, 1000)
  assert.deepEqual(request.properties.language.enum, ['auto', 'en', 'vi'])
  assert.equal(spec.components.schemas.SearchFilter.additionalProperties, false)
  assert.equal(spec.paths['/api/v1/search'].post.responses[400].description, 'Validation error')
})

test('OpenAPI documents structured provider-neutral readiness state', () => {
  const spec = buildOpenApiSpec()
  const readiness = spec.components.schemas.ReadinessState
  assert.deepEqual(readiness.required, ['ready', 'qdrant', 'embedding'])
  assert.deepEqual(readiness.properties.qdrant.properties.provider.enum, ['local', 'beam', 'modal'])
  assert.deepEqual(readiness.properties.qdrant.properties.status.enum, ['ready', 'unavailable', 'unauthorized', 'error'])
  assert.equal(spec.paths['/ready'].get.responses[200].content['application/json'].schema.$ref, '#/components/schemas/ReadinessState')
  assert.equal(spec.paths['/ready'].get.responses[503].content['application/json'].schema.$ref, '#/components/schemas/ReadinessState')
})

test('documentation HTML points to the machine-readable OpenAPI document', () => {
  assert.match(docsHtml(), /href="\/openapi\.json"/)
  assert.match(docsHtml(), /quốc gia Đông Nam Á/)
})
