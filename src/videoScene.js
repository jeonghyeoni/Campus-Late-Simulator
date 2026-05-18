import { clamp, expSmoothingFactor, lerp } from "./utils.js";

export class VideoScene {
  constructor(container, config) {
    this.container = container;
    this.config = config;
    this.targetOffsetX = 0;
    this.targetOffsetY = 0;
    this.currentOffsetX = 0;
    this.currentOffsetY = 0;
    this.lastAppliedPlaybackSpeed = null;

    this.video = this.createVideoElement();
    this.video.className = "scene-video";
    this.container.appendChild(this.video);

    this.bindPointerControls();
    this.updateTransform();
  }

  createVideoElement() {
    const video = document.createElement("video");
    video.src = this.getVideoSource();
    video.muted = false;
    video.volume = 1;
    video.loop = false;
    video.playsInline = true;
    video.preload = "auto";

    if (this.config.video.crossOrigin) {
      video.crossOrigin = this.config.video.crossOrigin;
    }

    return video;
  }

  getVideoSource() {
    const useMobileSource =
      window.matchMedia?.("(pointer: coarse)").matches &&
      this.config.video.mobileSrc;

    return useMobileSource ? this.config.video.mobileSrc : this.config.video.src;
  }

  bindPointerControls() {
    this.container.addEventListener("pointermove", (event) => {
      const flat = this.config.flatView;
      const rect = this.container.getBoundingClientRect();
      const halfControlWidth = (rect.width * flat.controlAreaRatio) / 2;
      const halfControlHeight = (rect.height * flat.controlAreaRatio) / 2;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const normalizedX = clamp(
        (event.clientX - centerX) / halfControlWidth,
        -1,
        1
      );
      const normalizedY = clamp(
        (event.clientY - centerY) / halfControlHeight,
        -1,
        1
      );

      this.targetOffsetX = -normalizedX * flat.maxTranslateXPercent;
      this.targetOffsetY = -normalizedY * flat.maxTranslateYPercent;
    });

    this.container.addEventListener("pointerleave", () => {
      this.targetOffsetX = 0;
      this.targetOffsetY = 0;
    });
  }

  async play() {
    return this.video.play();
  }

  setPlaybackSpeed(speed) {
    if (
      this.lastAppliedPlaybackSpeed !== null &&
      Math.abs(this.lastAppliedPlaybackSpeed - speed) < 0.015
    ) {
      return;
    }

    this.video.playbackRate = speed;
    this.lastAppliedPlaybackSpeed = speed;
  }

  update(deltaSeconds, snapshot) {
    const amount = expSmoothingFactor(
      this.config.flatView.smoothing,
      deltaSeconds
    );

    this.currentOffsetX = lerp(this.currentOffsetX, this.targetOffsetX, amount);
    this.currentOffsetY = lerp(this.currentOffsetY, this.targetOffsetY, amount);
    this.updateTransform(snapshot);
  }

  updateTransform(snapshot) {
    const overload = snapshot?.overload;
    const scale = overload?.active
      ? this.config.overload.scale
      : this.config.flatView.scale;
    const overloadY = overload?.active
      ? Math.sin(
          overload.elapsedSeconds * Math.PI * 2 * this.config.overload.swayHz
        ) * this.config.overload.swayPercent
      : 0;
    const endingBlur = snapshot?.endingEffect?.blurPx ?? 0;

    this.video.style.transform = `translate3d(${this.currentOffsetX}%, ${this.currentOffsetY + overloadY}%, 0) scale(${scale})`;
    this.video.style.filter = endingBlur > 0 ? `blur(${endingBlur}px)` : "";
  }
}
