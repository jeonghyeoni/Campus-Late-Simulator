import { clamp } from "./utils.js";

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

  isActive() {
    return this.spacePressed || this.touchPressed;
  }

  reset() {
    this.runIntensity = 0;
  }

  getRunPromptMessage() {
    return this.prefersTouchInput ? "hold screen to run" : "hold space to run";
  }

  shouldUseTouchRun(event) {
    return event.pointerType === "touch" || event.pointerType === "pen";
  }
}
