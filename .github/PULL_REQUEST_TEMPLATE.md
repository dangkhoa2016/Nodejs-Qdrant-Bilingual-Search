## Summary

Describe the problem, intended outcome, and why this approach is appropriate.

## Scope

List the main files/components and any public contract affected.

## Validation

List the exact commands, tests, CI runs, or fresh-environment checks performed.

## Review checklist

- [ ] The change is focused and contains no unrelated refactoring.
- [ ] `npm test` passes when Node behavior or shared repository logic changed.
- [ ] Python embedding-service tests were run when the embedding service changed.
- [ ] Real Qdrant integration/semantic verification was run when the search/index path changed.
- [ ] English and Vietnamese user-facing documentation were updated together when applicable.
- [ ] Any semantic-contract, Qdrant snapshot, runtime, or public-topology change is explicit and requalified rather than inferred from old evidence.
- [ ] Release/evidence provenance remains truthful; an older runtime-evidence source is not relabeled as the current tip.
- [ ] No secrets, tokens, credentials, private endpoints, or unsanitized runtime artifacts are included.
- [ ] Security and dependency implications were considered.
- [ ] GitHub Actions CI is expected to pass for the final commit.

## Compatibility and release impact

State whether the change affects the accepted `v1.0.0` runtime/semantic contract, release assets, migration requirements, or known limitations. Write `None` when it does not.
