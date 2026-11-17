type Sock = { readyState: number; send: (data: string) => void };

type Hub = Map<Sock, string>;

function slot() {
  return globalThis as unknown as { __deskHub?: Hub };
}

export function hub() {
  const g = slot();
  if (!g.__deskHub) g.__deskHub = new Map();
  return g.__deskHub;
}

export function publish(userIds: string[], event: unknown) {
  if (userIds.length === 0) return;
  const allowed = new Set(userIds);
  const payload = JSON.stringify(event);
  for (const [sock, userId] of hub()) {
    if (allowed.has(userId) && sock.readyState === 1) sock.send(payload);
  }
}
