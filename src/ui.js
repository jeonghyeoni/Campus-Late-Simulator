export class OverlayUi {
  constructor(config) {
    this.config = config;
    this.clockValue = document.querySelector("#clockValue");
    this.classStartValue = document.querySelector("#classStartValue");
    this.heartValue = document.querySelector("#heartValue");
    this.paceValue = document.querySelector("#paceValue");
    this.speedValue = document.querySelector("#speedValue");
    this.distanceValue = document.querySelector("#distanceValue");
    this.distanceFill = document.querySelector("#distanceFill");
    this.messageOverlay = document.querySelector("#messageOverlay");
    this.vignetteOverlay = document.querySelector("#vignetteOverlay");
    this.somaticOverlay = document.querySelector("#somaticOverlay");
    this.somaticNoiseCanvas = document.querySelector("#somaticNoiseCanvas");
    this.somaticNoiseContext =
      this.somaticNoiseCanvas?.getContext("2d") ?? null;
    this.blackNoiseTextureCanvas = null;
    this.blackNoiseTextureContext = null;
    this.blackNoiseTextureImageData = null;
    this.blackNoiseOffsetX = 0;
    this.blackNoiseOffsetY = 0;
    this.blackNoiseSeed = 0x9e3779b9;
    this.lastBlackNoiseRenderAt = 0;
    this.blackNoiseVisible = false;
    this.lastSomaticStyleRenderAt = 0;
    this.renderCache = new Map();
    this.displayedMessage = "";
    this.messageClearTimer = null;

    this.classStartValue.textContent = this.formatTime(
      config.clock.classStartHours,
      config.clock.classStartMinutes,
      config.clock.classStartSeconds
    );
  }

  render(snapshot, performanceSnapshot = null) {
    this.setText(
      "clock",
      this.clockValue,
      this.formatClock(snapshot.elapsedClockSeconds)
    );
    this.setText(
      "heart",
      this.heartValue,
      Math.round(snapshot.heartRate).toString()
    );
    this.setText("pace", this.paceValue, this.formatPace(snapshot));
    this.setText(
      "speed",
      this.speedValue,
      `${snapshot.playbackSpeed.toFixed(2)}x`
    );
    this.setText(
      "distance",
      this.distanceValue,
      Math.ceil(snapshot.distanceMeters).toString()
    );

    const distanceProgress =
      1 - snapshot.distanceMeters / this.config.distance.startMeters;
    this.setStyleProperty(
      "distanceTransform",
      this.distanceFill,
      "transform",
      `scaleX(${distanceProgress.toFixed(4)})`
    );
    this.setDatasetValue(
      "vignetteActive",
      this.vignetteOverlay,
      "active",
      snapshot.overload.active ? "true" : "false"
    );
    this.renderSomaticEffect(snapshot, performanceSnapshot);
    this.renderMessage(snapshot);
  }

  renderSomaticEffect(snapshot, performanceSnapshot = null) {
    if (!this.somaticOverlay) {
      return;
    }

    const effect = snapshot.somaticEffect ?? {};
    const intensity = this.clampCssNumber(effect.intensity);
    const tunnel = this.clampCssNumber(effect.tunnel);
    const oxygenDebt = this.clampCssNumber(effect.oxygenDebt);
    const blackNoise = this.clampCssNumber(effect.blackNoise);
    const panic = this.clampCssNumber(effect.panic);
    const heartbeat = this.clampCssNumber(effect.heartbeatPulse);

    this.renderSomaticStyle(
      {
        intensity,
        tunnel,
        oxygenDebt,
        panic,
        heartbeat
      },
      performanceSnapshot
    );
    this.renderBlackNoise(blackNoise, performanceSnapshot);
  }

  renderSomaticStyle(effect, performanceSnapshot) {
    const config = this.config.somaticEffect ?? {};
    const now = performance.now();
    const styleHz = this.getAdaptiveNumber(
      config.styleUpdateHz ?? 30,
      config.laggedStyleUpdateHz ?? 20,
      config.criticalStyleUpdateHz ?? 12,
      performanceSnapshot
    );
    const intervalMs = 1000 / Math.max(1, styleHz);
    const forceInactive = effect.intensity <= 0.004;

    if (!forceInactive && now - this.lastSomaticStyleRenderAt < intervalMs) {
      return;
    }

    this.lastSomaticStyleRenderAt = now;
    this.setDatasetValue(
      "somaticActive",
      this.somaticOverlay,
      "active",
      effect.intensity > 0.02 ? "true" : "false"
    );
    this.setStyleProperty(
      "somaticOpacity",
      this.somaticOverlay,
      "--somatic-opacity",
      this.formatCssNumber(effect.intensity * 0.96)
    );
    this.setStyleProperty(
      "somaticTunnel",
      this.somaticOverlay,
      "--somatic-tunnel-alpha",
      this.formatCssNumber(effect.tunnel * 0.72)
    );
    this.setStyleProperty(
      "somaticEdge",
      this.somaticOverlay,
      "--somatic-edge-alpha",
      this.formatCssNumber(effect.tunnel * 0.9)
    );
    this.setStyleProperty(
      "somaticPulse",
      this.somaticOverlay,
      "--somatic-pulse-alpha",
      this.formatCssNumber(
        (effect.heartbeat * 0.34 + effect.panic * 0.12) * effect.intensity
      )
    );
    this.setStyleProperty(
      "somaticOxygen",
      this.somaticOverlay,
      "--somatic-oxygen-alpha",
      this.formatCssNumber(effect.oxygenDebt * 0.24)
    );
    this.setStyleProperty(
      "somaticPanic",
      this.somaticOverlay,
      "--somatic-panic-alpha",
      this.formatCssNumber(effect.panic * 0.3)
    );
    this.setStyleProperty(
      "somaticHeartbeat",
      this.somaticOverlay,
      "--somatic-heartbeat",
      this.formatCssNumber(effect.heartbeat)
    );
  }

  renderBlackNoise(intensity, performanceSnapshot = null) {
    if (!this.somaticNoiseCanvas || !this.somaticNoiseContext) {
      return;
    }

    if (intensity <= 0.004) {
      this.clearBlackNoiseCanvas();
      return;
    }

    const now = performance.now();
    const config = this.config.somaticEffect ?? {};
    const frameHz = this.getAdaptiveNumber(
      config.blackNoiseFrameHz ?? 12,
      config.laggedBlackNoiseFrameHz ?? 8,
      config.criticalBlackNoiseFrameHz ?? 5,
      performanceSnapshot
    );
    const frameIntervalMs = 1000 / Math.max(1, frameHz);

    if (now - this.lastBlackNoiseRenderAt < frameIntervalMs) {
      return;
    }

    this.lastBlackNoiseRenderAt = now;

    const rect = this.somaticNoiseCanvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    if (
      this.somaticNoiseCanvas.width !== width ||
      this.somaticNoiseCanvas.height !== height
    ) {
      this.somaticNoiseCanvas.width = width;
      this.somaticNoiseCanvas.height = height;
    }

    this.drawBlackNoiseTexture(intensity, width, height, performanceSnapshot);
  }

  ensureBlackNoiseTexture(size) {
    if (
      this.blackNoiseTextureCanvas?.width === size &&
      this.blackNoiseTextureCanvas?.height === size &&
      this.blackNoiseTextureImageData?.width === size &&
      this.blackNoiseTextureImageData?.height === size
    ) {
      return;
    }

    this.blackNoiseTextureCanvas = document.createElement("canvas");
    this.blackNoiseTextureCanvas.width = size;
    this.blackNoiseTextureCanvas.height = size;
    this.blackNoiseTextureContext =
      this.blackNoiseTextureCanvas.getContext("2d");

    if (!this.blackNoiseTextureContext) {
      this.blackNoiseTextureImageData = null;
      return;
    }

    this.blackNoiseTextureImageData =
      this.blackNoiseTextureContext.createImageData(size, size);

    const data = this.blackNoiseTextureImageData.data;
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
    }
  }

  drawBlackNoiseTexture(intensity, width, height, performanceSnapshot = null) {
    const config = this.config.somaticEffect ?? {};
    const textureSize = Math.round(
      Math.max(
        64,
        this.getAdaptiveNumber(
          config.blackNoiseTextureSize ?? 512,
          config.laggedBlackNoiseTextureSize ?? 384,
          config.criticalBlackNoiseTextureSize ?? 256,
          performanceSnapshot
        )
      )
    );
    this.ensureBlackNoiseTexture(textureSize);

    const context = this.somaticNoiseContext;
    const textureContext = this.blackNoiseTextureContext;
    const textureCanvas = this.blackNoiseTextureCanvas;
    const imageData = this.blackNoiseTextureImageData;

    if (!context || !textureContext || !textureCanvas || !imageData) {
      return;
    }

    const minDensity = config.blackNoiseMinDensity ?? 0.015;
    const maxDensity = config.blackNoiseMaxDensity ?? 0.86;
    const density =
      minDensity +
      (maxDensity - minDensity) *
        Math.pow(this.clampCssNumber(intensity), 1.2);
    const alpha = Math.round(
      255 * this.clampCssNumber(config.blackNoisePixelAlpha ?? 0.58)
    );
    const maxUint32 = 0xffffffff;
    const densityThreshold = density * maxUint32;
    const data = imageData.data;
    let seed = this.blackNoiseSeed >>> 0;

    for (let alphaIndex = 3; alphaIndex < data.length; alphaIndex += 4) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;

      if ((seed >>> 0) < densityThreshold) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        data[alphaIndex] = Math.round(
          alpha * (0.62 + ((seed >>> 0) / maxUint32) * 0.38)
        );
      } else {
        data[alphaIndex] = 0;
      }
    }

    this.blackNoiseSeed = seed >>> 0 || 0x9e3779b9;
    textureContext.putImageData(imageData, 0, 0);

    const jitterPx = config.blackNoiseJitterPx ?? 16;
    this.blackNoiseOffsetX =
      (this.blackNoiseOffsetX +
        this.nextBlackNoiseSignedRandom() * jitterPx +
        textureSize) %
      textureSize;
    this.blackNoiseOffsetY =
      (this.blackNoiseOffsetY +
        this.nextBlackNoiseSignedRandom() * jitterPx +
        textureSize) %
      textureSize;

    const pattern = context.createPattern(textureCanvas, "repeat");
    if (!pattern) {
      return;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(-this.blackNoiseOffsetX, -this.blackNoiseOffsetY);
    context.fillStyle = pattern;
    context.fillRect(
      this.blackNoiseOffsetX,
      this.blackNoiseOffsetY,
      width + textureSize,
      height + textureSize
    );
    context.restore();
    this.blackNoiseVisible = true;
  }

  nextBlackNoiseSignedRandom() {
    let seed = this.blackNoiseSeed >>> 0;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    this.blackNoiseSeed = seed >>> 0 || 0x9e3779b9;

    return ((this.blackNoiseSeed >>> 0) / 0xffffffff - 0.5) * 2;
  }

  getAdaptiveNumber(normalValue, laggedValue, criticalValue, performanceSnapshot) {
    const lagLevel = performanceSnapshot?.lagLevel ?? 0;

    if (lagLevel >= 2) {
      return criticalValue;
    }

    if (lagLevel >= 1) {
      return laggedValue;
    }

    return normalValue;
  }

  clearBlackNoiseCanvas() {
    if (!this.somaticNoiseCanvas || !this.somaticNoiseContext) {
      return;
    }

    if (!this.blackNoiseVisible) {
      return;
    }

    this.somaticNoiseContext.setTransform(1, 0, 0, 1, 0, 0);
    this.somaticNoiseContext.clearRect(
      0,
      0,
      this.somaticNoiseCanvas.width,
      this.somaticNoiseCanvas.height
    );
    this.blackNoiseVisible = false;
  }

  setText(key, element, value) {
    if (!element || this.renderCache.get(key) === value) {
      return;
    }

    element.textContent = value;
    this.renderCache.set(key, value);
  }

  setDatasetValue(key, element, name, value) {
    if (!element || this.renderCache.get(key) === value) {
      return;
    }

    element.dataset[name] = value;
    this.renderCache.set(key, value);
  }

  setStyleProperty(key, element, name, value) {
    if (!element || this.renderCache.get(key) === value) {
      return;
    }

    element.style.setProperty(name, value);
    this.renderCache.set(key, value);
  }

  clampCssNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }

    return Math.min(1, Math.max(0, number));
  }

  formatCssNumber(value) {
    return this.clampCssNumber(value).toFixed(3);
  }

  formatPace(snapshot) {
    if (snapshot.overload.active) {
      return "OVERLOAD";
    }

    return snapshot.isRunning ? "RUNNING" : "WALKING";
  }

  renderMessage(snapshot) {
    const nextMessage = snapshot.message;

    if (nextMessage) {
      window.clearTimeout(this.messageClearTimer);
      this.messageClearTimer = null;
      this.displayedMessage = nextMessage;
      this.setText("messageText", this.messageOverlay, this.displayedMessage);
      this.setDatasetValue("messageVisible", this.messageOverlay, "visible", "true");
    } else {
      this.setDatasetValue("messageVisible", this.messageOverlay, "visible", "false");

      if (this.displayedMessage && !this.messageClearTimer) {
        this.messageClearTimer = window.setTimeout(() => {
          this.displayedMessage = "";
          this.setText("messageText", this.messageOverlay, "");
          this.messageClearTimer = null;
        }, this.config.message.fadeMs);
      }
    }

    this.setDatasetValue(
      "messageTone",
      this.messageOverlay,
      "tone",
      snapshot.outcome ?? "notice"
    );
  }

  formatClock(elapsedSeconds) {
    const start =
      this.config.clock.startHours * 3600 +
      this.config.clock.startMinutes * 60 +
      this.config.clock.startSeconds;
    const secondsInDay = 24 * 3600;
    const total = Math.floor(start + elapsedSeconds) % secondsInDay;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    return this.formatTime(hours, minutes, seconds);
  }

  formatTime(hours, minutes, seconds) {
    return [hours, minutes, seconds]
      .map((value) => value.toString().padStart(2, "0"))
      .join(":");
  }
}
