"use strict";

const WebSocket = require("ws");

const PORT = 8080;

// All connected clients: clientId (number) -> { ws, deviceId }
const clients = new Map();

let nextClientId = 1;

const server = new WebSocket.Server({ port: PORT });

console.log(`[relay] listening on ws://localhost:${PORT}`);

server.on("connection", (ws) => {
  const id = nextClientId++;
  clients.set(id, { ws, deviceId: null });

  console.log(`[+] client-${id} connected  (total: ${clients.size})`);

  ws.on("message", (data) => {
    const text = data.toString();
    console.log(`[>] client-${id} sent: ${text}`);
    handleMessage(id, ws, text);
  });

  ws.on("close", () => {
    const entry = clients.get(id);
    const label = entry?.deviceId ?? `client-${id}`;
    clients.delete(id);
    console.log(`[-] ${label} disconnected  (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error(`[!] client-${id} error: ${err.message}`);
  });
});

function handleMessage(id, ws, text) {
  let msg;

  try {
    msg = JSON.parse(text);
  } catch {
    // Not JSON — echo it back as a plain string
    ws.send(`echo:${text}`);
    return;
  }

  if (msg.type === "register") {
    // Store the device ID so disconnect logs show it
    const entry = clients.get(id);
    if (entry) entry.deviceId = msg.device_id;

    console.log(
      `[relay] registered device_id='${msg.device_id}' hostname='${msg.hostname}' platform='${msg.platform}'`
    );

    const ack = JSON.stringify({ type: "ack", device_id: msg.device_id });
    ws.send(ack);
    return;
  }

  // Unknown message type — echo it back so the agent can see it
  ws.send(JSON.stringify({ type: "echo", payload: msg }));
}
