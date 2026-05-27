import "./styles.css";
import { CONFIG } from "./config.js";
import { clamp, expSmoothingFactor, lerp } from "./utils.js";

const SENSOR_CONFIG = {
  ...CONFIG.sensorInput,
  ...CONFIG.motionSensorInput
};

const roomId = new URLSearchParams(window.location.search).get("room") ?? "";
const connectionDot = document.querySelector("#connectionDot");
const connectionStatus = document.querySelector("#connectionStatus");
const enableMotionButton = document.querySelector("#enableMotionButton");
const roomValue = document.querySelector("#roomValue");
const magnitudeValue = document.querySelector("#magnitudeValue");
const intensityValue = document.querySelector("#intensityValue");
const latencyValue = document.querySelector("#latencyValue");

let socket = null;
let reconnectTimer = null;
let sendTimer = null;
let pingTimer = null;
let wakeLock = null;
let motionEnabled = false;
let permissionState = "unknown";
let seq = 0;
let latestSample = null;
let smoothedIntensity = 0;
let baselineMagnitude = null;
let lastAcceleration = null;
let lastMotionAt = 0;
let latencyMs = null;

roomValue.textContent = roomId || "----";

function setStatus(status, message) {
  document.body.dataset.controllerStatus = status;
  connectionStatus.textContent = message;
  connectionDot.dataset.status = status;
}

function connect() {
  if (!roomId) {
    setStatus("error", "Missing room ID");
    enableMotionButton.disabled = true;
    return;
  }

  window.clearTimeout(reconnectTimer);
  setStatus("connecting", "Connecting...");

  try {
    socket = new WebSocket(CONFIG.bridge.wsUrl);
  } catch (error) {
    scheduleReconnect(error.message);
    return;
  }

  const activeSocket = socket;

  activeSocket.addEventListener("open", () => {
    if (activeSocket !== socket) {
      return;
    }

    send({
      type: "join-controller",
      roomId
    });
    startPingLoop();
  });

  activeSocket.addEventListener("message", (event) => {
    if (activeSocket !== socket) {
      return;
    }

    handleBridgeMessage(event.data);
  });

  activeSocket.addEventListener("close", () => {
    if (activeSocket !== socket) {
      return;
    }

    socket = null;
    stopPingLoop();
    scheduleReconnect("Disconnected / Reconnecting");
  });

  activeSocket.addEventListener("error", () => {
    if (activeSocket !== socket) {
      return;
    }

    scheduleReconnect("Connection failed");
  });
}

function handleBridgeMessage(data) {
  let message = null;
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }

  if (message.type === "controller-joined") {
    setStatus("connected", motionEnabled ? "Sensor active" : "Connected");
    return;
  }

  if (message.type === "controller-replaced") {
    setStatus("error", "Controller replaced");
    stopSending();
    return;
  }

  if (message.type === "room-closed") {
    setStatus("error", "Room closed");
    stopSending();
    return;
  }

  if (message.type === "pong" && Number.isFinite(message.sentAt)) {
    latencyMs = Math.max(0, Date.now() - message.sentAt);
    renderDebug();
    return;
  }

  if (message.type === "error") {
    setStatus("error", message.message ?? "Bridge error");
  }
}

async function enableMotion() {
  if (!roomId) {
    return;
  }

  try {
    await requestMotionPermission();
    motionEnabled = true;
    enableMotionButton.textContent = "Motion Enabled";
    enableMotionButton.disabled = true;
    setStatus(socket?.readyState === WebSocket.OPEN ? "active" : "connecting", "Sensor active");
    startSending();
    await requestWakeLock();
  } catch (error) {
    permissionState = "denied";
    setStatus("error", error.message || "Motion permission denied");
  }
}

async function requestMotionPermission() {
  if (!("DeviceMotionEvent" in window)) {
    throw new Error("DeviceMotion is not supported");
  }

  if (typeof DeviceMotionEvent.requestPermission === "function") {
    const result = await DeviceMotionEvent.requestPermission();
    permissionState = result;
    if (result !== "granted") {
      throw new Error("Motion permission denied");
    }
  } else {
    permissionState = "granted";
  }

  window.addEventListener("devicemotion", handleDeviceMotion, {
    passive: true
  });
}

