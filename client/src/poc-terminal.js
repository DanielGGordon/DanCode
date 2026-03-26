import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { io } from 'socket.io-client';

const params = new URLSearchParams(location.search);
const terminalId = params.get('id');
const token = params.get('token');

if (!terminalId || !token) {
  document.body.innerHTML = '<p style="color:#dc322f;padding:1rem;">Missing ?id=...&amp;token=... query params</p>';
} else {
  const term = new Terminal({
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
    },
    cursorBlink: true,
    fontFamily: 'monospace',
    fontSize: 14,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal'));
  fitAddon.fit();

  // Expose for E2E testing
  window.term = term;

  const socket = io(`/terminal/${terminalId}`, {
    auth: { token },
    transports: ['websocket'],
  });

  window.socket = socket;

  socket.on('connect', () => {
    document.title = 'DanCode Terminal POC - Connected';
    socket.emit('resize', { cols: term.cols, rows: term.rows });
  });

  socket.on('output', (data) => {
    term.write(data);
  });

  term.onData((data) => {
    socket.emit('input', data);
  });

  socket.on('disconnect', () => {
    document.title = 'DanCode Terminal POC - Disconnected';
  });

  window.addEventListener('resize', () => {
    fitAddon.fit();
    socket.emit('resize', { cols: term.cols, rows: term.rows });
  });
}
