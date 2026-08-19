import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const repoFile = (path) => new URL(`../../${path}`, import.meta.url)

test('package exposes one-command real production domain/entity-intent acceptance', async () => {
  const pkg = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))
  assert.equal(
    pkg.scripts['acceptance:v21-production-domain-entity-intent:run'],
    'NODE_ENV=development node scripts/benchmark/v21-production-domain-entity-intent-acceptance.mjs'
  )
  assert.equal(
    pkg.scripts['acceptance:v21-production-domain-entity-intent'],
    'bash scripts/acceptance/v21-production-domain-entity-intent.sh'
  )
  await access(repoFile('scripts/benchmark/v21-production-domain-entity-intent-acceptance.mjs'))
  await access(repoFile('scripts/acceptance/v21-production-domain-entity-intent.sh'))
})

test('production domain/entity-intent wrapper verifies canonical/index/status and packages machine-readable evidence', async () => {
  const source = await readFile(repoFile('scripts/acceptance/v21-production-domain-entity-intent.sh'), 'utf8')
  assert.match(source, /verify:canonical-config/)
  assert.match(source, /verify:semantic-index -- 20000/)
  assert.match(source, /seed:status -- --once --expected 20000/)
  assert.match(source, /acceptance:v21-production-domain-entity-intent:run/)
  assert.match(source, /sha256sum/)
  assert.match(source, /zip -q/)
  assert.match(source, /V21_PRODUCTION_DOMAIN_ENTITY_INTENT_ACCEPTANCE=PASS/)
})


test('production domain/entity-intent acceptance embeds git source provenance in the report', async () => {
  const source = await readFile(repoFile('scripts/benchmark/v21-production-domain-entity-intent-acceptance.mjs'), 'utf8')
  assert.match(source, /collectGitSourceProvenance/)
  assert.match(source, /sourceProvenance/)
  assert.match(source, /source:\s*\{\s*git:\s*sourceProvenance\s*\}/s)
})