function handleDeviceMotion(event) {
  const acceleration =
    normalizeAcceleration(event.acceleration) ??
    normalizeAcceleration(event.accelerationIncludingGravity);

  if (!acceleration) {
    return;
  }

  const magnitude = Math.sqrt(
    acceleration.x ** 2 + acceleration.y ** 2 + acceleration.z ** 2
  );
  latestSample = {
    acceleration,
    magnitude,
    orientation: screen.orientation?.type ?? window.orientation?.toString() ?? "",
    capturedAt: Date.now()
  };
  lastMotionAt = latestSample.capturedAt;
  updateLocalIntensity(acceleration, magnitude);
  renderDebug();
}

function normalizeAcceleration(acceleration) {
  if (!acceleration) {
    return null;
  }

  const x = Number(acceleration.x ?? 0);
  const y = Number(acceleration.y ?? 0);
  const z = Number(acceleration.z ?? 0);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return { x, y, z };
}

function updateLocalIntensity(acceleration, magnitude) {
  if (!Number.isFinite(baselineMagnitude)) {
    baselineMagnitude = magnitude;
  }

  const magnitudeDelta = Math.abs(magnitude - baselineMagnitude);
  const magnitudeIntensity = normalizeMotion(
    magnitudeDelta,
    SENSOR_CONFIG.deadzone,
    SENSOR_CONFIG.fullScale
  );
  const jerkIntensity = getJerkIntensity(acceleration);

  baselineMagnitude = lerp(
    baselineMagnitude,
    magnitude,
    SENSOR_CONFIG.baselineSmoothing
  );
  const target = Math.max(magnitudeIntensity, jerkIntensity);
  smoothedIntensity = lerp(smoothedIntensity, target, 0.32);
  lastAcceleration = acceleration;
}

function getJerkIntensity(acceleration) {
  if (!lastAcceleration) {
    return 0;
  }

  const delta = Math.sqrt(
    (acceleration.x - lastAcceleration.x) ** 2 +
      (acceleration.y - lastAcceleration.y) ** 2 +
      (acceleration.z - lastAcceleration.z) ** 2
  );

  return normalizeMotion(
    delta,
    SENSOR_CONFIG.jerkDeadzone,
    SENSOR_CONFIG.jerkFullScale
  );
}

function normalizeMotion(value, deadzone, fullScale) {
  const range = Math.max(fullScale - deadzone, 0.0001);
  return clamp((value - deadzone) / range, 0, 1);
}

function startSending() {
  window.clearInterval(sendTimer);
  sendTimer = window.setInterval(
    sendLatestMotion,
    1000 / CONFIG.bridge.motionSendHz
  );
}

function stopSending() {
  window.clearInterval(sendTimer);
  sendTimer = null;
}

function sendLatestMotion() {
  if (!latestSample || socket?.readyState !== WebSocket.OPEN) {
    decayDebugIntensity();
    return;
  }

  send({
    type: "controller-motion",
    roomId,
    seq: seq++,
    sentAt: Date.now(),
    acceleration: latestSample.acceleration,
    magnitude: latestSample.magnitude,
    orientation: latestSample.orientation,
    permissionState
  });

  decayDebugIntensity();
}

function decayDebugIntensity() {
  if (
    !lastMotionAt ||
    Date.now() - lastMotionAt < SENSOR_CONFIG.staleAfterMs
  ) {
    return;
  }

  const amount = expSmoothingFactor(
    SENSOR_CONFIG.intensityFallSmoothing,
    1 / 30
  );
  smoothedIntensity = lerp(smoothedIntensity, 0, amount);
  renderDebug();
}

function renderDebug() {
  magnitudeValue.textContent = (latestSample?.magnitude ?? 0).toFixed(3);
  intensityValue.textContent = smoothedIntensity.toFixed(3);
  latencyValue.textContent = Number.isFinite(latencyMs)
    ? `${Math.round(latencyMs)} ms`
    : "-- ms";
}

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify(payload));
  return true;
}

function scheduleReconnect(message) {
  setStatus("reconnecting", message || "Disconnected / Reconnecting");
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connect, CONFIG.bridge.reconnectIntervalMs);
}

function startPingLoop() {
  stopPingLoop();
  pingTimer = window.setInterval(() => {
    send({
      type: "ping",
      sentAt: Date.now()
    });
  }, 1500);
}

function stopPingLoop() {
  window.clearInterval(pingTimer);
  pingTimer = null;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }

  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (motionEnabled) {
      requestWakeLock();
    }
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      connect();
    }
  }
});

window.addEventListener("online", connect);
enableMotionButton.addEventListener("click", enableMotion);

connect();
renderDebug();
