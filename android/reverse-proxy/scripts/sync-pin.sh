#!/usr/bin/env bash
# Compute the SHA-256 of the SubjectPublicKeyInfo (SPKI) of the cert at
# android/reverse-proxy/certs/server.crt, then:
#   1. Copy the cert into android/app/src/main/res/raw/dancode_server.crt so
#      the network_security_config block can use it as a trust anchor.
#   2. Rewrite the single <pin digest="SHA-256">…</pin> entry in
#      android/app/src/main/res/xml/network_security_config.xml.
#
# Idempotent. Run after every regenerate-cert.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CERT="$REPO_ROOT/android/reverse-proxy/certs/server.crt"
RAW_DIR="$REPO_ROOT/android/app/src/main/res/raw"
NSC="$REPO_ROOT/android/app/src/main/res/xml/network_security_config.xml"

[ -f "$CERT" ] || { echo "Cert not found at $CERT — run generate-cert.sh first" >&2; exit 1; }

PIN="$(openssl x509 -in "$CERT" -pubkey -noout -outform pem \
        | openssl pkey -pubin -outform der \
        | openssl dgst -sha256 -binary \
        | openssl enc -base64)"

mkdir -p "$RAW_DIR"
cp "$CERT" "$RAW_DIR/dancode_server.crt"

# Rewrite only the literal pin value, keeping the rest of the XML byte-for-byte.
python3 - "$NSC" "$PIN" <<'PY'
import re, sys
path, pin = sys.argv[1], sys.argv[2]
with open(path) as fh:
    text = fh.read()
new = re.sub(
    r'(<pin digest="SHA-256">)[^<]+(</pin>)',
    lambda m: m.group(1) + pin + m.group(2),
    text,
    count=1,
)
with open(path, "w") as fh:
    fh.write(new)
PY

echo "Pinned SPKI hash: $PIN"
echo "Updated         : $NSC"
echo "Copied cert     : $RAW_DIR/dancode_server.crt"
