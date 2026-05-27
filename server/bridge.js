import crypto from "node:crypto";
import dgram from "node:dgram";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import osc from "osc";
import { WebSocketServer, WebSocket } from "ws";
import { BRIDGE_CONFIG } from "./config.js";

const SENSOR_AXIS_NAMES = new Set([
  "x",
  "y",
  "z",
  "pitch",
  "roll",
  "yaw",
  "relative",
  "pressure",
  "level",
  "bpm",
  "delta"
]);

const MOTION_KINDS = new Set([
  "accel",
  "acceleration",
  "gravity",
  "gyro",
  "gyroscope",
  "rotation",
  "motion",
  "magnetic",
  "magnetometer",
  "altitude",
  "battery",
  "crown"
]);

export class BridgeServer {
  constructor(config = {}) {
    this.config = { ...BRIDGE_CONFIG, ...config };
    this.rooms = new Map();
    this.roomsByUdpPort = new Map();
    this.httpServer = null;
    this.wss = null;
    this.heartbeatTimer = null;
    this.cleanupTimer = null;
  }

  async start() {
    if (this.httpServer) {
      return this;
    }

    this.httpServer = http.createServer((request, response) => {
      if (request.url === "/health") {
        this.sendHttpJson(response, 200, {
          ok: true,
          rooms: this.rooms.size,
          udpPortRange: [this.config.udpPortStart, this.config.udpPortEnd]
        });
        return;
      }

      this.sendHttpJson(response, 404, { ok: false, error: "not_found" });
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: this.config.wsPath
    });

    this.wss.on("connection", (socket, request) =>
      this.handleWebSocketConnection(socket, request)
    );

    await new Promise((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(
        this.config.wsPort,
        this.config.bindHost,
        resolve
      );
    });

    this.heartbeatTimer = setInterval(
      () => this.pingClients(),
      this.config.heartbeatMs
    );
    this.cleanupTimer = setInterval(() => this.cleanupExpiredRooms(), 10_000);

    console.info("TDInput bridge listening.", {
      ws: `${this.config.bindHost}:${this.config.wsPort}${this.config.wsPath}`,
      udp: `${this.config.udpHost}:${this.config.udpPortStart}-${this.config.udpPortEnd}`,
      publicHost: this.config.publicHost || "(from request host)"
    });

    return this;
  }

  async close() {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.cleanupTimer);

    for (const room of this.rooms.values()) {
      this.closeUdpSocket(room);
      if (room.client?.readyState === WebSocket.OPEN) {
        room.client.close(1001, "Bridge shutting down");
      }
    }

    await new Promise((resolve) => {
      if (!this.wss) {
        resolve();
        return;
      }

      this.wss.close(() => resolve());
    });

