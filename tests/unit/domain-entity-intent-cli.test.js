import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const repoFile = (path) => new URL(`../../${path}`, import.meta.url)

test('package exposes one-command domain/entity-intent experiment', async () => {
  const pkg = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))
  assert.equal(pkg.scripts['benchmark:v21-domain-entity-intent:run'], 'NODE_ENV=development node scripts/benchmark/v21-domain-entity-intent.mjs')
  assert.equal(pkg.scripts['benchmark:v21-domain-entity-intent'], 'bash scripts/benchmark/run-v21-domain-entity-intent.sh')
  await access(repoFile('scripts/benchmark/v21-domain-entity-intent.mjs'))
  await access(repoFile('scripts/benchmark/run-v21-domain-entity-intent.sh'))
})

test('domain/entity-intent wrapper verifies canonical/index/status and packages evidence without production mutation', async () => {
  const source = await readFile(repoFile('scripts/benchmark/run-v21-domain-entity-intent.sh'), 'utf8')
  assert.match(source, /verify:canonical-config/)
  assert.match(source, /verify:semantic-index -- 20000/)
  assert.match(source, /seed:status -- --once --expected 20000/)
  assert.match(source, /benchmark:v21-domain-entity-intent:run/)
  assert.match(source, /sha256sum/)
  assert.match(source, /zip -q/)
  assert.match(source, /V21_DOMAIN_ENTITY_INTENT_EXPERIMENT=PASS/)
})
