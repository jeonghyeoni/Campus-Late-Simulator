import "./styles.css";
import { CONFIG } from "./config.js";
import { KeyboardRunInput, RunInputManager, TdInputRunInput } from "./input.js";
import { SimulationState } from "./state.js";
import { OverlayUi } from "./ui.js";
import { VideoScene } from "./videoScene.js";
import { AudioEngine } from "./audioEngine.js";

const sceneContainer = document.querySelector("#scene");
const startButton = document.querySelector("#startButton");
const startPanel = document.querySelector("#startPanel");
const qualitySelect = document.querySelector("#qualitySelect");
const inputModeControls = document.querySelectorAll("input[name='inputMode']");
const tdInputConnection = document.querySelector("#tdInputConnection");
const tdInputStatus = document.querySelector("#tdInputStatus");
const tdInputRoomId = document.querySelector("#tdInputRoomId");
const tdInputServerHost = document.querySelector("#tdInputServerHost");
const tdInputUdpPort = document.querySelector("#tdInputUdpPort");

const keyboardInput = new KeyboardRunInput(CONFIG, sceneContainer);
const tdInput = new TdInputRunInput(CONFIG);
const inputSource = new RunInputManager(CONFIG, keyboardInput, tdInput);
const simulationState = new SimulationState(CONFIG, inputSource);
const videoScene = new VideoScene(sceneContainer, CONFIG);
const overlayUi = new OverlayUi(CONFIG);
const audioEngine = new AudioEngine(CONFIG.audio);

let previousTime = performance.now();
let started = false;

window.campusLateSimulator = {
  getState: () => simulationState.getSnapshot(),
  getInputSource: () => inputSource,
  getTdInput: () => tdInput,
  getAudioEngine: () => audioEngine
};

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

function tick(now) {
  const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;

  if (started) {
    simulationState.update(deltaSeconds, videoScene.video);
  }

  const snapshot = simulationState.getSnapshot();

  videoScene.setPlaybackSpeed(snapshot.playbackSpeed);
  videoScene.update(deltaSeconds, snapshot);
  audioEngine.updateFromSnapshot(snapshot);
  overlayUi.render(snapshot);
  renderTdInputConnection();

  window.dispatchEvent(
    new CustomEvent("campus-simulator-state", {
      detail: snapshot
    })
  );

  requestAnimationFrame(tick);
}

function renderTdInputConnection() {
  const mode = inputSource.getMode();
  const sensorMode = mode === "phone" || mode === "watch";
  tdInputConnection.hidden = !sensorMode;
  startPanel.dataset.inputMode = mode;

  if (!sensorMode) {
    return;
  }

  const connection = inputSource.getConnectionSnapshot();
  tdInputConnection.dataset.status = connection.status;
  tdInputStatus.textContent = connection.statusText;
  tdInputRoomId.textContent = connection.roomId || "----";
  tdInputServerHost.textContent =
    connection.serverHost || getHostFromWebSocketUrl(CONFIG.bridge.wsUrl);
  tdInputUdpPort.textContent = connection.udpPort || "----";
}

function getHostFromWebSocketUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "127.0.0.1";
  }
}

async function startExperience() {
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

populateQualitySelect();

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
    renderTdInputConnection();
  });
});

startButton.addEventListener("click", startExperience);

videoScene.video.addEventListener("error", () => {
  startButton.textContent = "VIDEO ERROR";
  startButton.disabled = true;
});

overlayUi.render(simulationState.getSnapshot());
requestAnimationFrame(tick);
