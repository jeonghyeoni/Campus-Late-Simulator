import "./styles.css";
import QRCode from "qrcode";
import { CONFIG } from "./config.js";
import {
  KeyboardRunInput,
  RunInputManager,
  SmartphoneMotionRunInput,
  TdInputRunInput
} from "./input.js";
import { SimulationState } from "./state.js";
import { OverlayUi } from "./ui.js";
import { VideoScene } from "./videoScene.js";
import { AudioEngine } from "./audioEngine.js";

const sceneContainer = document.querySelector("#scene");
const appRoot = document.querySelector("#app");
const startButton = document.querySelector("#startButton");
const retryButton = document.querySelector("#retryButton");
const startPanel = document.querySelector("#startPanel");
const creditsButton = document.querySelector("#creditsButton");
const creditsPanel = document.querySelector("#creditsPanel");
const creditsCloseButton = document.querySelector("#creditsCloseButton");
const qualitySelect = document.querySelector("#qualitySelect");
const inputModeControls = document.querySelectorAll("input[name='inputMode']");
const tdInputConnection = document.querySelector("#tdInputConnection");
const tdInputStatus = document.querySelector("#tdInputStatus");
const tdInputRoomId = document.querySelector("#tdInputRoomId");
const tdInputServerHost = document.querySelector("#tdInputServerHost");
const tdInputUdpPort = document.querySelector("#tdInputUdpPort");
const tdInputServerLabel = document.querySelector("#tdInputServerLabel");
const tdInputUdpLabel = document.querySelector("#tdInputUdpLabel");
const tdInputInstructions = document.querySelector("#tdInputInstructions");
const motionQrPanel = document.querySelector("#motionQrPanel");
const motionQrCanvas = document.querySelector("#motionQrCanvas");
const motionControllerUrl = document.querySelector("#motionControllerUrl");
const musicPrevButton = document.querySelector("#musicPrevButton");
const musicNextButton = document.querySelector("#musicNextButton");
const musicMenuButton = document.querySelector("#musicMenuButton");
const musicTrackList = document.querySelector("#musicTrackList");
const musicTitle = document.querySelector("#musicTitle");
const musicVolumeSlider = document.querySelector("#musicVolumeSlider");
const musicVolumeControl = document.querySelector(".music-volume");
const musicVolumeValue = document.querySelector("#musicVolumeValue");

const keyboardInput = new KeyboardRunInput(CONFIG, sceneContainer);
const tdInput = new TdInputRunInput(CONFIG);
const motionInput = new SmartphoneMotionRunInput(CONFIG);
const inputSource = new RunInputManager(
  CONFIG,
  keyboardInput,
  tdInput,
  motionInput
);
const simulationState = new SimulationState(CONFIG, inputSource);
const videoScene = new VideoScene(sceneContainer, CONFIG);
const overlayUi = new OverlayUi(CONFIG);
const audioEngine = new AudioEngine(CONFIG.audio);

let previousTime = performance.now();
let started = false;
let videoUnavailable = false;
let selectedBgmTrackIndex = 0;
let bgmVolume = clampVolume(CONFIG.audio.bgmVolume ?? 0.7);
let lastStateEventAt = 0;
let lastConnectionRenderAt = 0;
let lastRetryButtonVisible = null;
let frameTimeEmaMs = 16.7;
let lagLevel = 0;
const performanceStats = createPerformanceStats();
const mainRenderCache = new Map();

window.campusLateSimulator = {
  getState: () => cloneSnapshot(simulationState.getSnapshot()),
  getPerformanceReport: () => clonePerformanceStats(),
  resetPerformanceReport: () => resetPerformanceStats(),
  getInputSource: () => inputSource,
  getTdInput: () => tdInput,
  getMotionInput: () => motionInput,
  getAudioEngine: () => audioEngine
};

let renderedMotionQrUrl = "";

