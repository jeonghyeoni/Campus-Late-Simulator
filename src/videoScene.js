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
    this.lastVideoTransform = "";
    this.lastVideoFilter = "";
    this.lastVideoWillChange = "";
    this.lastVideoFilterUpdateAt = 0;
    this.pointerBounds = null;
    this.transformSettled = false;

    this.video = this.createVideoElement();
    this.video.className = "scene-video";
    this.container.appendChild(this.video);

    this.bindPointerControls();
    this.updatePointerBounds();
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
    window.addEventListener("resize", () => {
      this.pointerBounds = null;
    });

    this.container.addEventListener("pointerenter", () => {
      this.updatePointerBounds();
    });

    this.container.addEventListener("pointermove", (event) => {
      const flat = this.config.flatView;
      const bounds = this.pointerBounds ?? this.updatePointerBounds();
      const normalizedX = clamp(
        (event.clientX - bounds.centerX) / bounds.halfControlWidth,
        -1,
        1
      );
      const normalizedY = clamp(
        (event.clientY - bounds.centerY) / bounds.halfControlHeight,
        -1,
        1
      );

      this.targetOffsetX = -normalizedX * flat.maxTranslateXPercent;
      this.targetOffsetY = -normalizedY * flat.maxTranslateYPercent;
      this.transformSettled = false;
    });

    this.container.addEventListener("pointerleave", () => {
      this.targetOffsetX = 0;
      this.targetOffsetY = 0;
      this.transformSettled = false;
    });
  }

  updatePointerBounds() {
    const flat = this.config.flatView;
    const rect = this.container.getBoundingClientRect();
    this.pointerBounds = {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      halfControlWidth: Math.max((rect.width * flat.controlAreaRatio) / 2, 1),
      halfControlHeight: Math.max((rect.height * flat.controlAreaRatio) / 2, 1)
    };

    return this.pointerBounds;
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
    this.transformSettled = false;
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

  update(deltaSeconds, snapshot, performanceSnapshot = null) {
    const amount = expSmoothingFactor(
      this.config.flatView.smoothing,
      deltaSeconds
    );

    this.currentOffsetX = lerp(this.currentOffsetX, this.targetOffsetX, amount);
    this.currentOffsetY = lerp(this.currentOffsetY, this.targetOffsetY, amount);
    this.snapSettledOffsets();
    this.flushPlaybackSpeedIfDue();
    this.updateTransform(snapshot, performanceSnapshot);
    this.recoverPlaybackStall(snapshot);
  }

  snapSettledOffsets() {
    const epsilon = 0.001;

    if (Math.abs(this.currentOffsetX - this.targetOffsetX) < epsilon) {
      this.currentOffsetX = this.targetOffsetX;
    }

    if (Math.abs(this.currentOffsetY - this.targetOffsetY) < epsilon) {
      this.currentOffsetY = this.targetOffsetY;
    }
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

  updateTransform(snapshot, performanceSnapshot = null) {
    const overload = snapshot?.overload;
    const somatic = snapshot?.somaticEffect ?? {};
    const somaticConfig = this.config.somaticEffect ?? {};
    const overloadActive = overload?.active === true;
    const symptomActive = (somatic.intensity ?? 0) > 0.015;
    const endingBlur = snapshot?.endingEffect?.blurPx ?? 0;
    const symptomBlur = somatic.blurPx ?? 0;
    const needsDynamicEffects =
      overloadActive || symptomActive || endingBlur > 0.01 || symptomBlur > 0.01;
    const scale = overloadActive
      ? this.config.overload.scale
      : this.config.flatView.scale;

    if (!needsDynamicEffects) {
      if (this.transformSettled && !this.pendingPlaybackSpeed) {
        return;
      }

      this.applyVideoTransformAndFilter(
        this.currentOffsetX,
        this.currentOffsetY,
        scale,
        "",
        performanceSnapshot
      );
      this.transformSettled =
        this.currentOffsetX === this.targetOffsetX &&
        this.currentOffsetY === this.targetOffsetY &&
        !this.pendingPlaybackSpeed;
      return;
    }

    this.transformSettled = false;

    let overloadY = 0;
    let overloadShakeX = 0;
    let overloadShakeY = 0;

    if (overloadActive) {
      const overloadPhase = overload.elapsedSeconds * Math.PI * 2;
      overloadY =
        Math.sin(overloadPhase * this.config.overload.swayHz) *
        this.config.overload.swayPercent;
      overloadShakeX =
        Math.sin(overloadPhase * 5.6) *
        Math.sin(overloadPhase * 2.3) *
        (this.config.overload.shakeXPercent ?? 0);
      overloadShakeY =
        Math.cos(overloadPhase * 4.7) *
        Math.sin(overloadPhase * 1.9) *
        (this.config.overload.shakeYPercent ?? 0);
    }

    const heartbeatPulse = somatic.heartbeatPulse ?? 0;
    const heartbeatZoom =
      heartbeatPulse > 0.001
        ? heartbeatPulse * (somaticConfig.heartbeatZoom ?? 0)
        : 0;
    const breathPulse = somatic.breathPulse ?? 0;
    const breathY =
      Math.abs(breathPulse) > 0.001
        ? breathPulse * (somaticConfig.breathSwayPercent ?? 0)
        : 0;
    const panicSway =
      (somatic.panic ?? 0) * (somaticConfig.panicSwayPercent ?? 0);
    let panicX = 0;
    let panicY = 0;

    if (panicSway > 0.001) {
      const elapsedSeconds = snapshot?.elapsedClockSeconds ?? 0;
      panicX =
        Math.sin(elapsedSeconds * 17.3) *
        Math.sin(elapsedSeconds * 5.7) *
        panicSway;
      panicY =
        Math.cos(elapsedSeconds * 13.1) *
        Math.sin(elapsedSeconds * 4.3) *
        panicSway;
    }
    const totalBlur =
      (endingBlur + symptomBlur) * this.getAdaptiveBlurScale(performanceSnapshot);

    const translateX = this.currentOffsetX + overloadShakeX + panicX;
    const translateY =
      this.currentOffsetY + overloadY + overloadShakeY + breathY + panicY;
    let filter = "";
    if (totalBlur > 0.01) {
      filter = `blur(${totalBlur.toFixed(2)}px)`;
    }

    if (symptomActive) {
      filter += `${filter ? " " : ""}brightness(${(1 - (somatic.dim ?? 0)).toFixed(3)}) contrast(${(1 + (somatic.contrast ?? 0)).toFixed(3)}) saturate(${(1 - (somatic.desaturation ?? 0)).toFixed(3)})`;
    }

    this.applyVideoTransformAndFilter(
      translateX,
      translateY,
      scale + heartbeatZoom,
      filter,
      performanceSnapshot
    );
  }

  applyVideoTransformAndFilter(
    translateX,
    translateY,
    scale,
    filter,
    performanceSnapshot
  ) {
    const transform = `translate3d(${translateX.toFixed(3)}%, ${translateY.toFixed(3)}%, 0) scale(${scale.toFixed(4)})`;

    if (transform !== this.lastVideoTransform) {
      this.video.style.transform = transform;
      this.lastVideoTransform = transform;
    }

    if (this.shouldUpdateFilter(filter, performanceSnapshot)) {
      this.video.style.filter = filter;
      this.lastVideoFilter = filter;
      this.lastVideoFilterUpdateAt = performance.now();
    }

    const willChange = filter ? "transform, filter" : "transform";
    if (willChange !== this.lastVideoWillChange) {
      this.video.style.willChange = willChange;
      this.lastVideoWillChange = willChange;
    }
  }

  shouldUpdateFilter(nextFilter, performanceSnapshot) {
    if (nextFilter === this.lastVideoFilter) {
      return false;
    }

    if (!nextFilter || !this.lastVideoFilter) {
      return true;
    }

    const now = performance.now();
    const filterUpdateHz = this.getAdaptiveFilterUpdateHz(performanceSnapshot);
    const intervalMs = 1000 / Math.max(1, filterUpdateHz);

    return now - this.lastVideoFilterUpdateAt >= intervalMs;
  }

  getAdaptiveFilterUpdateHz(performanceSnapshot) {
    const lagLevel = performanceSnapshot?.lagLevel ?? 0;

    if (lagLevel >= 2) {
      return this.config.video.criticalFilterUpdateHz ?? 10;
    }

    if (lagLevel >= 1) {
      return this.config.video.laggedFilterUpdateHz ?? 16;
    }

    return this.config.video.filterUpdateHz ?? 24;
  }

  getAdaptiveBlurScale(performanceSnapshot) {
    const lagLevel = performanceSnapshot?.lagLevel ?? 0;

    if (lagLevel >= 2) {
      return this.config.video.criticalBlurScale ?? 0.45;
    }

    if (lagLevel >= 1) {
      return this.config.video.laggedBlurScale ?? 0.75;
    }

    return 1;
  }
}
