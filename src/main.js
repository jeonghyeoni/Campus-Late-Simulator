import "./styles.css";
import { CONFIG } from "./config.js";
import { KeyboardRunInput } from "./input.js";
import { SimulationState } from "./state.js";
import { OverlayUi } from "./ui.js";
import { VideoScene } from "./videoScene.js";
import { AudioEngine } from "./audioEngine.js";

const sceneContainer = document.querySelector("#scene");
const startButton = document.querySelector("#startButton");
const startPanel = document.querySelector("#startPanel");
const qualitySelect = document.querySelector("#qualitySelect");

const inputSource = new KeyboardRunInput(CONFIG, sceneContainer);
const simulationState = new SimulationState(CONFIG, inputSource);
const videoScene = new VideoScene(sceneContainer, CONFIG);
const overlayUi = new OverlayUi(CONFIG);
const audioEngine = new AudioEngine(CONFIG.audio);

let previousTime = performance.now();
let started = false;

window.campusLateSimulator = {
  getState: () => simulationState.getSnapshot(),
  getInputSource: () => inputSource,
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

  window.dispatchEvent(
    new CustomEvent("campus-simulator-state", {
      detail: snapshot
    })
  );

  requestAnimationFrame(tick);
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

startButton.addEventListener("click", startExperience);

videoScene.video.addEventListener("error", () => {
  startButton.textContent = "VIDEO ERROR";
  startButton.disabled = true;
});

overlayUi.render(simulationState.getSnapshot());
requestAnimationFrame(tick);