    await new Promise((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }

      this.httpServer.close(() => resolve());
    });

    this.rooms.clear();
    this.roomsByUdpPort.clear();
    this.httpServer = null;
    this.wss = null;
  }

  sendHttpJson(response, statusCode, payload) {
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body)
    });
    response.end(body);
  }

  handleWebSocketConnection(socket, request) {
    const origin = request.headers.origin ?? "";

    if (!this.isOriginAllowed(origin)) {
      console.warn("WebSocket rejected by origin policy.", { origin });
      socket.close(1008, "Origin not allowed");
      return;
    }

    socket.isAlive = true;
    socket.roomId = null;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    console.info("WebSocket client connected.", {
      origin: origin || "(none)",
      remoteAddress: request.socket.remoteAddress
    });

    socket.on("message", (data) =>
      this.handleWebSocketMessage(socket, request, data)
    );
    socket.on("close", () => this.handleWebSocketClose(socket));
    socket.on("error", (error) => {
      console.warn("WebSocket client error.", { error: error.message });
    });

    this.sendJson(socket, {
      type: "bridge-ready",
      wsPort: this.config.wsPort,
      udpPortRange: [this.config.udpPortStart, this.config.udpPortEnd]
    });
  }

  isOriginAllowed(origin) {
    if (!this.config.allowedOrigins.length) {
      return true;
    }

    if (!origin) {
      return true;
    }

    return (
      this.config.allowedOrigins.includes("*") ||
      this.config.allowedOrigins.includes(origin)
    );
  }

  async handleWebSocketMessage(socket, request, data) {
    if (Buffer.byteLength(data) > this.config.maxMessageBytes) {
      socket.close(1009, "Message too large");
      return;
    }

    let message = null;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.sendError(socket, "invalid_json", "Message must be JSON.");
      return;
    }

    if (!message || typeof message.type !== "string") {
      this.sendError(socket, "invalid_message", "Message type is required.");
      return;
    }

    if (message.type === "create-room") {
      await this.handleCreateRoom(socket, request, message);
      return;
    }

    if (message.type === "resume-room") {
      this.handleResumeRoom(socket, request, message);
      return;
    }

    if (message.type === "release-room") {
      this.handleReleaseRoom(socket, message);
      return;
    }

    if (message.type === "ping") {
      this.sendJson(socket, { type: "pong", receivedAt: Date.now() });
      return;
    }

    this.sendError(socket, "unknown_type", `Unknown message type ${message.type}.`);
  }

  async handleCreateRoom(socket, request, message) {
    const mode = this.normalizeMode(message.mode);
    if (!mode) {
      this.sendError(socket, "invalid_mode", "Mode must be phone or watch.");
      return;
    }

    try {
      const room = await this.createRoom(mode, request);
      this.attachClientToRoom(room, socket);
      this.sendJson(socket, {
        type: "room-created",
        room: this.getRoomPayload(room, request)
      });
    } catch (error) {
      console.warn("Room creation failed.", { error: error.message });
      this.sendError(socket, "room_unavailable", error.message);
    }
  }

  handleResumeRoom(socket, request, message) {
    const roomId = this.normalizeRoomId(message.roomId);
    const roomToken = typeof message.roomToken === "string" ? message.roomToken : "";
    const room = roomId ? this.rooms.get(roomId) : null;

    if (!room || room.token !== roomToken) {
      this.sendError(socket, "resume_failed", "Room was not found or token is invalid.");
      return;
    }

    this.attachClientToRoom(room, socket);
    this.sendJson(socket, {
      type: "room-resumed",
      room: this.getRoomPayload(room, request)
    });
    console.info("Room resumed.", {
      roomId: room.id,
      udpPort: room.udpPort
    });
  }

  handleReleaseRoom(socket, message) {
    const roomId = this.normalizeRoomId(message.roomId ?? socket.roomId);
    const roomToken = typeof message.roomToken === "string" ? message.roomToken : "";
    const room = roomId ? this.rooms.get(roomId) : null;

    if (!room || (roomToken && room.token !== roomToken)) {
      this.sendError(socket, "release_failed", "Room was not found.");
      return;
    }

    this.cleanupRoom(room.id, "client release");
  }

  normalizeMode(mode) {
    if (mode === "phone" || mode === "smartphone") {
      return "phone";
    }

    if (mode === "watch" || mode === "apple-watch") {
      return "watch";
    }

    return null;
  }

  normalizeRoomId(roomId) {
    const normalized = String(roomId ?? "").trim();
    return /^[0-9]{4}$/.test(normalized) ? normalized : null;
  }

  async createRoom(mode, request) {
    const roomId = this.createRoomId();
    const token = crypto.randomBytes(18).toString("hex");
    let lastError = null;

    for (
      let udpPort = this.config.udpPortStart;
      udpPort <= this.config.udpPortEnd;
      udpPort += 1
    ) {
      if (this.roomsByUdpPort.has(udpPort)) {
        continue;
      }

      const room = {
        id: roomId,
        token,
        mode,
        udpPort,
        udpSocket: null,
        client: null,
        createdAt: Date.now(),
        lastClientAt: Date.now(),
        lastActivityAt: Date.now(),
        lastPacketAt: null,
        packetCount: 0,
        sensorState: this.createSensorState(),
        requestHost: request.headers.host ?? ""
      };

      try {
        room.udpSocket = await this.bindUdpSocket(room);
        this.rooms.set(room.id, room);
        this.roomsByUdpPort.set(room.udpPort, room);
        console.info("Room created.", {
          roomId: room.id,
          mode: room.mode,
          udpPort: room.udpPort
        });
        return room;
      } catch (error) {
        lastError = error;
        this.closeUdpSocket(room);
      }
    }

    throw new Error(
      `No UDP ports available in ${this.config.udpPortStart}-${this.config.udpPortEnd}. ` +
        (lastError ? `Last bind error: ${lastError.message}` : "")
    );
  }

  createRoomId() {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const value = crypto.randomInt(1000, 10000).toString();
      if (!this.rooms.has(value)) {
        return value;
      }
    }

    throw new Error("Unable to allocate a unique room id.");
  }

  createSensorState() {
    return {
      phone: this.createDeviceSensorState(),
      watch: this.createDeviceSensorState(),
      lastHeartRate: null
    };
  }

  createDeviceSensorState() {
    return {
      accel: { x: null, y: null, z: null, magnitude: null },
      gyro: { x: null, y: null, z: null, magnitude: null },
      rotation: { x: null, y: null, z: null, magnitude: null },
      motion: { pitch: null, roll: null, yaw: null, magnitude: null },
      gravity: { x: null, y: null, z: null, magnitude: null },
      magnetic: { x: null, y: null, z: null, magnitude: null }
    };
  }

  bindUdpSocket(room) {
    const socket = dgram.createSocket("udp4");
    let listening = false;

    socket.on("message", (packet, rinfo) =>
      this.handleUdpPacket(room, packet, rinfo)
    );

    socket.on("error", (error) => {
      console.warn("UDP socket error.", {
        roomId: room.id,
        udpPort: room.udpPort,
        error: error.message
      });

      if (listening) {
        this.cleanupRoom(room.id, "udp socket error");
      }
    });

    return new Promise((resolve, reject) => {
      const rejectBeforeListening = (error) => {
        if (!listening) {
          reject(error);
        }
      };

      socket.once("error", rejectBeforeListening);
      socket.once("listening", () => {
        listening = true;
        socket.off("error", rejectBeforeListening);
        console.info("UDP port assigned.", {
          roomId: room.id,
          udpPort: room.udpPort
        });
        resolve(socket);
      });
      socket.bind(room.udpPort, this.config.udpHost);
    });
  }

  attachClientToRoom(room, socket) {
    if (room.client && room.client !== socket) {
      room.client.close(4002, "Room reconnected from another socket");
    }

    room.client = socket;
    room.lastClientAt = Date.now();
    room.lastActivityAt = Date.now();
    socket.roomId = room.id;

    console.info("WebSocket client attached to room.", {
      roomId: room.id,
      udpPort: room.udpPort,
      mode: room.mode
    });
  }

  handleWebSocketClose(socket) {
    const room = socket.roomId ? this.rooms.get(socket.roomId) : null;
    if (room && room.client === socket) {
      room.client = null;
      room.lastClientAt = Date.now();
      room.lastActivityAt = Date.now();
      console.info("WebSocket client disconnected from room.", {
        roomId: room.id,
        udpPort: room.udpPort
      });
    }
  }

  handleUdpPacket(room, packet, rinfo) {
    room.packetCount += 1;
    room.lastPacketAt = Date.now();
    room.lastActivityAt = Date.now();

    const raw = this.describeRawPacket(packet);
    console.info("UDP packet received.", {
      roomId: room.id,
      udpPort: room.udpPort,
      from: `${rinfo.address}:${rinfo.port}`,
      bytes: packet.length,
      text: raw.text,
      hex: raw.hex
    });

    const parsed = this.parsePacket(packet);
    const sensor = this.updateSensorState(room, parsed.messages);

    if (sensor.readings.length) {
      console.info("Parsed sensor value.", {
        roomId: room.id,
        readings: sensor.readings,
        acceleration: sensor.acceleration,
        heartRate: sensor.heartRate
      });
    }

    const payload = {
      type: "sensor-data",
      roomId: room.id,
      mode: room.mode,
      receivedAt: room.lastPacketAt,
      packetCount: room.packetCount,
      source: {
        address: rinfo.address,
        port: rinfo.port
      },
      raw,
      osc: parsed.osc,
      sensor
    };

    if (room.client?.readyState === WebSocket.OPEN) {
      this.sendJson(room.client, payload);
      console.info("Message forwarded to room.", {
        roomId: room.id,
        udpPort: room.udpPort
      });
    }
  }

  describeRawPacket(packet) {
    const slice = packet.subarray(0, this.config.rawLogBytes);
    const text = slice
      .toString("utf8")
      .replace(/[^\x20-\x7E]+/g, " ")
      .trim();

    return {
      length: packet.length,
      hex: slice.toString("hex"),
      text
    };
  }

  parsePacket(packet) {
    const messages = [];
    let oscPacket = null;
    let oscError = null;

    try {
      oscPacket = osc.readPacket(packet, {
        metadata: true,
        unpackSingleArgs: false
      });
      this.collectOscMessages(oscPacket, messages);
    } catch (error) {
      oscError = error.message;
      this.collectTextMessages(packet, messages);
    }

    return {
      osc: {
        ok: !oscError,
        error: oscError,
        messages: messages.map((message) => ({
          address: message.address,
          args: message.args
        }))
      },
      messages
    };
  }

  collectOscMessages(packet, messages) {
    if (!packet) {
      return;
    }

    if (Array.isArray(packet.packets)) {
      packet.packets.forEach((child) => this.collectOscMessages(child, messages));
      return;
    }

    if (typeof packet.address === "string") {
      messages.push({
        address: packet.address,
        args: this.normalizeOscArgs(packet.args)
      });
    }
  }

  normalizeOscArgs(args = []) {
    return args.map((arg) => {
      if (typeof arg === "number") {
        return arg;
      }

      if (arg && typeof arg === "object" && "value" in arg) {
        return arg.value;
      }

      return arg;
    });
  }

  collectTextMessages(packet, messages) {
    const text = packet.toString("utf8").trim();
    if (!text) {
      return;
    }

    try {
      const payload = JSON.parse(text);
      this.collectJsonSensorMessages(payload, messages);
      return;
    } catch {
      // Keep trying plain text formats.
    }

    const match = text.match(
      /(?<address>\/[A-Za-z0-9/_,-]+)\s+(?<values>[-+0-9eE.,\s]+)/
    );
    if (!match?.groups) {
      return;
    }

    messages.push({
      address: match.groups.address,
      args: match.groups.values
        .split(/[,\s]+/)
        .map((value) => Number.parseFloat(value))
        .filter(Number.isFinite)
    });
  }

  collectJsonSensorMessages(payload, messages, prefix = "") {
    if (!payload || typeof payload !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(payload)) {
      const address = `${prefix}/${key}`;
      if (typeof value === "number") {
        messages.push({ address, args: [value] });
      } else if (Array.isArray(value)) {
        messages.push({ address, args: value.filter(Number.isFinite) });
      } else if (value && typeof value === "object") {
        this.collectJsonSensorMessages(value, messages, address);
      }
    }
  }

  updateSensorState(room, messages) {
    const readings = [];

    for (const message of messages) {
      const parsed = this.parseSensorMessage(message);
      readings.push(...parsed);

      for (const reading of parsed) {
        this.applySensorReading(room.sensorState, reading);
      }
    }

    return {
      preferredDevice: room.mode,
      acceleration:
        this.getDeviceAcceleration(room.sensorState, room.mode) ??
        this.getDeviceAcceleration(room.sensorState, "phone") ??
        this.getDeviceAcceleration(room.sensorState, "watch"),
      heartRate: room.sensorState.lastHeartRate,
      readings
    };
  }

  parseSensorMessage(message) {
    const address = String(message.address ?? "").toLowerCase();
    const parts = address.split("/").filter(Boolean);
    const device = parts.includes("watch") ? "watch" : parts.includes("phone") ? "phone" : null;
    const kind = parts.find((part) => MOTION_KINDS.has(part)) ?? null;
    const axisPart =
      parts.find((part) => SENSOR_AXIS_NAMES.has(part) || part.includes(",")) ??
      null;
    const values = message.args
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));

    if (!device || !values.length) {
      return [];
    }

    if (parts.includes("heart") || axisPart === "bpm") {
      return [
        {
          device,
          kind: "heart",
          axis: "bpm",
          value: values[0],
          address: message.address
        }
      ];
    }

    if (!kind) {
      return [];
    }

    const normalizedKind = this.normalizeSensorKind(kind);
    const axes = this.getAxesForMessage(normalizedKind, axisPart, values.length);

    return axes
      .map((axis, index) => ({
        device,
        kind: normalizedKind,
        axis,
        value: values[index],
        address: message.address
      }))
      .filter((reading) => Number.isFinite(reading.value));
  }

  normalizeSensorKind(kind) {
    if (kind === "acceleration") {
      return "accel";
    }

    if (kind === "gyroscope") {
      return "gyro";
    }

    if (kind === "magnetometer") {
      return "magnetic";
    }

    return kind;
  }

  getAxesForMessage(kind, axisPart, valueCount) {
    if (axisPart?.includes(",")) {
      return axisPart.split(",").map((axis) => axis.trim()).filter(Boolean);
    }

    if (axisPart && SENSOR_AXIS_NAMES.has(axisPart)) {
      return [axisPart];
    }

    if (kind === "motion") {
      return ["pitch", "roll", "yaw"].slice(0, valueCount);
    }

    return ["x", "y", "z"].slice(0, valueCount);
  }

  applySensorReading(sensorState, reading) {
    if (reading.kind === "heart") {
      sensorState.lastHeartRate = reading.value;
      return;
    }

    const deviceState = sensorState[reading.device];
    const kindState = deviceState?.[reading.kind];
    if (!kindState || !(reading.axis in kindState)) {
      return;
    }

    kindState[reading.axis] = reading.value;
    if (["x", "y", "z"].every((axis) => Number.isFinite(kindState[axis]))) {
      kindState.magnitude = Math.sqrt(
        kindState.x ** 2 + kindState.y ** 2 + kindState.z ** 2
      );
    } else if (
      ["pitch", "roll", "yaw"].every((axis) => Number.isFinite(kindState[axis]))
    ) {
      kindState.magnitude = Math.sqrt(
        kindState.pitch ** 2 + kindState.roll ** 2 + kindState.yaw ** 2
      );
    }
  }

  getDeviceAcceleration(sensorState, device) {
    const accel = sensorState[device]?.accel;
    if (!accel || !Number.isFinite(accel.magnitude)) {
      return null;
    }

    return {
      device,
      x: accel.x,
      y: accel.y,
      z: accel.z,
      magnitude: accel.magnitude
    };
  }

  getRoomPayload(room, request) {
    return {
      roomId: room.id,
      roomToken: room.token,
      assignedUdpPort: room.udpPort,
      serverHost: this.resolveServerHost(request ?? { headers: {} }),
      mode: room.mode,
      createdAt: room.createdAt,
      udpPortRange: [this.config.udpPortStart, this.config.udpPortEnd]
    };
  }

  resolveServerHost(request) {
    const configured = this.normalizeHost(this.config.publicHost);
    if (configured) {
      return configured;
    }

    const requestHost = this.normalizeHost(request.headers?.host ?? "");
    return requestHost || "127.0.0.1";
  }

  normalizeHost(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      return "";
    }

    try {
      const url = new URL(trimmed.includes("://") ? trimmed : `ws://${trimmed}`);
      return url.hostname;
    } catch {
      return trimmed.replace(/:\d+$/, "");
    }
  }

  sendError(socket, code, message) {
    this.sendJson(socket, {
      type: "error",
      code,
      message
    });
  }

  sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }

  pingClients() {
    if (!this.wss) {
      return;
    }

    for (const socket of this.wss.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }

  cleanupExpiredRooms() {
    const now = Date.now();

    for (const room of this.rooms.values()) {
      if (!room.client && now - room.lastClientAt > this.config.noClientGraceMs) {
        this.cleanupRoom(room.id, "client grace expired");
        continue;
      }

      if (now - room.lastActivityAt > this.config.idleRoomMs) {
        this.cleanupRoom(room.id, "room idle timeout");
      }
    }
  }

  cleanupRoom(roomId, reason) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    this.closeUdpSocket(room);
    if (room.client?.readyState === WebSocket.OPEN) {
      this.sendJson(room.client, {
        type: "room-closed",
        roomId: room.id,
        reason
      });
      room.client.close(1000, reason);
    }

    this.rooms.delete(room.id);
    this.roomsByUdpPort.delete(room.udpPort);
    console.info("Room cleaned up.", {
      roomId: room.id,
      udpPort: room.udpPort,
      reason
    });
  }

  closeUdpSocket(room) {
    if (!room.udpSocket) {
      return;
    }

    try {
      room.udpSocket.close();
    } catch (error) {
      console.warn("UDP socket close failed.", {
        roomId: room.id,
        udpPort: room.udpPort,
        error: error.message
      });
    }

    room.udpSocket = null;
  }
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
const runningUnderPm2 = process.env.pm_id !== undefined;

if (currentFile === entryFile || runningUnderPm2) {
  const server = new BridgeServer();

  server.start().catch((error) => {
    console.error("TDInput bridge failed to start.", error);
    process.exitCode = 1;
  });

  const shutdown = async (signal) => {
    console.info(`Received ${signal}; shutting down bridge.`);
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
