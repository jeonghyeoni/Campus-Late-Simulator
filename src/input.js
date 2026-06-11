import { clamp, expSmoothingFactor, lerp } from "./utils.js";

export class KeyboardRunInput {
  constructor(config, runSurface = window) {
    this.config = config;
    this.spacePressed = false;
    this.touchPressed = false;
    this.prefersTouchInput = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    this.runIntensity = 0;

    window.addEventListener("keydown", (event) => {
      if (event.code !== "Space") {
        return;
      }

      event.preventDefault();
      this.spacePressed = true;
    });

    window.addEventListener("keyup", (event) => {
      if (event.code !== "Space") {
        return;
      }

      event.preventDefault();
      this.spacePressed = false;
    });

    window.addEventListener("blur", () => {
      this.spacePressed = false;
      this.touchPressed = false;
    });

    runSurface.addEventListener("pointerdown", (event) => {
      if (!this.shouldUseTouchRun(event)) {
        return;
      }

      event.preventDefault();
      this.touchPressed = true;
      runSurface.setPointerCapture?.(event.pointerId);
    });

    window.addEventListener("pointerup", (event) => {
      if (!this.shouldUseTouchRun(event)) {
        return;
      }

      this.touchPressed = false;
    });

    window.addEventListener("pointercancel", (event) => {
      if (!this.shouldUseTouchRun(event)) {
        return;
      }

      this.touchPressed = false;
    });
  }

  update(deltaSeconds) {
    const changePerSecond = this.isActive()
      ? this.config.run.intensityRisePerSecond
      : -this.config.run.intensityFallPerSecond;

    this.runIntensity = clamp(
      this.runIntensity + changePerSecond * deltaSeconds,
      0,
      1
    );
  }

  getRunIntensity() {
    return this.runIntensity;
  }

  getPlaybackRunIntensity() {
    return this.runIntensity;
  }

  isActive() {
    return this.spacePressed || this.touchPressed;
  }

  isRunningIntent() {
    return this.runIntensity > this.config.run.runningThreshold;
  }

  reset() {
    this.runIntensity = 0;
  }

  getRunPromptMessage() {
    return this.prefersTouchInput ? "hold screen to run" : "hold space to run";
  }

  prefersTouch() {
    return this.prefersTouchInput;
  }

  isReadyToStart() {
    return true;
  }

  shouldUseTouchRun(event) {
    return event.pointerType === "touch" || event.pointerType === "pen";
  }
}

export class TdInputRunInput {
  constructor(config) {
    this.config = config;
    this.bridgeConfig = config.bridge;
    this.sensorConfig = config.sensorInput;
    this.mode = null;
    this.socket = null;
    this.status = "idle";
    this.lastError = "";
    this.room = null;
    this.reconnectTimer = null;
    this.hasRequestedRoom = false;
    this.runIntensity = 0;
    this.targetRunIntensity = 0;
    this.baselineMagnitude = null;
    this.lastAcceleration = null;
    this.lastSensorAt = 0;
    this.lastSensorHeartRate = null;

    window.addEventListener("beforeunload", () => {
      this.disconnect({ release: true, silent: true });
    });
  }

  setMode(mode) {
    const nextMode = this.normalizeMode(mode);
    if (!nextMode) {
      this.disconnect({ release: true });
      this.mode = null;
      return;
    }

    if (this.mode === nextMode && this.socket) {
      return;
    }

    if (this.mode && this.mode !== nextMode) {
      this.clearSavedRoom(this.mode);
      this.disconnect({ release: true });
    }

    this.mode = nextMode;
    this.room = this.loadSavedRoom(nextMode);
    this.connect();
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

  connect() {
    if (!this.mode || !this.bridgeConfig.wsUrl) {
      return;
    }

    this.clearReconnectTimer();
    this.closeSocketOnly();
    this.status = this.room ? "reconnecting" : "connecting";
    this.lastError = "";
    this.hasRequestedRoom = false;

    try {
      this.socket = new WebSocket(this.bridgeConfig.wsUrl);
    } catch (error) {
      this.handleSocketFailure(error);
      return;
    }

    const socket = this.socket;

    socket.addEventListener("open", () => {
      if (socket !== this.socket) {
        return;
      }

      this.status = "connected";
      this.requestRoom();
    });

    socket.addEventListener("message", (event) => {
      if (socket !== this.socket) {
        return;
      }

      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (socket !== this.socket) {
        return;
      }

      this.socket = null;
      if (this.mode) {
        this.status = "reconnecting";
        this.scheduleReconnect();
      } else {
        this.status = "idle";
      }
    });

    socket.addEventListener("error", () => {
      if (socket !== this.socket) {
        return;
      }

      this.handleSocketFailure(new Error("WebSocket connection failed."));
    });
  }

  requestRoom() {
    if (!this.socket || this.hasRequestedRoom) {
      return;
    }

    this.hasRequestedRoom = true;

    if (this.room?.roomId && this.room?.roomToken) {
      this.send({
        type: "resume-room",
        roomId: this.room.roomId,
        roomToken: this.room.roomToken
      });
      return;
    }

    this.send({
      type: "create-room",
      mode: this.mode
    });
  }

  handleMessage(data) {
    let message = null;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.warn("Bridge message was not JSON.", error);
      return;
    }

    if (message.type === "room-created" || message.type === "room-resumed") {
      this.room = message.room;
      this.status = "waiting";
      this.saveRoom();
      return;
    }

    if (message.type === "sensor-data") {
      this.updateFromSensorMessage(message);
      return;
    }

    if (message.type === "room-closed") {
      this.clearSavedRoom(this.mode);
      this.room = null;
      this.status = "reconnecting";
      return;
    }

    if (message.type === "error") {
      this.handleBridgeError(message);
    }
  }

