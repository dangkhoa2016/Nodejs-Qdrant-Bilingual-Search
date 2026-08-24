# Security Policy

## Supported versions

| Version | Security support |
| --- | --- |
| `v1.0.0` | Supported for the published release scope |
| `main` | Best-effort while changes are under review |
| Older/unpublished states | Not supported as release targets |

## Reporting a vulnerability

Do **not** open a public issue containing exploit details, credentials, private endpoints, or sensitive runtime evidence.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository when it is available. If that private channel is unavailable, create only a minimal public issue requesting a private reporting channel; do not include vulnerability details until a private channel has been established.

A useful private report includes:

- affected commit/tag and component;
- impact and realistic attack preconditions;
- minimal reproduction steps or proof of concept;
- whether credentials, tokens, public tunnel exposure, Qdrant access, or evidence packaging are involved;
- suggested mitigation when known.

## Security-sensitive areas

Review is especially strict for:

- Bearer-token generation, storage, and authentication;
- public-tunnel routing and loopback-only backend guarantees;
- Qdrant and embedding-service exposure;
- evidence collection, redaction, and secret scanning;
- dependency and GitHub Actions updates;
- dataset/provider credentials and environment-variable handling.

## Secret handling

Never commit or attach real API keys, Bearer tokens, private tunnel URLs, credential-bearing command lines, or unsanitized runtime archives. If a secret is exposed, revoke or rotate it first; removing it from Git history alone is not sufficient.

## Disclosure

Maintainers will validate the report, determine affected scope, coordinate remediation, and publish an appropriate advisory or release note when disclosure is safe. Runtime evidence and release provenance will not be rewritten to imply validation that did not actually occur.
