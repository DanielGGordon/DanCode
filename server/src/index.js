import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const placeholderHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DanCode</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background-color: #002b36;
      color: #839496;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container {
      text-align: center;
    }
    h1 {
      color: #93a1a1;
      font-size: 3rem;
      font-weight: 300;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
    }
    p {
      color: #586e75;
      font-size: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>DanCode</h1>
    <p>Web-Based Project Terminal Manager</p>
  </div>
</body>
</html>`;

app.get('/', (req, res) => {
  res.type('html').send(placeholderHTML);
});

io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

export { app, httpServer, io };

export function startServer(port = PORT) {
  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      console.log(`DanCode server listening on http://localhost:${port}`);
      resolve(httpServer);
    });
  });
}

// Start the server when run directly (not imported for tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
