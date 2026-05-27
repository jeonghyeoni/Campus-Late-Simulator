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
    this.pendingPlaybackSpeed = null;
    this.lastPlaybackRateUpdateAt = 0;
    this.lastObservedVideoTime = 0;
    this.lastVideoProgressAt = performance.now();
    this.lastStallRecoveryAt = 0;

    this.video = this.createVideoElement();
    this.video.className = "scene-video";
    this.container.appendChild(this.video);

    this.bindPointerControls();
    this.updateTransform();
  }

  createVideoElement() {
    const video = document.createElement("video");
    video.src = this.getVideoSource();
    video.muted = this.config.video.muted;
    video.volume = this.config.video.muted ? 0 : 1;
    video.loop = false;
    video.playsInline = true;
    video.preload = "auto";

    if (this.config.video.crossOrigin) {
      video.crossOrigin = this.config.video.crossOrigin;
    }

    return video;
  }

  getVideoSource() {
    return this.config.video.src;
  }

  setSource(src) {
    if (!src || this.video.currentSrc === src || this.video.src === src) {
      return;
    }

    this.video.pause();
    this.video.src = src;
    this.video.load();
    this.lastAppliedPlaybackSpeed = null;
    this.pendingPlaybackSpeed = null;
    this.lastPlaybackRateUpdateAt = 0;
    this.resetStallTracking();
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
    this.resetStallTracking();
    return this.video.play();
  }

  resetToStart() {
    this.video.pause();

    try {
      this.video.currentTime = 0;
    } catch (error) {
      console.warn("Unable to seek video to the beginning.", error);
    }

    this.targetOffsetX = 0;
    this.targetOffsetY = 0;
    this.currentOffsetX = 0;
    this.currentOffsetY = 0;
    this.video.playbackRate = this.config.run.idleSpeed;
    this.lastAppliedPlaybackSpeed = this.config.run.idleSpeed;
    this.pendingPlaybackSpeed = null;
    this.lastPlaybackRateUpdateAt = performance.now();
    this.resetStallTracking();
    this.updateTransform();
  }

  setPlaybackSpeed(speed) {
    const playbackRateUpdateHz = this.config.video.playbackRateUpdateHz ?? 20;
    const minDelta = this.config.video.playbackRateMinDelta ?? 0.015;

    if (
      this.lastAppliedPlaybackSpeed !== null &&
      Math.abs(this.lastAppliedPlaybackSpeed - speed) < minDelta
    ) {
      return;
    }

    const now = performance.now();
    const updateIntervalMs = 1000 / Math.max(playbackRateUpdateHz, 1);

    this.pendingPlaybackSpeed = speed;

    if (
      this.lastAppliedPlaybackSpeed !== null &&
      now - this.lastPlaybackRateUpdateAt < updateIntervalMs
    ) {
      return;
    }

    this.applyPendingPlaybackSpeed(now);
  }

  applyPendingPlaybackSpeed(now = performance.now()) {
    if (this.pendingPlaybackSpeed === null) {
      return;
    }

    this.video.playbackRate = this.pendingPlaybackSpeed;
    this.lastAppliedPlaybackSpeed = this.pendingPlaybackSpeed;
    this.pendingPlaybackSpeed = null;
    this.lastPlaybackRateUpdateAt = now;
  }

  update(deltaSeconds, snapshot) {
    const amount = expSmoothingFactor(
      this.config.flatView.smoothing,
      deltaSeconds
    );

    this.currentOffsetX = lerp(this.currentOffsetX, this.targetOffsetX, amount);
    this.currentOffsetY = lerp(this.currentOffsetY, this.targetOffsetY, amount);
    this.flushPlaybackSpeedIfDue();
    this.updateTransform(snapshot);
    this.recoverPlaybackStall(snapshot);
  }

  flushPlaybackSpeedIfDue() {
    if (this.pendingPlaybackSpeed === null) {
      return;
    }

    const playbackRateUpdateHz = this.config.video.playbackRateUpdateHz ?? 20;
    const updateIntervalMs = 1000 / Math.max(playbackRateUpdateHz, 1);
    const now = performance.now();

    if (now - this.lastPlaybackRateUpdateAt >= updateIntervalMs) {
      this.applyPendingPlaybackSpeed(now);
    }
  }

  resetStallTracking() {
    this.lastObservedVideoTime = this.video.currentTime || 0;
    this.lastVideoProgressAt = performance.now();
    this.lastStallRecoveryAt = 0;
  }

  recoverPlaybackStall(snapshot) {
    const recovery = this.config.video.stallRecovery;

    if (!recovery?.enabled) {
      return;
    }

    const now = performance.now();
    const currentTime = this.video.currentTime || 0;
    const progressed =
      Math.abs(currentTime - this.lastObservedVideoTime) >=
      recovery.minProgressSeconds;

    if (progressed) {
      this.lastObservedVideoTime = currentTime;
      this.lastVideoProgressAt = now;
      return;
    }

    if (this.video.paused || this.video.ended || snapshot?.outcome) {
      this.lastObservedVideoTime = currentTime;
      this.lastVideoProgressAt = now;
      return;
    }

    const stalledLongEnough =
      now - this.lastVideoProgressAt >= recovery.stalledAfterMs;
    const recoveryCooledDown =
      now - this.lastStallRecoveryAt >= recovery.cooldownMs;

    if (!stalledLongEnough || !recoveryCooledDown) {
      return;
    }

    this.lastStallRecoveryAt = now;
    this.lastAppliedPlaybackSpeed = null;

    this.video.play().catch((error) => {
      console.warn("Unable to resume stalled video playback.", error);
    });

    if (!Number.isFinite(this.video.duration)) {
      return;
    }

    const maxTime = Math.max(0, this.video.duration - recovery.seekNudgeSeconds);
    const nudgedTime = clamp(
      currentTime + recovery.seekNudgeSeconds,
      0,
      maxTime
    );

    if (nudgedTime > currentTime) {
      try {
        this.video.currentTime = nudgedTime;
        this.lastObservedVideoTime = nudgedTime;
        this.lastVideoProgressAt = now;
      } catch (error) {
        console.warn("Unable to nudge stalled video playback.", error);
      }
    }
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
