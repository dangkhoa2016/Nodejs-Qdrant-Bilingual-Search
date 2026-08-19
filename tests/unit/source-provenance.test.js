import test from 'node:test'
import assert from 'node:assert/strict'
import { collectGitSourceProvenance } from '../../src/evaluation/source-provenance.js'

test('collectGitSourceProvenance records branch, commit and clean worktree state', async () => {
  const calls = []
  const runGit = async (args) => {
    calls.push(args)
    const key = args.join(' ')
    if (key === 'branch --show-current') return 'feat/example\n'
    if (key === 'rev-parse HEAD') return '0123456789abcdef0123456789abcdef01234567\n'
    if (key === 'status --porcelain') return ''
    throw new Error(`unexpected git call: ${key}`)
  }

  const provenance = await collectGitSourceProvenance({ runGit })

  assert.deepEqual(provenance, {
    branch: 'feat/example',
    head: '0123456789abcdef0123456789abcdef01234567',
    worktreeClean: true,
    dirtyEntriesCount: 0
  })
  assert.deepEqual(calls, [
    ['branch', '--show-current'],
    ['rev-parse', 'HEAD'],
    ['status', '--porcelain']
  ])
})

test('collectGitSourceProvenance reports detached and dirty state without exposing filenames', async () => {
  const runGit = async (args) => {
    const key = args.join(' ')
    if (key === 'branch --show-current') return '\n'
    if (key === 'rev-parse HEAD') return 'fedcba9876543210fedcba9876543210fedcba98\n'
    if (key === 'status --porcelain') return ' M src/app.js\n?? private-note.txt\n'
    throw new Error(`unexpected git call: ${key}`)
  }

  const provenance = await collectGitSourceProvenance({ runGit })

  assert.deepEqual(provenance, {
    branch: null,
    head: 'fedcba9876543210fedcba9876543210fedcba98',
    worktreeClean: false,
    dirtyEntriesCount: 2
  })
  assert.equal(JSON.stringify(provenance).includes('private-note.txt'), false)
})
