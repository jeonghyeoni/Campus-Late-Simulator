import { clamp } from "./utils.js";

export class KeyboardRunInput {
  constructor(config) {
    this.config = config;
    this.spacePressed = false;
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
    });
  }

  update(deltaSeconds) {
    const changePerSecond = this.spacePressed
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
    return this.spacePressed;
  }
}
