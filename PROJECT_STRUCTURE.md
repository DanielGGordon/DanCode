# Project Structure

```
DanCode/
├── docs/
│   └── PRD.md                  # Product requirements document
├── plans/
│   ├── dancode-mvp.md          # MVP implementation plan
│   └── dancode-future-phases.md
├── server/                     # Express + Socket.io backend
│   ├── src/
│   │   └── index.js            # Server entry point (Express, Socket.io, placeholder page)
│   ├── tests/
│   │   └── server.test.js      # Server unit tests
│   ├── package.json
│   └── README.md
├── PROJECT_STRUCTURE.md        # This file
└── README.md                   # Project overview
```

## Module boundaries

- **server/** — HTTP server and WebSocket layer. Serves the frontend build and handles all backend API/socket communication. See [server/README.md](server/README.md).
- **client/** — (planned) React + Vite frontend application.
