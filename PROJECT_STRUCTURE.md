# Project Structure

```
DanCode/
├── client/                     # React + Vite + Tailwind frontend
│   ├── public/                 # Static assets
│   ├── src/
│   │   ├── App.jsx             # Root React component
│   │   ├── index.css           # Tailwind + Solarized Dark theme
│   │   └── main.jsx            # Entry point
│   ├── index.html              # HTML shell
│   ├── vite.config.js          # Vite config (proxy, Tailwind plugin)
│   ├── package.json            # Includes vitest test scripts
│   └── README.md
├── docs/
│   └── PRD.md                  # Product requirements document
├── plans/
│   ├── dancode-mvp.md          # MVP implementation plan
│   └── dancode-future-phases.md
├── server/                     # Express + Socket.io backend
│   ├── src/
│   │   └── index.js            # Server entry point (Express, Socket.io, placeholder page)
│   ├── tests/
│   │   ├── e2e/
│   │   │   └── placeholder.spec.js  # Playwright E2E test
│   │   └── server.test.js      # Server unit tests
│   ├── package.json
│   ├── playwright.config.js    # Playwright config (system Chromium, webServer on :3001)
│   ├── vitest.config.js        # Vitest config (excludes e2e tests)
│   └── README.md
├── package.json                # Root workspace config + top-level scripts
├── PROJECT_STRUCTURE.md        # This file
└── README.md                   # Project overview
```

## Module boundaries

- **server/** — HTTP server and WebSocket layer. Serves the frontend build and handles all backend API/socket communication. See [server/README.md](server/README.md).
- **client/** — React + Vite + Tailwind CSS frontend. Dev server on port 5173 proxies API/WebSocket to the backend. See [client/README.md](client/README.md).
