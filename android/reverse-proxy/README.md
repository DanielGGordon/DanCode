# DanCode reverse proxy (Phase 2)

Caddy terminates TLS on **`https://5.78.231.51:8443`** with a self-signed
cert and forwards everything to the existing dancode-server on plain
`http://127.0.0.1:3000`.  Two consequences worth pinning down:

- The legacy plain `http://5.78.231.51:3000` URL keeps working — the web
  client is unaffected.  Only the new port adds TLS.
- The cert covers the bare IP only (no DNS), because Techloq filters new
  hostnames.  The Android app pins the cert's SPKI hash in
  `app/src/main/res/xml/network_security_config.xml` and rejects any other
  certificate.

## Layout

```
android/reverse-proxy/
├── Caddyfile                 # config (committed)
├── install.sh                # copy cert + symlink Caddyfile into /etc/caddy
├── certs/
│   ├── server.crt            # self-signed cert (committed for repeatable tests)
│   └── server.key            # private key (gitignored — see notes)
└── scripts/
    ├── generate-cert.sh      # mint a new self-signed cert
    ├── sync-pin.sh           # copy cert → app raw/, rewrite pin in NSC.xml
    └── publish-apk.sh        # build :app:assembleDebug, copy → /var/lib/dancode-apk/
```

**About `server.key`.** This is a *self-signed dev cert*; nothing about the
private key is sensitive in the sense of guarding a public-domain TLS
identity — there is no CA to trust it, only the explicit SPKI pin in the
app.  Even so, the key is gitignored: leaking it would let anyone with a
matching network position MITM the pinned channel until a new cert is
minted and the app re-pinned.  Re-run `generate-cert.sh` whenever you
suspect compromise, then `sync-pin.sh`, then re-publish the APK.

## One-time setup on the Hetzner box

```bash
# 1. Mint the cert (key + crt land under reverse-proxy/certs/)
./scripts/generate-cert.sh

# 2. Update the Android app's pin to match the new cert
./scripts/sync-pin.sh

# 3. Build a debug APK signed with the local dev key; publish under
#    /var/lib/dancode-apk/dancode-android-debug.apk
./scripts/publish-apk.sh

# 4. Install Caddy config + cert into /etc/caddy and reload Caddy
sudo ./install.sh
sudo systemctl reload caddy
```

After that:

- The phone fetches the APK from
  `https://5.78.231.51:8443/downloads/dancode-android-debug.apk` (one
  tap; browser will warn about the self-signed cert, accept once).
- The installed app talks to `https://5.78.231.51:8443/api/*` with the
  cert pinned.
- Anything still pointing at `http://5.78.231.51:3000` keeps working.

## Tests

There is no Gradle test that hits a live Caddy — the gated test path is
fully headless.  The pin and config are exercised by:

- `app/src/test/java/com/dancode/android/net/NetworkSecurityConfigTest.kt`
  asserts the pin block exists, is scoped to `5.78.231.51`, uses a real
  SHA-256 digest, and that the manifest wires it.
- Manual acceptance: see `docs/post-deploy-smoke.md` (Phase 0+) — the
  pinned login + dashboard load on a real phone is the end-to-end gate.