function populateQualitySelect() {
  qualitySelect.replaceChildren(
    ...CONFIG.video.sources.map((source) => {
      const option = document.createElement("option");
      option.value = source.src;
      option.textContent = source.label;
      option.selected = source.src === CONFIG.video.src;
      return option;
    })
  );
}

function getBgmTracks() {
  return Array.isArray(CONFIG.audio.bgmTracks) ? CONFIG.audio.bgmTracks : [];
}

function getSelectedBgmTrack() {
  const tracks = getBgmTracks();
  return tracks[selectedBgmTrackIndex] ?? null;
}

function clampVolume(value) {
  const volume = Number(value);
  return Number.isFinite(volume) ? clampValue(volume, 0, 1) : 0.7;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderBgmVolume() {
  musicVolumeSlider.value = String(bgmVolume);
  musicVolumeValue.textContent = String(Math.round(bgmVolume * 100));
}

function setBgmVolume(value) {
  bgmVolume = clampVolume(value);
  renderBgmVolume();
  audioEngine.setBgmVolume(bgmVolume);
}

function setBgmVolumeFromClientX(clientX) {
  const rect = musicVolumeSlider.getBoundingClientRect();
  if (rect.width <= 0) {
    return;
  }

  const progress = (clientX - rect.left) / rect.width;
  setBgmVolume(progress);
}

function handleBgmVolumePointer(event) {
  if (event.pointerType === "mouse" && event.buttons === 0) {
    return;
  }

  event.preventDefault();
  setBgmVolumeFromClientX(event.clientX);
}

function handleBgmVolumeTouch(event) {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) {
    return;
  }

  event.preventDefault();
  setBgmVolumeFromClientX(touch.clientX);
}

function renderMusicPlayer() {
  const tracks = getBgmTracks();
  const track = getSelectedBgmTrack();
  const hasTracks = tracks.length > 0;

  musicTitle.textContent = track?.title ?? "NO TRACK";
  musicPrevButton.disabled = !hasTracks;
  musicNextButton.disabled = !hasTracks;
  musicMenuButton.disabled = !hasTracks;
  musicTrackList.replaceChildren(
    ...tracks.map((bgmTrack, index) => {
      const item = document.createElement("button");
      item.className = "music-track-item";
      item.type = "button";
      item.setAttribute("role", "option");
      item.dataset.selected = index === selectedBgmTrackIndex ? "true" : "false";
      item.setAttribute(
        "aria-selected",
        index === selectedBgmTrackIndex ? "true" : "false"
      );
      item.textContent = bgmTrack.title ?? `Track ${index + 1}`;
      item.addEventListener("click", () => selectBgmTrackByIndex(index));
      return item;
    })
  );
}

function setMusicMenuOpen(open) {
  musicMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
  musicTrackList.hidden = !open;
}

function toggleMusicMenu() {
  if (!getBgmTracks().length) {
    return;
  }

  setMusicMenuOpen(musicTrackList.hidden);
}

function selectBgmTrackByIndex(index) {
  const tracks = getBgmTracks();
  if (!tracks[index]) {
    return;
  }

  selectedBgmTrackIndex = index;
  renderMusicPlayer();
  setMusicMenuOpen(false);

  audioEngine.setBgmTrack(getSelectedBgmTrack()).catch((error) => {
    console.warn("Unable to switch BGM track.", error);
  });
}

function selectBgmTrack(direction) {
  const tracks = getBgmTracks();
  if (!tracks.length) {
    return;
  }

  selectedBgmTrackIndex =
    (selectedBgmTrackIndex + direction + tracks.length) % tracks.length;
  selectBgmTrackByIndex(selectedBgmTrackIndex);
}

function tick(now) {
  const rawDeltaMs = now - previousTime;
  const performanceSnapshot = updatePerformanceSnapshot(rawDeltaMs);
  const deltaSeconds = Math.min(rawDeltaMs / 1000, 0.05);
  previousTime = now;

  if (started) {
    simulationState.update(deltaSeconds, videoScene.video);
  }

  const snapshot = simulationState.getSnapshot();

  if (started) {
    updateVideoProgressStats(now, snapshot);
  }

  videoScene.setPlaybackSpeed(snapshot.playbackSpeed);
  videoScene.update(deltaSeconds, snapshot, performanceSnapshot);
  audioEngine.updateFromSnapshot(snapshot);
  overlayUi.render(snapshot, performanceSnapshot);
  renderRetryButton(snapshot);
  renderTdInputConnection();

  dispatchStateEventIfDue(now, snapshot);

  requestAnimationFrame(tick);
}