  handleBridgeError(message) {
    this.lastError = message.message ?? message.code ?? "Bridge error.";

    if (message.code === "resume_failed") {
      this.clearSavedRoom(this.mode);
      this.room = null;
      this.hasRequestedRoom = false;
      this.requestRoom();
      return;
    }

    this.status = "error";
    console.warn("TDInput bridge error.", message);
  }

  handleSocketFailure(error) {
    this.lastError = error.message;
    if (this.mode) {
      this.status = "reconnecting";
      this.scheduleReconnect();
    }
  }

  updateFromSensorMessage(message) {
    const acceleration = message.sensor?.acceleration;
    const heartRate = Number(message.sensor?.heartRate);

    if (Number.isFinite(heartRate)) {
      this.lastSensorHeartRate = heartRate;
    }

    if (!acceleration || !Number.isFinite(acceleration.magnitude)) {
      return;
    }

    const magnitude = acceleration.magnitude;
    const x = Number(acceleration.x);
    const y = Number(acceleration.y);
    const z = Number(acceleration.z);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }

    if (!Number.isFinite(this.baselineMagnitude)) {
      this.baselineMagnitude = magnitude;
    }

    const magnitudeDelta = Math.abs(magnitude - this.baselineMagnitude);
    const magnitudeIntensity = this.normalizeMotion(
      magnitudeDelta,
      this.sensorConfig.deadzone,
      this.sensorConfig.fullScale
    );
    const jerkIntensity = this.getJerkIntensity({ x, y, z });

