# Secret scanning

## Is this repo public?

Per `.gitignore`'s own comments (the notes about `FAST-SOCIO-SecurityHardening-Plan.md`
and `SECURITY-INCIDENT-2026-07-15.md`): *"This repo is public, so committing
any of them publishes that permanently — history, forks and mirrors survive a
later delete."* Treat the repo as public. If you're unsure this is still
accurate, verify at GitHub → repo → Settings → General → **Danger Zone** /
the visibility badge next to the repo name, since visibility can be changed
independently of this doc.

Public visibility matters directly for which GitHub features apply below —
some secret-scanning features are free for public repos and paid for private
ones on non-Enterprise plans.

## GitHub secret scanning + push protection

Where: GitHub → repo → **Settings → Code security and analysis**.

- **Secret scanning** — detects known secret formats (API keys, tokens
  matching known provider patterns) already pushed to the repo, including in
  history. Enable it. For a public repo this is available at no extra cost.
- **Push protection** — blocks a push *before* it lands if it contains a
  recognized secret pattern, rather than only alerting after the fact.
  Enable this too — it's the difference between "never happened" and "now in
  history forever, rotate it." Push protection can be enabled repo-wide or
  org-wide; check the org-level setting isn't overriding the repo one if
  changes don't seem to take effect.
- After enabling, if any existing alerts appear for already-committed
  secrets: follow `docs/security/secret-rotation.md` — rotate the flagged
  secret, then resolve the alert. Enabling scanning after the fact does not
  retroactively invalidate a leaked key; only rotation does.

Caveat on coverage: GitHub's secret scanning matches known provider token
*formats* (AWS, Stripe, Supabase service keys in some cases, etc. — pattern
list is maintained by GitHub and partner providers). It will not catch a
generic-looking secret with no recognizable format (e.g., a random 32-char
string used as an internal shared secret) unless a custom pattern is
configured for it. Custom patterns can be added under the same settings page
if this project ever introduces a secret shape GitHub doesn't already know.

## Local pre-commit scanning (gitleaks)

Push protection only catches things at push time; a local pre-commit hook
catches them before they're even committed locally, which matters if commits
are ever cherry-picked, rebased, or the branch is shared before push. Add
[gitleaks](https://github.com/gitleaks/gitleaks) as a pre-commit hook.

Concrete sketch (not installed by this doc — set up when adopted):

`.gitleaks.toml` at repo root:

```toml
title = "fast-socio gitleaks config"

[extend]
useDefault = true

# Project-specific allowlist: .env.example intentionally has no real values,
# and NEXT_PUBLIC_* vars are meant to be public — don't flag the key *names*.
[allowlist]
paths = [
  '''\.env\.example$''',
]
```

Pre-commit hook (using the `pre-commit` framework, `.pre-commit-config.yaml`):

```yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.4   # pin to a specific release, don't float on latest
    hooks:
      - id: gitleaks
```

Or, without the `pre-commit` framework, a plain git hook at
`.git/hooks/pre-commit` (not version-controlled by default, so this only
protects the local clone that installs it — not enforced repo-wide):

```sh
#!/bin/sh
gitleaks protect --staged --redact
```

### What this does and doesn't catch

- Catches: known secret patterns (AWS-style keys, JWTs, private keys, common
  API key shapes) in staged changes, and optionally the full history via
  `gitleaks detect`.
- Doesn't catch: secrets with no recognizable pattern, secrets pasted into
  non-text files it doesn't scan, or anything already committed before the
  hook was installed (run `gitleaks detect --source . --log-opts="--all"`
  once, manually, against full history to check for pre-existing leaks — this
  reads history, it does not modify it).
- Is entirely opt-in and local — a contributor who doesn't install the hook
  isn't protected by it. GitHub push protection is the backstop that applies
  regardless of local setup.