function createPerformanceStats() {
  return {
    startedAt: performance.now(),
    frames: 0,
    longFrames: 0,
    criticalFrames: 0,
    maxFrameMs: 0,
    avgFrameMs: 0,
    emaFrameMs: 16.7,
    lagLevel: 0,
    lagLevelChanges: 0,
    lagLevel1Frames: 0,
    lagLevel2Frames: 0,
    videoStalls: 0,
    longestVideoStallMs: 0,
    lastVideoTime: 0,
    lastVideoProgressAt: performance.now(),
    activeVideoStallStartedAt: 0
  };
}

function resetPerformanceStats() {
  const freshStats = createPerformanceStats();
  Object.assign(performanceStats, freshStats);
  frameTimeEmaMs = 16.7;
  lagLevel = 0;
  setDatasetValue("appLagLevel", appRoot, "lagLevel", "0");
  return clonePerformanceStats();
}

function updatePerformanceSnapshot(frameMs) {
  const performanceConfig = CONFIG.performance ?? {};
  const smoothing = clampValue(performanceConfig.frameSmoothing ?? 0.08, 0, 1);
  const warningMs = performanceConfig.frameWarningMs ?? 28;
  const criticalMs = performanceConfig.frameCriticalMs ?? 45;
  const recoveryMs = performanceConfig.frameRecoveryMs ?? 22;

  if (Number.isFinite(frameMs) && frameMs > 0) {
    frameTimeEmaMs += (frameMs - frameTimeEmaMs) * smoothing;
    updateFrameStats(frameMs, frameTimeEmaMs, warningMs, criticalMs);
  }

  const previousLagLevel = lagLevel;

  if (frameTimeEmaMs >= criticalMs) {
    lagLevel = 2;
  } else if (frameTimeEmaMs >= warningMs) {
    lagLevel = Math.max(lagLevel, 1);
  } else if (frameTimeEmaMs <= recoveryMs) {
    lagLevel = 0;
  }

  if (lagLevel !== previousLagLevel) {
    performanceStats.lagLevelChanges += 1;
  }

  if (lagLevel === 1) {
    performanceStats.lagLevel1Frames += 1;
  } else if (lagLevel === 2) {
    performanceStats.lagLevel2Frames += 1;
  }

  performanceStats.emaFrameMs = frameTimeEmaMs;
  performanceStats.lagLevel = lagLevel;
  setDatasetValue("appLagLevel", appRoot, "lagLevel", String(lagLevel));

  return {
    frameMs: frameTimeEmaMs,
    lagLevel
  };
}

function updateFrameStats(frameMs, emaFrameMs, warningMs, criticalMs) {
  performanceStats.frames += 1;
  performanceStats.maxFrameMs = Math.max(performanceStats.maxFrameMs, frameMs);
  performanceStats.avgFrameMs +=
    (frameMs - performanceStats.avgFrameMs) / performanceStats.frames;
  performanceStats.emaFrameMs = emaFrameMs;

  if (frameMs >= warningMs) {
    performanceStats.longFrames += 1;
  }

  if (frameMs >= criticalMs) {
    performanceStats.criticalFrames += 1;
  }
}

