#!/usr/bin/env bash
# A4 — Secret scanning: cerca secret hardcoded nel repo (token, chiavi, password).
# Gate A4: zero match = nessun secret nel codice deployato. Esclude node_modules,
# dist, .git, lockfile, file di test (fixture deterministici) e questo script.
# Allineato al PRD §10 risk "secret nel repo" e al gate A4 "zero secret".
set -euo pipefail

ROOT="${1:-.}"
EXIT=0

# Pattern di secret comuni (regex estese). Ogni riga: nome|regex
PATTERNS=(
  "aws-access-key|AKIA[0-9A-Z]{16}"
  "generic-api-key|[Aa][Pp][Ii][_\-]?[Kk][Ee][Yy]\s*[:=]\s*['\"]?[A-Za-z0-9]{20,}['\"]?"
  "private-key-header|-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----"
  "jwt-secret-hardcoded|REVRA_JWT_SECRET\s*[:=]\s*['\"][^'\"]{8,}['\"]"
  "password-assignment|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]\s*[:=]\s*['\"][^'\"]{6,}['\"]"
  "github-token|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}"
  "high-entropy-hex-secret|['\"]([a-f0-9]{64})['\"]"
)

echo "== REVRA secret scan (A4) =="
for entry in "${PATTERNS[@]}"; do
  name="${entry%%|*}"
  regex="${entry#*|}"
  # grep ricorsivo sul codice deployato; esclude dir non-rilevanti, lockfile,
  # file di test (fixture deterministici, non secret produzione) e questo script.
  hits=$(grep -rInE \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
    --exclude-dir=.elan --exclude-dir=test \
    --exclude="*.lock" --exclude="secret-scan.sh" --exclude="*.lean" \
    --exclude="*.spec.ts" --exclude="*.test.ts" \
    "$regex" "$ROOT" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "[$name] POSSIBLE SECRET:"
    echo "$hits" | head -5
    EXIT=1
  fi
done

if [ "$EXIT" -eq 0 ]; then
  echo "OK: nessun secret hardcoded rilevato nel codice deployato."
else
  echo "FAIL: possibili secret rilevati (vedi sopra)."
fi
exit $EXIT