    this.baselineMagnitude = lerp(
      this.baselineMagnitude,
      magnitude,
      this.sensorConfig.baselineSmoothing
    );
    this.targetRunIntensity = Math.max(magnitudeIntensity, jerkIntensity);
    this.lastAcceleration = { x, y, z };
    this.lastSensorAt = Date.now();
    this.status = "receiving";
  }

  getJerkIntensity(acceleration) {
    if (!this.lastAcceleration) {
      return 0;
    }

    const delta = Math.sqrt(
      (acceleration.x - this.lastAcceleration.x) ** 2 +
        (acceleration.y - this.lastAcceleration.y) ** 2 +
        (acceleration.z - this.lastAcceleration.z) ** 2
    );

    return this.normalizeMotion(
      delta,
      this.sensorConfig.jerkDeadzone,
      this.sensorConfig.jerkFullScale
    );
  }

  normalizeMotion(value, deadzone, fullScale) {
    const range = Math.max(fullScale - deadzone, 0.0001);
    return clamp((value - deadzone) / range, 0, 1);
  }

  update(deltaSeconds) {
    const now = Date.now();
    const stale =
      !this.lastSensorAt ||
      now - this.lastSensorAt > this.sensorConfig.staleAfterMs;
    const staleForStatus =
      !this.lastSensorAt ||
      now - this.lastSensorAt >
        this.sensorConfig.staleAfterMs + this.bridgeConfig.statusHoldMs;

    if (stale) {
      this.targetRunIntensity = 0;
    }

    if (staleForStatus && this.status === "receiving") {
      this.status =
        this.socket?.readyState === WebSocket.OPEN ? "waiting" : "reconnecting";
    }

    this.runIntensity = this.targetRunIntensity;
  }

  getRunIntensity() {
    return this.runIntensity;
  }

  getPlaybackRunIntensity() {
    return this.targetRunIntensity;
  }

  isActive() {
    return (
      this.runIntensity > this.sensorConfig.runningThreshold ||
      this.targetRunIntensity > this.sensorConfig.runningThreshold
    );
  }

  isRunningIntent() {
    return this.targetRunIntensity > this.sensorConfig.runningThreshold;
  }

  reset() {
    this.runIntensity = 0;
    this.targetRunIntensity = 0;
    this.baselineMagnitude = null;
    this.lastAcceleration = null;
  }

  getRunPromptMessage() {
    if (this.status === "reconnecting" || this.status === "disconnected") {
      return "reconnecting TDInput bridge...";
    }

    return "move TDInput device to run";
  }

  prefersTouch() {
    return false;
  }

  getConnectionSnapshot() {
    return {
      mode: this.mode,
      status: this.status,
      statusText: this.getStatusText(),
      readyToStart: this.isReadyToStart(),
      roomId: this.room?.roomId ?? "",
      roomToken: this.room?.roomToken ?? "",
      serverHost: this.room?.serverHost ?? "",
      udpPort: this.room?.assignedUdpPort ?? "",
      wsUrl: this.bridgeConfig.wsUrl,
      lastError: this.lastError,
      lastSensorAt: this.lastSensorAt,
      lastSensorHeartRate: this.lastSensorHeartRate
    };
  }

  getStatusText() {
    if (this.status === "receiving") {
      return "Receiving motion data";
    }

    if (this.status === "waiting") {
      return "Waiting for TDInput data...";
    }

    if (this.status === "connected" || this.status === "connecting") {
      return "Connected";
    }

    if (this.status === "reconnecting" || this.status === "disconnected") {
      return "Disconnected / Reconnecting";
    }

    if (this.status === "error") {
      return this.lastError || "Connection failed";
    }

    return "Select TDInput mode";
  }

  isReadyToStart() {
    if (!this.mode || !this.lastSensorAt) {
      return false;
    }

    const recentSensor =
      Date.now() - this.lastSensorAt <=
      this.sensorConfig.staleAfterMs + this.bridgeConfig.statusHoldMs;

    return (
      recentSensor &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.status !== "reconnecting" &&
      this.status !== "disconnected" &&
      this.status !== "error"
    );
  }

  send(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify(payload));
    return true;
  }

  scheduleReconnect() {
    if (this.reconnectTimer || !this.mode) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.bridgeConfig.reconnectIntervalMs);
  }

  clearReconnectTimer() {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  disconnect({ release = false, silent = false } = {}) {
    this.clearReconnectTimer();

    if (release && this.room) {
      this.send({
        type: "release-room",
        roomId: this.room.roomId,
        roomToken: this.room.roomToken
      });
      this.clearSavedRoom(this.mode);
      this.room = null;
    }

    this.mode = null;
    this.closeSocketOnly();
    this.status = silent ? this.status : "idle";
  }

  closeSocketOnly() {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;
    socket.close();
  }

  saveRoom() {
    if (!this.mode || !this.room) {
      return;
    }

    try {
      window.localStorage.setItem(
        this.getStorageKey(this.mode),
        JSON.stringify({
          ...this.room,
          savedAt: Date.now()
        })
      );
    } catch {
      // localStorage can be unavailable in private browsing modes.
    }
  }

  loadSavedRoom(mode) {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(this.getStorageKey(mode)) ?? "null"
      );
      if (saved?.roomId && saved?.roomToken) {
        return saved;
      }
    } catch {
      this.clearSavedRoom(mode);
    }

    return null;
  }

  clearSavedRoom(mode) {
    if (!mode) {
      return;
    }

    try {
      window.localStorage.removeItem(this.getStorageKey(mode));
    } catch {
      // Ignore storage failures.
    }
  }

  getStorageKey(mode) {
    return `campusLateSimulator.tdInputRoom.${mode}`;
  }
}

export class SmartphoneMotionRunInput extends TdInputRunInput {
  constructor(config) {
    super(config);
    this.sensorConfig = {
      ...config.sensorInput,
      ...config.motionSensorInput
    };
    this.motionIdleThreshold = this.sensorConfig.runningThreshold;
    this.controllerConnected = false;
    this.lastControllerConnectedAt = 0;
    this.lastControllerDisconnectedAt = 0;
  }

  normalizeMode(mode) {
    return mode === "phone-motion" || mode === "smartphone-motion"
      ? "phone-motion"
      : null;
  }

  disconnect(options = {}) {
    super.disconnect(options);
    this.controllerConnected = false;
  }