function updateVideoProgressStats(now, snapshot) {
  const video = videoScene.video;
  const currentTime = video.currentTime || 0;
  const recovery = CONFIG.video.stallRecovery ?? {};
  const minProgressSeconds = recovery.minProgressSeconds ?? 0.025;
  const stalledAfterMs = recovery.stalledAfterMs ?? 900;

  if (
    video.paused ||
    video.ended ||
    snapshot?.outcome ||
    !Number.isFinite(currentTime)
  ) {
    performanceStats.lastVideoTime = currentTime;
    performanceStats.lastVideoProgressAt = now;
    performanceStats.activeVideoStallStartedAt = 0;
    return;
  }

  const progressed =
    Math.abs(currentTime - performanceStats.lastVideoTime) >=
    minProgressSeconds;

  if (progressed) {
    if (performanceStats.activeVideoStallStartedAt) {
      performanceStats.longestVideoStallMs = Math.max(
        performanceStats.longestVideoStallMs,
        now - performanceStats.activeVideoStallStartedAt
      );
      performanceStats.activeVideoStallStartedAt = 0;
    }

    performanceStats.lastVideoTime = currentTime;
    performanceStats.lastVideoProgressAt = now;
    return;
  }

  const stalledMs = now - performanceStats.lastVideoProgressAt;
  if (stalledMs < stalledAfterMs) {
    return;
  }

  if (!performanceStats.activeVideoStallStartedAt) {
    performanceStats.activeVideoStallStartedAt = now;
    performanceStats.videoStalls += 1;
  }
}

function dispatchStateEventIfDue(now, snapshot) {
  const stateEventHz = CONFIG.performance?.stateEventHz ?? 8;
  const intervalMs = 1000 / Math.max(1, stateEventHz);

  if (now - lastStateEventAt < intervalMs) {
    return;
  }

  lastStateEventAt = now;
  window.dispatchEvent(
    new CustomEvent("campus-simulator-state", {
      detail: cloneSnapshot(snapshot)
    })
  );
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    classroomHallway: { ...snapshot.classroomHallway },
    quietCorridor: { ...snapshot.quietCorridor },
    overload: { ...snapshot.overload },
    somaticEffect: { ...snapshot.somaticEffect },
    endingEffect: { ...snapshot.endingEffect }
  };
}

function clonePerformanceStats() {
  const elapsedMs = performance.now() - performanceStats.startedAt;
  const frames = Math.max(1, performanceStats.frames);

  return {
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
    frames: performanceStats.frames,
    averageFps: Number(((frames / Math.max(elapsedMs, 1)) * 1000).toFixed(1)),
    avgFrameMs: Number(performanceStats.avgFrameMs.toFixed(2)),
    emaFrameMs: Number(performanceStats.emaFrameMs.toFixed(2)),
    maxFrameMs: Number(performanceStats.maxFrameMs.toFixed(2)),
    longFrames: performanceStats.longFrames,
    criticalFrames: performanceStats.criticalFrames,
    lagLevel: performanceStats.lagLevel,
    lagLevelChanges: performanceStats.lagLevelChanges,
    lagLevel1Frames: performanceStats.lagLevel1Frames,
    lagLevel2Frames: performanceStats.lagLevel2Frames,
    videoStalls: performanceStats.videoStalls,
    longestVideoStallMs: Number(
      performanceStats.longestVideoStallMs.toFixed(1)
    )
  };
}

window.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    return;
  }

  previousTime = performance.now();
  performanceStats.lastVideoProgressAt = previousTime;
  performanceStats.activeVideoStallStartedAt = 0;
});

