import "./styles.css";
import { CONFIG } from "./config.js";
import { KeyboardRunInput } from "./input.js";
import { SimulationState } from "./state.js";
import { OverlayUi } from "./ui.js";
import { VideoScene } from "./videoScene.js";

const sceneContainer = document.querySelector("#scene");
const startButton = document.querySelector("#startButton");

const inputSource = new KeyboardRunInput(CONFIG);
const simulationState = new SimulationState(CONFIG, inputSource);
const videoScene = new VideoScene(sceneContainer, CONFIG);
const overlayUi = new OverlayUi(CONFIG);

let previousTime = performance.now();
let started = false;

window.campusLateSimulator = {
  getState: () => simulationState.getSnapshot(),
  getInputSource: () => inputSource
};

function tick(now) {
  const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;

  if (started) {
    simulationState.update(deltaSeconds, videoScene.video);
  }

  const snapshot = simulationState.getSnapshot();

  videoScene.setPlaybackSpeed(snapshot.playbackSpeed);
  videoScene.update(deltaSeconds, snapshot);
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
    await videoScene.play();
    started = true;
    previousTime = performance.now();
    startButton.classList.add("start-button--hidden");
  } catch (error) {
    startButton.classList.remove("start-button--hidden");
    console.warn("Video playback needs a user gesture.", error);
  }
}

startButton.addEventListener("click", startExperience);

videoScene.video.addEventListener("error", () => {
  startButton.textContent = "VIDEO ERROR";
  startButton.disabled = true;
});

overlayUi.render(simulationState.getSnapshot());
requestAnimationFrame(tick);
