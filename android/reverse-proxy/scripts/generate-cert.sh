#!/usr/bin/env bash
# Generate the self-signed TLS cert + key the reverse proxy serves on
# https://5.78.231.51:8443 and write them under android/reverse-proxy/certs/.
#
# DanCode runs without a domain (Techloq filters new hostnames), so the cert
# uses the bare IP as both Common Name and Subject Alternative Name.  The
# Android client pins the SPKI hash of this cert via network_security_config
# — re-run scripts/sync-pin.sh after regenerating to keep the app in sync.

set -euo pipefail

DAYS="${DAYS:-3650}"
SUBJECT_IP="${SUBJECT_IP:-5.78.231.51}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"

mkdir -p "$OUT_DIR"

openssl req \
    -x509 \
    -newkey rsa:2048 \
    -keyout "$OUT_DIR/server.key" \
    -out    "$OUT_DIR/server.crt" \
    -sha256 \
    -days "$DAYS" \
    -nodes \
    -subj "/CN=$SUBJECT_IP" \
    -addext "subjectAltName=IP:$SUBJECT_IP"

chmod 600 "$OUT_DIR/server.key"

echo
echo "Cert written to $OUT_DIR/server.crt"
echo "Key  written to $OUT_DIR/server.key"
echo
echo "Run scripts/sync-pin.sh to copy the cert into the Android app and"
echo "update the pinned SPKI hash in network_security_config.xml."