function renderTdInputConnection(force = false) {
  const now = performance.now();
  const intervalMs =
    1000 / Math.max(1, CONFIG.performance?.connectionUiHz ?? 12);

  if (!force && now - lastConnectionRenderAt < intervalMs) {
    return;
  }

  lastConnectionRenderAt = now;

  const mode = inputSource.getMode();
  const sensorMode = mode === "phone" || mode === "watch" || mode === "phone-motion";
  const motionMode = mode === "phone-motion";
  setHidden("tdInputHidden", tdInputConnection, !sensorMode);
  setDatasetValue("startInputMode", startPanel, "inputMode", mode);

  if (!sensorMode) {
    renderStartButton();
    return;
  }

  const connection = inputSource.getConnectionSnapshot();
  setDatasetValue("tdInputStatusDataset", tdInputConnection, "status", connection.status);
  setText("tdInputStatus", tdInputStatus, connection.statusText);
  setText("tdInputRoomId", tdInputRoomId, connection.roomId || "----");
  setText(
    "tdInputServerHost",
    tdInputServerHost,
    connection.serverHost || getHostFromWebSocketUrl(CONFIG.bridge.wsUrl)
  );
  setText("tdInputUdpPort", tdInputUdpPort, connection.udpPort || "----");
  setHidden("tdInputServerLabelHidden", tdInputServerLabel, motionMode);
  setHidden("tdInputServerHostHidden", tdInputServerHost, motionMode);
  setHidden("tdInputUdpLabelHidden", tdInputUdpLabel, motionMode);
  setHidden("tdInputUdpPortHidden", tdInputUdpPort, motionMode);
  setHidden(
    "motionQrPanelHidden",
    motionQrPanel,
    !motionMode || !connection.controllerUrl
  );
  setText(
    "tdInputInstructions",
    tdInputInstructions,
    motionMode
      ? "Scan this QR code with your phone browser."
      : "Enter this Server IP and UDP Port in TDInput."
  );

  if (motionMode && connection.controllerUrl) {
    renderMotionQr(connection.controllerUrl);
    setAttribute("motionControllerHref", motionControllerUrl, "href", connection.controllerUrl);
    setText("motionControllerUrl", motionControllerUrl, connection.controllerUrl);
  } else {
    renderedMotionQrUrl = "";
  }

  renderStartButton(connection);
}

function renderMotionQr(url) {
  if (url === renderedMotionQrUrl) {
    return;
  }

  renderedMotionQrUrl = url;
  QRCode.toCanvas(motionQrCanvas, url, {
    width: 168,
    margin: 1,
    color: {
      dark: "#050607",
      light: "#f7fbfa"
    }
  }).catch((error) => {
    console.warn("Unable to render controller QR code.", error);
  });
}

function getHostFromWebSocketUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "127.0.0.1";
  }
}

function renderStartButton(connection = null) {
  if (started) {
    return;
  }

  if (videoUnavailable) {
    setText("startButtonText", startButton, "VIDEO ERROR");
    setDisabled("startButtonDisabled", startButton, true);
    return;
  }

  const mode = inputSource.getMode();
  const sensorMode =
    mode === "phone" || mode === "watch" || mode === "phone-motion";
  const connectionSnapshot =
    sensorMode ? connection ?? inputSource.getConnectionSnapshot() : null;
  const readyToStart = sensorMode
    ? connectionSnapshot.readyToStart
    : inputSource.isReadyToStart();

  setDisabled("startButtonDisabled", startButton, !readyToStart);
  setText(
    "startButtonText",
    startButton,
    getStartButtonText(mode, connectionSnapshot, readyToStart)
  );
}

function getStartButtonText(mode, connection, readyToStart) {
  if (readyToStart) {
    return "START";
  }

  if (
    mode === "phone-motion" &&
    connection?.controllerConnected &&
    !connection?.motionEnabled
  ) {
    return "ENABLE MOTION";
  }

  return "CONNECT DEVICE";
}

function setCreditsVisible(visible) {
  creditsPanel.hidden = !visible;
  creditsButton.setAttribute("aria-expanded", visible ? "true" : "false");
}

async function startExperience() {
  if (!inputSource.isReadyToStart()) {
    renderStartButton();
    return;
  }

  try {
    audioEngine.start();
    await videoScene.play();
    started = true;
    previousTime = performance.now();
    startPanel.classList.add("start-panel--hidden");
  } catch (error) {
    startPanel.classList.remove("start-panel--hidden");
    console.warn("Video playback needs a user gesture.", error);
  }
}