  handleMessage(data) {
    let message = null;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.warn("Bridge message was not JSON.", error);
      return;
    }

    if (message.type === "room-created" || message.type === "room-resumed") {
      this.room = message.room;
      this.status = "waiting-controller";
      this.controllerConnected = false;
      this.saveRoom();
      return;
    }

    if (message.type === "controller-connected") {
      this.controllerConnected = true;
      this.lastControllerConnectedAt = Date.now();
      if (this.status !== "receiving") {
        this.status = "controller-connected";
      }
      return;
    }

    if (message.type === "controller-disconnected") {
      this.controllerConnected = false;
      this.lastControllerDisconnectedAt = Date.now();
      if (this.status !== "reconnecting") {
        this.status = "waiting-controller";
      }
      return;
    }

    if (message.type === "controller-replaced") {
      this.controllerConnected = false;
      this.status = "waiting-controller";
      return;
    }

    if (message.type === "sensor-data") {
      this.controllerConnected = true;
      this.updateFromSensorMessage(message);
      return;
    }

    if (message.type === "room-closed") {
      this.controllerConnected = false;
      this.clearSavedRoom(this.mode);
      this.room = null;
      this.status = "reconnecting";
      return;
    }

    if (message.type === "error") {
      this.handleBridgeError(message);
    }
  }

  update(deltaSeconds) {
    super.update(deltaSeconds);

    if (this.status === "waiting" && this.mode === "phone-motion") {
      this.status = this.controllerConnected
        ? "controller-connected"
        : "waiting-controller";
    }

    if (this.targetRunIntensity <= this.motionIdleThreshold) {
      this.targetRunIntensity = 0;
    }
  }

  updateFromSensorMessage(message) {
    super.updateFromSensorMessage(message);

    if (this.targetRunIntensity <= this.motionIdleThreshold) {
      this.targetRunIntensity = 0;
    }
  }

  getRunPromptMessage() {
    if (this.status === "reconnecting" || this.status === "disconnected") {
      return "reconnecting phone controller...";
    }

    if (!this.controllerConnected) {
      return "scan QR with phone";
    }

    return "move phone to run";
  }

  getStatusText() {
    if (this.status === "receiving") {
      return "Receiving motion data";
    }

    if (this.status === "controller-connected") {
      return "Phone connected";
    }

    if (this.status === "waiting-controller" || this.status === "waiting") {
      return "Waiting for phone connection...";
    }

    if (this.status === "connected" || this.status === "connecting") {
      return "Creating motion room...";
    }

    if (this.status === "reconnecting" || this.status === "disconnected") {
      return "Disconnected / Reconnecting";
    }

    if (this.status === "error") {
      return this.lastError || "Connection failed";
    }

    return "Select Smartphone Motion";
  }

  getConnectionSnapshot() {
    const snapshot = super.getConnectionSnapshot();
    return {
      ...snapshot,
      readyToStart: this.isReadyToStart(),
      motionEnabled: this.hasRecentSensorData(),
      controllerConnected: this.controllerConnected,
      controllerUrl: this.getControllerUrl(snapshot.roomId),
      lastControllerConnectedAt: this.lastControllerConnectedAt,
      lastControllerDisconnectedAt: this.lastControllerDisconnectedAt
    };
  }

  getControllerUrl(roomId) {
    if (!roomId) {
      return "";
    }

    const configuredBaseUrl =
      this.config.bridge.controllerBaseUrl || window.location.origin;

    let controllerUrl;

    try {
      const baseUrl = new URL(configuredBaseUrl, window.location.origin);
      baseUrl.search = "";
      baseUrl.hash = "";

      if (
        baseUrl.pathname === "/controller" ||
        baseUrl.pathname === "/controller/" ||
        baseUrl.pathname === "/controller.html"
      ) {
        baseUrl.pathname = "/";
      }

      controllerUrl = new URL("controller.html", baseUrl);
    } catch {
      controllerUrl = new URL("controller.html", window.location.origin);
    }

    controllerUrl.searchParams.set("room", roomId);
    return controllerUrl.toString();
  }

  reset() {
    super.reset();
  }

  hasRecentSensorData() {
    if (!this.lastSensorAt) {
      return false;
    }

    return (
      Date.now() - this.lastSensorAt <=
      this.sensorConfig.staleAfterMs + this.bridgeConfig.statusHoldMs
    );
  }

  isReadyToStart() {
    return (
      this.mode === "phone-motion" &&
      this.controllerConnected &&
      this.hasRecentSensorData() &&
      this.socket?.readyState === WebSocket.OPEN &&
      this.status !== "reconnecting" &&
      this.status !== "disconnected" &&
      this.status !== "error"
    );
  }
}

