import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function defaultRunGit(args, { cwd = process.cwd() } = {}) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  })
  return stdout
}

export async function collectGitSourceProvenance({ cwd = process.cwd(), runGit = defaultRunGit } = {}) {
  const branchRaw = await runGit(['branch', '--show-current'], { cwd })
  const headRaw = await runGit(['rev-parse', 'HEAD'], { cwd })
  const statusRaw = await runGit(['status', '--porcelain'], { cwd })

  const branch = String(branchRaw ?? '').trim() || null
  const head = String(headRaw ?? '').trim()
  const dirtyEntriesCount = String(statusRaw ?? '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .length

  return {
    branch,
    head,
    worktreeClean: dirtyEntriesCount === 0,
    dirtyEntriesCount
  }
}