async function retryExperience() {
  simulationState.reset();
  audioEngine.resetProfessorVoiceStateForRetry();
  videoScene.resetToStart();
  retryButton.hidden = true;
  started = false;

  try {
    await videoScene.play();
    started = true;
    previousTime = performance.now();
    startPanel.classList.add("start-panel--hidden");
  } catch (error) {
    startPanel.classList.remove("start-panel--hidden");
    renderStartButton();
    console.warn("Video retry needs a user gesture.", error);
  }
}

function renderRetryButton(snapshot) {
  const visible = Boolean(snapshot.outcome);

  if (visible === lastRetryButtonVisible) {
    return;
  }

  retryButton.hidden = !visible;
  lastRetryButtonVisible = visible;
}

function setText(key, element, value) {
  if (!element || mainRenderCache.get(key) === value) {
    return;
  }

  element.textContent = value;
  mainRenderCache.set(key, value);
}

function setHidden(key, element, value) {
  if (!element || mainRenderCache.get(key) === value) {
    return;
  }

  element.hidden = value;
  mainRenderCache.set(key, value);
}

function setDisabled(key, element, value) {
  if (!element || mainRenderCache.get(key) === value) {
    return;
  }

  element.disabled = value;
  mainRenderCache.set(key, value);
}

function setDatasetValue(key, element, name, value) {
  if (!element || mainRenderCache.get(key) === value) {
    return;
  }

  element.dataset[name] = value;
  mainRenderCache.set(key, value);
}

function setAttribute(key, element, name, value) {
  if (!element || mainRenderCache.get(key) === value) {
    return;
  }

  element.setAttribute(name, value);
  mainRenderCache.set(key, value);
}

populateQualitySelect();
renderMusicPlayer();
renderBgmVolume();
audioEngine.setBgmVolume(bgmVolume);

qualitySelect.addEventListener("change", () => {
  if (started) {
    return;
  }

  videoScene.setSource(qualitySelect.value);
});

inputModeControls.forEach((control) => {
  control.addEventListener("change", () => {
    if (!control.checked) {
      return;
    }

    inputSource.setMode(control.value);
    renderTdInputConnection(true);
    renderStartButton();
  });
});

startButton.addEventListener("click", startExperience);
retryButton.addEventListener("click", retryExperience);
creditsButton.addEventListener("click", () => {
  setCreditsVisible(creditsPanel.hidden);
});
creditsCloseButton.addEventListener("click", () => setCreditsVisible(false));
musicPrevButton.addEventListener("click", () => selectBgmTrack(-1));
musicNextButton.addEventListener("click", () => selectBgmTrack(1));
musicMenuButton.addEventListener("click", toggleMusicMenu);
musicVolumeSlider.addEventListener("input", () => {
  setBgmVolume(musicVolumeSlider.value);
});
musicVolumeSlider.addEventListener("change", () => {
  setBgmVolume(musicVolumeSlider.value);
});
musicVolumeControl.addEventListener("pointerdown", (event) => {
  musicVolumeControl.setPointerCapture?.(event.pointerId);
  handleBgmVolumePointer(event);
});
musicVolumeControl.addEventListener("pointermove", handleBgmVolumePointer);
musicVolumeControl.addEventListener("touchstart", handleBgmVolumeTouch, {
  passive: false
});
musicVolumeControl.addEventListener("touchmove", handleBgmVolumeTouch, {
  passive: false
});
document.addEventListener("click", (event) => {
  if (
    !creditsPanel.hidden &&
    event.target !== creditsButton &&
    !creditsButton.contains(event.target) &&
    !creditsPanel.contains(event.target)
  ) {
    setCreditsVisible(false);
  }

  if (
    musicTrackList.hidden ||
    event.target === musicMenuButton ||
    musicMenuButton.contains(event.target) ||
    musicTrackList.contains(event.target)
  ) {
    return;
  }

  setMusicMenuOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMusicMenuOpen(false);
    setCreditsVisible(false);
  }
});

videoScene.video.addEventListener("error", () => {
  videoUnavailable = true;
  renderStartButton();
});

overlayUi.render(simulationState.getSnapshot());
renderRetryButton(simulationState.getSnapshot());
renderStartButton();
requestAnimationFrame(tick);
