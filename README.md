# nodevia-relay-dev

A minimal WebSocket relay server for local development and testing.

> **Not for production.** This server has no authentication, no TLS, and no persistence.
> Its only job is to accept connections and echo messages so the Rust agent can be tested locally.

---

## How to run

```bash
npm install
npm start
```

The server starts on `ws://localhost:8080`.

---

## How to test manually

Install [wscat](https://github.com/websockets/wscat):

```bash
npm install -g wscat
```

Connect and send a message:

```bash
wscat -c ws://localhost:8080
> hello
< echo:hello
```

---

## Expected server output

```
[relay] listening on ws://localhost:8080
[+] client-1 connected  (total: 1)
[>] client-1 sent: hello
[-] client-1 disconnected  (total: 0)
```

---

## Purpose

Used to test the `nodevia-agent` Rust transport layer locally before connecting to a real relay.
