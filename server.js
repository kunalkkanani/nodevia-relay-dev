"use strict";

const WebSocket = require("ws");

const PORT = 8080;

// All connected clients: clientId (number) -> WebSocket instance
const clients = new Map();

// Simple incrementing counter — no need for UUIDs in a dev relay
let nextClientId = 1;

const server = new WebSocket.Server({ port: PORT });

console.log(`[relay] listening on ws://localhost:${PORT}`);

server.on("connection", (ws) => {
  const id = nextClientId++;
  clients.set(id, ws);

  console.log(`[+] client-${id} connected  (total: ${clients.size})`);

  // Echo every incoming message back so the agent can verify a full round-trip
  ws.on("message", (data) => {
    const text = data.toString();
    console.log(`[>] client-${id} sent: ${text}`);
    ws.send(`echo:${text}`);
  });

  ws.on("close", () => {
    clients.delete(id);
    console.log(`[-] client-${id} disconnected  (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error(`[!] client-${id} error: ${err.message}`);
  });
});
