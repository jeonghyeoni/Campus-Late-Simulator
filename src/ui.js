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
      this.somaticNoiseCanvas?.getContext("2d", {
        alpha: true,
        desynchronized: true
      }) ?? null;
    this.disableBlackNoiseSmoothing();
    this.blackNoiseLayerFrames = null;
    this.blackNoiseLayerSize = 0;
    this.blackNoiseLayerCount = 0;
    this.blackNoiseFrameCount = 0;
    this.blackNoiseFrameIndex = 0;
    this.blackNoiseLayerCache = new Map();
    this.blackNoisePatternCache = new Map();
    this.blackNoiseOffsetX = 0;
    this.blackNoiseOffsetY = 0;
    this.blackNoiseSeed = 0x9e3779b9;
    this.lastBlackNoiseRenderAt = 0;
    this.blackNoiseVisible = false;
    this.blackNoiseCanvasWidth = 0;
    this.blackNoiseCanvasHeight = 0;
    this.blackNoiseCanvasResizeObserver = null;
    this.lastSomaticStyleRenderAt = 0;
    this.somaticStyleInactive = false;
    this.renderCache = new Map();
    this.displayedMessage = "";
    this.messageClearTimer = null;

    this.classStartValue.textContent = this.formatTime(
      config.clock.classStartHours,
      config.clock.classStartMinutes,
      config.clock.classStartSeconds
    );
    this.observeBlackNoiseCanvasSize();
    this.scheduleBlackNoisePrewarm();
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
    const blackNoise = this.clampCssNumber(effect.blackNoise);

    if (intensity <= 0.004 && blackNoise <= 0.004) {
      this.renderInactiveSomaticStyle();
      this.clearBlackNoiseCanvas();
      return;
    }

    const tunnel = this.clampCssNumber(effect.tunnel);
    const oxygenDebt = this.clampCssNumber(effect.oxygenDebt);
    const panic = this.clampCssNumber(effect.panic);
    const heartbeat = this.clampCssNumber(effect.heartbeatPulse);

    this.renderSomaticStyle(
      intensity,
      tunnel,
      oxygenDebt,
      panic,
      heartbeat,
      performanceSnapshot
    );
    this.renderBlackNoise(blackNoise, performanceSnapshot);
  }

  renderSomaticStyle(
    intensity,
    tunnel,
    oxygenDebt,
    panic,
    heartbeat,
    performanceSnapshot
  ) {
    const config = this.config.somaticEffect ?? {};
    const now = performance.now();
    const styleHz = this.getAdaptiveNumber(
      config.styleUpdateHz ?? 30,
      config.laggedStyleUpdateHz ?? 20,
      config.criticalStyleUpdateHz ?? 12,
      performanceSnapshot
    );
    const intervalMs = 1000 / Math.max(1, styleHz);
    const forceInactive = intensity <= 0.004;

    if (!forceInactive && now - this.lastSomaticStyleRenderAt < intervalMs) {
      return;
    }

    this.lastSomaticStyleRenderAt = now;
    this.somaticStyleInactive = false;
    this.setDatasetValue(
      "somaticActive",
      this.somaticOverlay,
      "active",
      intensity > 0.02 ? "true" : "false"
    );
    this.setStyleProperty(
      "somaticOpacity",
      this.somaticOverlay,
      "--somatic-opacity",
      this.formatCssNumber(intensity * (config.overlayOpacity ?? 0.96))
    );
    this.setStyleProperty(
      "somaticTunnel",
      this.somaticOverlay,
      "--somatic-tunnel-alpha",
      this.formatCssNumber(tunnel * (config.tunnelAlpha ?? 0.72))
    );
    this.setStyleProperty(
      "somaticEdge",
      this.somaticOverlay,
      "--somatic-edge-alpha",
      this.formatCssNumber(tunnel * (config.edgeAlpha ?? 0.9))
    );
    this.setStyleProperty(
      "somaticPulse",
      this.somaticOverlay,
      "--somatic-pulse-alpha",
      this.formatCssNumber(
        (heartbeat * (config.heartbeatPulseAlpha ?? 0.34) +
          panic * (config.panicPulseAlpha ?? 0.12)) *
          intensity
      )
    );
    this.setStyleProperty(
      "somaticOxygen",
      this.somaticOverlay,
      "--somatic-oxygen-alpha",
      this.formatCssNumber(oxygenDebt * (config.oxygenEdgeAlpha ?? 0.24))
    );
    this.setStyleProperty(
      "somaticPanic",
      this.somaticOverlay,
      "--somatic-panic-alpha",
      this.formatCssNumber(panic * (config.panicStaticAlpha ?? 0.3))
    );
    this.setStyleProperty(
      "somaticHeartbeat",
      this.somaticOverlay,
      "--somatic-heartbeat",
      this.formatCssNumber(heartbeat)
    );
  }

  renderInactiveSomaticStyle() {
    if (this.somaticStyleInactive) {
      return;
    }

    this.somaticStyleInactive = true;
    this.setDatasetValue(
      "somaticActive",
      this.somaticOverlay,
      "active",
      "false"
    );
    this.setStyleProperty(
      "somaticOpacity",
      this.somaticOverlay,
      "--somatic-opacity",
      "0.000"
    );
    this.setStyleProperty(
      "somaticTunnel",
      this.somaticOverlay,
      "--somatic-tunnel-alpha",
      "0.000"
    );
    this.setStyleProperty(
      "somaticEdge",
      this.somaticOverlay,
      "--somatic-edge-alpha",
      "0.000"
    );
    this.setStyleProperty(
      "somaticPulse",
      this.somaticOverlay,
      "--somatic-pulse-alpha",
      "0.000"
    );
    this.setStyleProperty(
      "somaticOxygen",
      this.somaticOverlay,
      "--somatic-oxygen-alpha",
      "0.000"
    );
    this.setStyleProperty(
      "somaticPanic",
      this.somaticOverlay,
      "--somatic-panic-alpha",
      "0.000"
    );
    this.setStyleProperty(
      "somaticHeartbeat",
      this.somaticOverlay,
      "--somatic-heartbeat",
      "0.000"
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

    const width = this.blackNoiseCanvasWidth;
    const height = this.blackNoiseCanvasHeight;

    if (width <= 0 || height <= 0) {
      return;
    }

    if (
      this.somaticNoiseCanvas.width !== width ||
      this.somaticNoiseCanvas.height !== height
    ) {
      this.somaticNoiseCanvas.width = width;
      this.somaticNoiseCanvas.height = height;
      this.disableBlackNoiseSmoothing();
    }

    this.drawBlackNoiseTexture(intensity, width, height, performanceSnapshot);
  }

  observeBlackNoiseCanvasSize() {
    if (!this.somaticNoiseCanvas) {
      return;
    }

    const updateSize = () => {
      const rect = this.somaticNoiseCanvas.getBoundingClientRect();
      this.blackNoiseCanvasWidth = Math.ceil(rect.width);
      this.blackNoiseCanvasHeight = Math.ceil(rect.height);
    };

    updateSize();

    if (typeof ResizeObserver === "function") {
      this.blackNoiseCanvasResizeObserver = new ResizeObserver(updateSize);
      this.blackNoiseCanvasResizeObserver.observe(this.somaticNoiseCanvas);
    } else {
      window.addEventListener("resize", updateSize);
    }
  }

  ensureBlackNoiseTexture(size, config) {
    const layerCount = Math.max(
      1,
      Math.round(config.blackNoiseLayerCount ?? 4)
    );
    const frameCount = Math.max(
      1,
      Math.round(config.blackNoiseFrameCount ?? 4)
    );

    if (
      this.blackNoiseLayerFrames &&
      this.blackNoiseLayerSize === size &&
      this.blackNoiseLayerCount === layerCount &&
      this.blackNoiseFrameCount === frameCount
    ) {
      return;
    }

    const maxDensity = this.clampCssNumber(
      config.blackNoiseMaxDensity ?? 0.86
    );
    const layerDensity =
      maxDensity >= 1
        ? 1
        : 1 - Math.pow(1 - maxDensity, 1 / layerCount);
    const alpha = Math.round(
      255 * this.clampCssNumber(config.blackNoisePixelAlpha ?? 0.58)
    );
    const cacheKey = [
      size,
      layerCount,
      frameCount,
      maxDensity.toFixed(3),
      alpha
    ].join(":");
    const cachedFrames = this.blackNoiseLayerCache.get(cacheKey);

    if (cachedFrames) {
      this.blackNoiseLayerFrames = cachedFrames;
      this.blackNoiseLayerSize = size;
      this.blackNoiseLayerCount = layerCount;
      this.blackNoiseFrameCount = frameCount;
      this.blackNoiseFrameIndex %= frameCount;
      return;
    }

    this.blackNoiseLayerFrames = Array.from({ length: frameCount }, () =>
      Array.from({ length: layerCount }, () =>
        this.createBlackNoiseLayerCanvas(size, layerDensity, alpha)
      )
    );
    this.blackNoiseLayerCache.set(cacheKey, this.blackNoiseLayerFrames);
    this.blackNoiseLayerSize = size;
    this.blackNoiseLayerCount = layerCount;
    this.blackNoiseFrameCount = frameCount;
    this.blackNoiseFrameIndex %= frameCount;
  }

  scheduleBlackNoisePrewarm() {
    const config = this.config.somaticEffect ?? {};
    if (!config.enabled) {
      return;
    }

    const sizes = [
      config.blackNoiseTextureSize ?? 512,
      config.laggedBlackNoiseTextureSize ?? 384,
      config.criticalBlackNoiseTextureSize ?? 256
    ]
      .map((size) => Math.round(Math.max(64, size)))
      .filter((size, index, allSizes) => allSizes.indexOf(size) === index);

    const schedule =
      window.requestIdleCallback?.bind(window) ??
      ((callback) => window.setTimeout(callback, 300));

    const prewarmNextSize = () => {
      const size = sizes.shift();
      if (!size) {
        return;
      }

      this.ensureBlackNoiseTexture(size, config);
      this.prewarmBlackNoisePatterns();

      if (sizes.length) {
        schedule(prewarmNextSize);
      }
    };

    schedule(prewarmNextSize);
  }

  prewarmBlackNoisePatterns() {
    if (!this.somaticNoiseContext || !this.blackNoiseLayerFrames) {
      return;
    }

    for (const frameLayers of this.blackNoiseLayerFrames) {
      for (const layerCanvas of frameLayers) {
        this.getBlackNoisePattern(this.somaticNoiseContext, layerCanvas);
      }
    }
  }

  createBlackNoiseLayerCanvas(size, density, alpha) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: false
    });
    if (!context) {
      return canvas;
    }

    const imageData = context.createImageData(size, size);
    const data = imageData.data;
    const maxUint32 = 0xffffffff;
    const densityThreshold = density * maxUint32;
    let seed = this.blackNoiseSeed >>> 0;

    for (let index = 0; index < data.length; index += 4) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;

      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;

      if ((seed >>> 0) < densityThreshold) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        data[index + 3] = Math.round(
          alpha * (0.62 + ((seed >>> 0) / maxUint32) * 0.38)
        );
      }
    }

    this.blackNoiseSeed = seed >>> 0 || 0x9e3779b9;
    context.putImageData(imageData, 0, 0);

    return canvas;
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
    this.ensureBlackNoiseTexture(textureSize, config);

    const context = this.somaticNoiseContext;
    const layerFrames = this.blackNoiseLayerFrames;

    if (!context || !layerFrames) {
      return;
    }

    const minDensity = config.blackNoiseMinDensity ?? 0.015;
    const maxDensity = config.blackNoiseMaxDensity ?? 0.86;
    const density =
      minDensity +
      (maxDensity - minDensity) *
        Math.pow(this.clampCssNumber(intensity), 1.2);
    const layerProgress = Math.min(
      this.blackNoiseLayerCount,
      Math.max(
        0,
        (density / Math.max(0.001, maxDensity)) * this.blackNoiseLayerCount
      )
    );
    const fullLayerCount = Math.floor(layerProgress);
    const partialLayerAlpha = layerProgress - fullLayerCount;
    const frameLayers = layerFrames[this.blackNoiseFrameIndex] ?? [];
    this.blackNoiseFrameIndex =
      (this.blackNoiseFrameIndex + 1) % Math.max(1, this.blackNoiseFrameCount);

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

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(-this.blackNoiseOffsetX, -this.blackNoiseOffsetY);
    for (let layerIndex = 0; layerIndex < fullLayerCount; layerIndex += 1) {
      this.drawRepeatedNoiseLayer(
        context,
        frameLayers[layerIndex],
        width,
        height,
        textureSize,
        1
      );
    }

    if (partialLayerAlpha > 0.01) {
      this.drawRepeatedNoiseLayer(
        context,
        frameLayers[fullLayerCount],
        width,
        height,
        textureSize,
        partialLayerAlpha
      );
    }
    context.restore();
    this.blackNoiseVisible = true;
  }

  drawRepeatedNoiseLayer(context, layerCanvas, width, height, textureSize, alpha) {
    if (!layerCanvas || alpha <= 0) {
      return;
    }

    const pattern = this.getBlackNoisePattern(context, layerCanvas);
    if (!pattern) {
      return;
    }

    context.globalAlpha = Math.min(1, Math.max(0, alpha));
    context.fillStyle = pattern;
    context.fillRect(0, 0, width + textureSize, height + textureSize);
    context.globalAlpha = 1;
  }

  getBlackNoisePattern(context, layerCanvas) {
    if (this.blackNoisePatternCache.has(layerCanvas)) {
      return this.blackNoisePatternCache.get(layerCanvas);
    }

    const pattern = context.createPattern(layerCanvas, "repeat");
    this.blackNoisePatternCache.set(layerCanvas, pattern);
    return pattern;
  }

  disableBlackNoiseSmoothing() {
    if (this.somaticNoiseContext) {
      this.somaticNoiseContext.imageSmoothingEnabled = false;
    }
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
