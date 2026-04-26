"use strict";

const net = require("net");
const WebSocket = require("ws");

const WS_PORT = parseInt(process.env.WS_PORT || "8080", 10);
const TCP_PORT = parseInt(process.env.TCP_PORT || "2222", 10);
const TUNNEL_TARGET_PORT = parseInt(process.env.TUNNEL_TARGET_PORT || "22", 10);

// If set, every agent must send a matching token in its Register message.
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || null;

// If set, TCP connections are routed only to the named device.
// If unset, routes to the first registered device (single-device mode).
const TARGET_DEVICE_ID = process.env.TARGET_DEVICE_ID || null;

// clients: id -> { ws, deviceId, tcpSocket }
const clients = new Map();
let nextClientId = 1;

// ─── WebSocket server (agents connect here) ────────────────────────────────

const wsServer = new WebSocket.Server({ port: WS_PORT });
console.log(`[relay] agent port  : ws://localhost:${WS_PORT}`);
if (DEVICE_TOKEN) {
  console.log(`[relay] auth        : token required`);
} else {
  console.log(`[relay] auth        : WARN — no DEVICE_TOKEN set, all agents accepted`);
}

wsServer.on("connection", (ws) => {
  const id = nextClientId++;
  const entry = { ws, deviceId: null, authenticated: false, tcpSocket: null };
  clients.set(id, entry);

  console.log(`[+] client-${id} connected  (total: ${clients.size})`);

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      // Raw tunnel data from agent → forward to the TCP client
      if (entry.tcpSocket && !entry.tcpSocket.destroyed) {
        entry.tcpSocket.write(data);
      }
      return;
    }

    const text = data.toString();
    handleMessage(id, ws, entry, text);
  });

  ws.on("close", () => {
    if (entry.tcpSocket && !entry.tcpSocket.destroyed) {
      entry.tcpSocket.destroy();
    }
    const label = entry.deviceId ?? `client-${id}`;
    clients.delete(id);
    console.log(`[-] ${label} disconnected  (total: ${clients.size})`);
  });

  ws.on("error", (err) => {
    console.error(`[!] client-${id} error: ${err.message}`);
  });
});

// ─── TCP server (users connect here to tunnel into the device) ─────────────

const tcpServer = net.createServer((tcpSocket) => {
  const agent = getTargetAgent();

  if (!agent) {
    const reason = TARGET_DEVICE_ID
      ? `device '${TARGET_DEVICE_ID}' not connected`
      : "no registered agent";
    console.log(`[tunnel] ${reason} — rejecting TCP connection`);
    tcpSocket.destroy();
    return;
  }

  agent.tcpSocket = tcpSocket;
  console.log(
    `[tunnel] new connection → forwarding to '${agent.deviceId}' port ${TUNNEL_TARGET_PORT}`
  );

  agent.ws.send(
    JSON.stringify({ type: "tunnel_open", host: "localhost", port: TUNNEL_TARGET_PORT })
  );

  tcpSocket.on("data", (data) => {
    if (agent.ws.readyState === WebSocket.OPEN) {
      agent.ws.send(data);
    }
  });

  tcpSocket.on("close", () => {
    console.log("[tunnel] TCP client disconnected — sending tunnel_close to agent");
    if (agent.ws.readyState === WebSocket.OPEN) {
      agent.ws.send(JSON.stringify({ type: "tunnel_close" }));
    }
    agent.tcpSocket = null;
  });

  tcpSocket.on("error", (err) => {
    console.error(`[tunnel] TCP error: ${err.message}`);
  });
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`[relay] tunnel port : localhost:${TCP_PORT} → device:${TUNNEL_TARGET_PORT}`);
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function handleMessage(id, ws, entry, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "invalid JSON" }));
    return;
  }

  if (msg.type === "register") {
    // Token validation — reject immediately if token doesn't match
    if (DEVICE_TOKEN) {
      if (msg.token !== DEVICE_TOKEN) {
        console.warn(`[auth] client-${id} rejected — invalid or missing token`);
        ws.send(JSON.stringify({ type: "error", message: "unauthorized" }));
        ws.close(1008, "unauthorized");
        return;
      }
    }

    entry.deviceId = msg.device_id;
    entry.authenticated = true;
    console.log(
      `[relay] registered device_id='${msg.device_id}' hostname='${msg.hostname}' platform='${msg.platform}'`
    );
    ws.send(JSON.stringify({ type: "ack", device_id: msg.device_id }));
    return;
  }

  // All other messages require a completed registration
  if (!entry.authenticated) {
    console.warn(`[auth] client-${id} sent '${msg.type}' before registering — closing`);
    ws.close(1008, "register first");
    return;
  }

  if (msg.type === "tunnel_close") {
    console.log(`[tunnel] agent '${entry.deviceId}' closed tunnel`);
    if (entry.tcpSocket && !entry.tcpSocket.destroyed) {
      entry.tcpSocket.destroy();
      entry.tcpSocket = null;
    }
    return;
  }

  // Unknown — echo back
  ws.send(JSON.stringify({ type: "echo", payload: msg }));
}

// Returns the target agent for a new TCP connection.
// If TARGET_DEVICE_ID is set, finds that specific device.
// Otherwise returns the first authenticated agent.
function getTargetAgent() {
  for (const [, entry] of clients) {
    if (!entry.authenticated) continue;
    if (TARGET_DEVICE_ID && entry.deviceId !== TARGET_DEVICE_ID) continue;
    return entry;
  }
  return null;
}