export class RunInputManager {
  constructor(config, keyboardInput, tdInput, motionInput) {
    this.config = config;
    this.keyboardInput = keyboardInput;
    this.tdInput = tdInput;
    this.motionInput = motionInput;
    this.mode = "keyboard";
    this.runIntensity = 0;
  }

  setMode(mode) {
    const nextMode =
      mode === "phone" || mode === "watch" || mode === "phone-motion"
        ? mode
        : "keyboard";
    if (this.mode === nextMode) {
      return;
    }

    this.mode = nextMode;
    this.reset();

    if (this.mode === "keyboard") {
      this.tdInput.disconnect({ release: true });
      this.motionInput.disconnect({ release: true });
      return;
    }

    if (this.mode === "phone-motion") {
      this.tdInput.disconnect({ release: true });
      this.motionInput.setMode(this.mode);
      return;
    }

    this.motionInput.disconnect({ release: true });
    this.tdInput.setMode(this.mode);
  }

  update(deltaSeconds) {
    if (this.mode === "keyboard") {
      this.keyboardInput.update(deltaSeconds);
      this.runIntensity = this.keyboardInput.getRunIntensity();
      return;
    }

    if (this.config.bridge.keyboardFallback) {
      this.keyboardInput.update(deltaSeconds);
    }

    const activeSensorInput = this.getActiveSensorInput();
    activeSensorInput.update(deltaSeconds);

    const fallbackIntensity = this.config.bridge.keyboardFallback
      ? this.keyboardInput.getRunIntensity()
      : 0;
    this.runIntensity = Math.max(
      activeSensorInput.getRunIntensity(),
      fallbackIntensity
    );
  }

  getRunIntensity() {
    return this.runIntensity;
  }

  getPlaybackRunIntensity() {
    if (this.mode === "keyboard") {
      return this.keyboardInput.getPlaybackRunIntensity();
    }

    const fallbackIntensity = this.config.bridge.keyboardFallback
      ? this.keyboardInput.getPlaybackRunIntensity()
      : 0;
    const activeSensorInput = this.getActiveSensorInput();
    return Math.max(
      activeSensorInput.getPlaybackRunIntensity(),
      fallbackIntensity
    );
  }

  isActive() {
    if (this.mode === "keyboard") {
      return this.keyboardInput.isActive();
    }

    return (
      (this.mode === "phone-motion"
        ? this.motionInput.isActive()
        : this.tdInput.isActive()) ||
      (this.config.bridge.keyboardFallback && this.keyboardInput.isActive())
    );
  }

  isRunningIntent() {
    if (this.mode === "keyboard") {
      return this.keyboardInput.isRunningIntent();
    }

    const activeSensorInput = this.getActiveSensorInput();
    return (
      activeSensorInput.isRunningIntent() ||
      (this.config.bridge.keyboardFallback &&
        this.keyboardInput.isRunningIntent())
    );
  }

  reset() {
    this.runIntensity = 0;

    if (this.mode === "keyboard") {
      this.keyboardInput.reset();
      return;
    }

    if (this.mode === "phone-motion") {
      this.motionInput.reset();
    } else {
      this.tdInput.reset();
    }

    if (this.config.bridge.keyboardFallback) {
      this.keyboardInput.reset();
    }
  }

  getRunPromptMessage() {
    if (this.mode === "keyboard") {
      return this.keyboardInput.getRunPromptMessage();
    }

    return this.mode === "phone-motion"
      ? this.motionInput.getRunPromptMessage()
      : this.tdInput.getRunPromptMessage();
  }

  prefersTouch() {
    if (this.mode === "keyboard") {
      return this.keyboardInput.prefersTouch();
    }

    return this.mode === "phone-motion"
      ? this.motionInput.prefersTouch()
      : this.tdInput.prefersTouch();
  }

  getMode() {
    return this.mode;
  }

  getActiveSensorInput() {
    return this.mode === "phone-motion" ? this.motionInput : this.tdInput;
  }

  getConnectionSnapshot() {
    return this.mode === "phone-motion"
      ? this.motionInput.getConnectionSnapshot()
      : this.tdInput.getConnectionSnapshot();
  }

  isReadyToStart() {
    if (this.mode === "keyboard") {
      return this.keyboardInput.isReadyToStart();
    }

    return this.mode === "phone-motion"
      ? this.motionInput.isReadyToStart()
      : this.tdInput.isReadyToStart();
  }
}
