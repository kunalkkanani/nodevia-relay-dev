"use strict";

const net = require("net");
const WebSocket = require("ws");

const WS_PORT = 8080;
const TCP_PORT = 2222;

// Port on the device that tunnel traffic is forwarded to.
// Override with: TUNNEL_TARGET_PORT=9000 npm start
const TUNNEL_TARGET_PORT = parseInt(process.env.TUNNEL_TARGET_PORT || "22", 10);

// clients: id -> { ws, deviceId, tcpSocket }
const clients = new Map();
let nextClientId = 1;

// ─── WebSocket server (agents connect here) ────────────────────────────────

const wsServer = new WebSocket.Server({ port: WS_PORT });
console.log(`[relay] agent port  : ws://localhost:${WS_PORT}`);

wsServer.on("connection", (ws) => {
  const id = nextClientId++;
  const entry = { ws, deviceId: null, tcpSocket: null };
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
    console.log(`[>] client-${id} sent: ${text}`);
    handleMessage(id, ws, entry, text);
  });

  ws.on("close", () => {
    // Clean up any open tunnel when the agent disconnects
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
  const agent = getRegisteredAgent();

  if (!agent) {
    console.log("[tunnel] no registered agent — rejecting TCP connection");
    tcpSocket.destroy();
    return;
  }

  agent.tcpSocket = tcpSocket;
  console.log(
    `[tunnel] new connection → forwarding to '${agent.deviceId}' port ${TUNNEL_TARGET_PORT}`
  );

  // Tell the agent to open a TCP connection to the target port on its machine
  agent.ws.send(
    JSON.stringify({ type: "tunnel_open", host: "localhost", port: TUNNEL_TARGET_PORT })
  );

  // TCP data from the user → binary WebSocket frame → agent → local service
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
    ws.send(`echo:${text}`);
    return;
  }

  if (msg.type === "register") {
    entry.deviceId = msg.device_id;
    console.log(
      `[relay] registered device_id='${msg.device_id}' hostname='${msg.hostname}' platform='${msg.platform}'`
    );
    ws.send(JSON.stringify({ type: "ack", device_id: msg.device_id }));
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

// Returns the first agent that has completed registration.
function getRegisteredAgent() {
  for (const [, entry] of clients) {
    if (entry.deviceId) return entry;
  }
  return null;
}
