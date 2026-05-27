function readInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function readStringList(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export const BRIDGE_CONFIG = {
  bindHost: process.env.BRIDGE_BIND_HOST ?? "0.0.0.0",
  wsPort: readInteger("BRIDGE_WS_PORT", 8080),
  wsPath: process.env.BRIDGE_WS_PATH ?? "/",
  udpHost: process.env.BRIDGE_UDP_HOST ?? "0.0.0.0",
  udpPortStart: readInteger("BRIDGE_UDP_PORT_START", 8001),
  udpPortEnd: readInteger("BRIDGE_UDP_PORT_END", 8050),
  publicHost: process.env.BRIDGE_PUBLIC_HOST ?? "",
  allowedOrigins: readStringList("BRIDGE_ALLOWED_ORIGINS"),
  noClientGraceMs: readInteger("BRIDGE_NO_CLIENT_GRACE_MS", 30_000),
  idleRoomMs: readInteger("BRIDGE_IDLE_ROOM_MS", 15 * 60_000),
  heartbeatMs: readInteger("BRIDGE_HEARTBEAT_MS", 30_000),
  maxMessageBytes: readInteger("BRIDGE_MAX_MESSAGE_BYTES", 16_384),
  rawLogBytes: readInteger("BRIDGE_RAW_LOG_BYTES", 96)
};
