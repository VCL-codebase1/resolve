import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { userFromToken, cookieValue } from "./lib/auth";
import { hub } from "./lib/realtime";
import { getDb } from "./lib/db";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

await getDb();
await app.prepare();

const server = createServer((req, res) => {
  handle(req, res, parse(req.url || "/", true));
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const pathname = parse(request.url || "/").pathname;
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws: WebSocket, request: { headers: { cookie?: string } }) => {
  const token = cookieValue(request.headers.cookie ?? null, "desk_session");
  void userFromToken(token).then((user) => {
    if (!user) {
      ws.close(4401, "unauthorized");
      return;
    }
    hub().set(ws, user.id);
    ws.send(JSON.stringify({ type: "ready" }));
    ws.on("message", (raw) => {
      try {
        const body = JSON.parse(String(raw)) as { type?: string };
        if (body.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on("close", () => hub().delete(ws));
  });
});

server.listen(port, () => {
  console.log(`Desk is at http://localhost:${port}`);
});
