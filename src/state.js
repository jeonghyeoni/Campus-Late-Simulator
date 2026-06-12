import { clamp, expSmoothingFactor, lerp } from "./utils.js";

export class SimulationState {
  constructor(config, inputSource) {
    this.config = config;
    this.inputSource = inputSource;
    this.snapshot = this.createSnapshotObject();
    this.reset();
  }

  reset() {
    this.elapsedClockSeconds = 0;
    this.runIntensity = 0;
    this.inputActive = false;
    this.isRunning = false;
    this.playbackSpeed = this.config.run.idleSpeed;
    this.targetPlaybackSpeed = this.config.run.idleSpeed;
    this.sensorPlaybackSampleAccumulator = 0;
    this.heartRate = this.config.heart.baseBpm;
    this.heartSampleAccumulator = 0;
    this.distanceMeters = this.config.distance.startMeters;
    this.videoTime = 0;
    this.videoDuration = 0;
    this.timeRemaining = null;
    this.hasEnteredClassroomHallway = false;
    this.classroomHallwayProgress = 0;
    this.runUnlocked = false;
    this.quietCorridorActive = false;
    this.previousQuietCorridorActive = false;
    this.quietCorridorExitMessageSeconds = 0;
    this.overloadActive = false;
    this.overloadElapsedSeconds = 0;
    this.somaticEffect = this.createEmptySomaticEffect();
    this.endingEffect = {
      active: false,
      progress: 0,
      blurPx: 0
    };
    this.message = "";
    this.outcome = null;
    this.inputSource.reset?.();
  }

  update(deltaSeconds, video) {
    this.inputSource.update(deltaSeconds);
    this.videoTime = video?.currentTime ?? 0;
    this.videoDuration =
      video?.duration && Number.isFinite(video.duration) ? video.duration : 0;
    this.timeRemaining = this.videoDuration
      ? Math.max(0, this.videoDuration - this.videoTime)
      : null;
    this.updateClassroomHallway();
    this.runUnlocked = this.isRunUnlocked(video);
    this.updateQuietCorridor(deltaSeconds);
    if (!this.runUnlocked) {
      this.inputSource.reset?.();
    }
    const rawInputActive =
      this.inputSource.isActive?.() ?? this.inputSource.getRunIntensity() > 0.01;
    this.inputActive = rawInputActive && this.runUnlocked;
    this.updateOverloadElapsed(deltaSeconds);

    const requestedRunIntensity = this.runUnlocked
      ? this.inputSource.getRunIntensity()
      : 0;
    this.runIntensity =
      this.isOverloaded() || this.shouldBlockRunning()
        ? 0
        : requestedRunIntensity;
    this.isRunning =
      !this.isOverloaded() &&
      !this.shouldBlockRunning() &&
      this.runUnlocked &&
      this.isRunningIntentActive();

    this.updateHeartRate(deltaSeconds);
    this.updateSomaticEffect(deltaSeconds);
    this.updateDistanceFromVideo(video);
    this.updateEndingEffect(video);
    this.updatePlaybackSpeed(deltaSeconds);
    this.elapsedClockSeconds += deltaSeconds;
    this.updateOutcome(video);
    this.updateMessage(rawInputActive);
  }

  updateQuietCorridor(deltaSeconds) {
    this.previousQuietCorridorActive = this.quietCorridorActive;
    this.quietCorridorActive = this.isQuietCorridorActive();

    if (
      this.previousQuietCorridorActive &&
      !this.quietCorridorActive &&
      this.runUnlocked
    ) {
      this.quietCorridorExitMessageSeconds =
        this.config.quietCorridor.exitMessageDurationSeconds;
    } else if (this.quietCorridorExitMessageSeconds > 0) {
      this.quietCorridorExitMessageSeconds = Math.max(
        0,
        this.quietCorridorExitMessageSeconds - deltaSeconds
      );
    }
  }

  updateClassroomHallway() {
    const entrySeconds = this.config.classroomHallway.entrySeconds;
    this.hasEnteredClassroomHallway = this.videoTime >= entrySeconds;

    if (!this.hasEnteredClassroomHallway || !this.videoDuration) {
      this.classroomHallwayProgress = 0;
      return;
    }

    const hallwayDuration = Math.max(this.videoDuration - entrySeconds, 0.001);
    this.classroomHallwayProgress = clamp(
      (this.videoTime - entrySeconds) / hallwayDuration,
      0,
      1
    );
  }

  updateOverloadElapsed(deltaSeconds) {
    if (!this.isOverloaded()) {
      this.overloadElapsedSeconds = 0;
      return;
    }

    this.overloadElapsedSeconds += deltaSeconds;
  }

  updatePlaybackSpeed(deltaSeconds) {
    if (this.isOverloaded()) {
      this.targetPlaybackSpeed = this.config.run.overloadSpeed;
    } else if (this.endingEffect.active) {
      this.targetPlaybackSpeed = this.config.ending.slowSpeed;
    } else if (this.shouldBlockRunning()) {
      this.targetPlaybackSpeed = this.config.run.idleSpeed;
    } else if (this.isSensorInputMode() && !this.isRunningIntentActive()) {
      this.targetPlaybackSpeed = this.config.run.idleSpeed;
    } else {
      this.targetPlaybackSpeed =
        this.config.run.idleSpeed +
        (this.getCurrentMaxRunSpeed() - this.config.run.idleSpeed) *
          this.getPlaybackRunIntensity();
    }

    if (this.isSensorInputMode()) {
      this.updateSensorPlaybackSample(deltaSeconds);
      return;
    }

    const amount = expSmoothingFactor(
      this.getPlaybackSmoothing(),
      deltaSeconds
    );
    this.playbackSpeed = lerp(
      this.playbackSpeed,
      this.targetPlaybackSpeed,
      amount
    );
  }

  updateSensorPlaybackSample(deltaSeconds) {
    const sampleHz = this.config.run.sensorPlaybackSampleHz ?? 20;
    const sampleIntervalSeconds = 1 / Math.max(sampleHz, 1);

    this.sensorPlaybackSampleAccumulator += deltaSeconds;

    if (this.sensorPlaybackSampleAccumulator < sampleIntervalSeconds) {
      return;
    }

    this.sensorPlaybackSampleAccumulator = 0;
    this.playbackSpeed = this.targetPlaybackSpeed;
  }

  getPlaybackSmoothing() {
    if (!this.isSensorInputMode()) {
      return this.config.run.playbackSmoothing;
    }

    return this.targetPlaybackSpeed >= this.playbackSpeed
      ? this.config.run.sensorPlaybackRiseSmoothing
      : this.config.run.sensorPlaybackFallSmoothing;
  }

  getPlaybackRunIntensity() {
    if (this.isSensorInputMode()) {
      return clamp(this.inputSource.getPlaybackRunIntensity?.() ?? 0, 0, 1);
    }

    return this.runIntensity;
  }

  updateHeartRate(deltaSeconds) {
    this.heartSampleAccumulator += deltaSeconds;

    while (
      this.heartSampleAccumulator >= this.getHeartSampleIntervalSeconds()
    ) {
      this.heartSampleAccumulator -= this.getHeartSampleIntervalSeconds();
      this.sampleHeartRate();
    }
  }

  getHeartSampleIntervalSeconds() {
    if (this.isRunning && !this.isOverloaded()) {
      return (
        this.config.heart.activeSampleIntervalSeconds ??
        this.config.heart.sampleIntervalSeconds
      );
    }

    return this.config.heart.sampleIntervalSeconds;
  }

  sampleHeartRate() {
    const heart = this.config.heart;

    if (!this.runUnlocked) {
      const idleTarget = this.randomBetween(heart.idleMinBpm, heart.idleMaxBpm);
      const drift = Math.min(
        Math.abs(idleTarget - this.heartRate),
        heart.idleDriftBpmPerSample
      );
      this.heartRate += idleTarget >= this.heartRate ? drift : -drift;
    } else if (this.isOverloaded()) {
      const recovery =
        heart.overloadRecoveryBpmPerSample +
        this.randomSigned(heart.recoveryJitterBpm);
      this.heartRate -= Math.max(2, recovery);
    } else if (this.isRunning) {
      const effort = 0.35 + this.runIntensity * 0.65;
      const rise =
        heart.activeRiseBpmPerSample * effort +
        this.randomSigned(heart.activeJitterBpm);
      this.heartRate += Math.max(1, rise);
    } else {
      const recovery =
        heart.recoveryBpmPerSample + this.randomSigned(heart.recoveryJitterBpm);
      this.heartRate -= Math.max(1, recovery);
    }

    const minBpm = this.runUnlocked ? heart.baseBpm : heart.idleMinBpm;
    const maxBpm = this.runUnlocked ? heart.maxBpm : heart.idleMaxBpm;
    this.heartRate = Math.round(clamp(this.heartRate, minBpm, maxBpm));

    if (
      !this.isOverloaded() &&
      !this.outcome &&
      this.heartRate >= heart.overloadThresholdBpm
    ) {
      this.overloadActive = true;
      this.overloadElapsedSeconds = 0;
      this.runIntensity = 0;
      this.isRunning = false;
    }

    if (
      this.isOverloaded() &&
      this.heartRate <= heart.overloadRecoveryThresholdBpm
    ) {
      this.overloadActive = false;
      this.overloadElapsedSeconds = 0;
    }
  }

  randomSigned(amount) {
    return (Math.random() * 2 - 1) * amount;
  }

  randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  createEmptySomaticEffect() {
    return {
      intensity: 0,
      tunnel: 0,
      oxygenDebt: 0,
      blackNoise: 0,
      panic: 0,
      heartbeatPulse: 0,
      breathPulse: 0,
      blurPx: 0,
      dim: 0,
      desaturation: 0,
      contrast: 0
    };
  }

  createSnapshotObject() {
    return {
      elapsedClockSeconds: 0,
      runIntensity: 0,
      isRunning: false,
      inputActive: false,
      playbackSpeed: this.config.run.idleSpeed,
      targetPlaybackSpeed: this.config.run.idleSpeed,
      heartRate: this.config.heart.baseBpm,
      distanceMeters: this.config.distance.startMeters,
      videoTime: 0,
      videoDuration: 0,
      timeRemaining: null,
      currentClockSeconds: 0,
      classStartSeconds: 0,
      timeUntilClassStart: 0,
      classStarted: false,
      runUnlocked: false,
      classroomHallway: {
        hasEntered: false,
        progress: 0
      },
      quietCorridor: {
        active: false,
        blocksRunning: false
      },
      overload: {
        active: false,
        recoveryThresholdBpm: this.config.heart.overloadRecoveryThresholdBpm,
        elapsedSeconds: 0
      },
      somaticEffect: this.createEmptySomaticEffect(),
      endingEffect: {
        active: false,
        progress: 0,
        blurPx: 0
      },
      outcome: null,
      message: ""
    };
  }

  updateSomaticEffect(deltaSeconds) {
    const effectConfig = this.config.somaticEffect;
    if (!effectConfig?.enabled) {
      this.somaticEffect = this.createEmptySomaticEffect();
      return;
    }

    const maxBpm = effectConfig.maxBpm ?? this.config.heart.maxBpm;
    const intensityTarget = this.getHeartBandIntensity(
      effectConfig.onsetBpm,
      maxBpm
    );
    const tunnelTarget = this.getHeartBandIntensity(
      effectConfig.tunnelBpm,
      maxBpm
    );
    const oxygenTarget = this.getHeartBandIntensity(
      effectConfig.oxygenDebtBpm,
      maxBpm
    );
    const blackNoiseTarget = this.getHeartBandIntensity(
      effectConfig.blackNoiseBpm ?? 140,
      effectConfig.blackNoiseMaxBpm ?? 160
    );
    const panicTarget = this.getHeartBandIntensity(
      effectConfig.panicBpm,
      maxBpm
    );
    const amount = expSmoothingFactor(
      effectConfig.smoothing ?? 4,
      deltaSeconds
    );

    this.somaticEffect.intensity = lerp(
      this.somaticEffect.intensity,
      intensityTarget,
      amount
    );
    this.somaticEffect.tunnel = lerp(
      this.somaticEffect.tunnel,
      tunnelTarget,
      amount
    );
    this.somaticEffect.oxygenDebt = lerp(
      this.somaticEffect.oxygenDebt,
      oxygenTarget,
      amount
    );
    this.somaticEffect.blackNoise = lerp(
      this.somaticEffect.blackNoise,
      blackNoiseTarget,
      amount
    );
    this.somaticEffect.panic = lerp(
      this.somaticEffect.panic,
      panicTarget,
      amount
    );

    const heartHz = clamp(this.heartRate / 60, 0.8, 3.1);
    const beatPhase = this.elapsedClockSeconds * Math.PI * 2 * heartHz;
    const breathPhase =
      this.elapsedClockSeconds *
      Math.PI *
      2 *
      (effectConfig.breathHz ?? 0.62);
    const beat = Math.pow(Math.max(0, Math.sin(beatPhase)), 2.4);

    this.somaticEffect.heartbeatPulse = this.somaticEffect.intensity * beat;
    this.somaticEffect.breathPulse =
      this.somaticEffect.intensity * Math.sin(breathPhase);
    this.somaticEffect.blurPx =
      (effectConfig.maxBlurPx ?? 0) * this.somaticEffect.oxygenDebt;
    this.somaticEffect.dim =
      (effectConfig.maxDim ?? 0) * this.somaticEffect.tunnel;
    this.somaticEffect.desaturation =
      (effectConfig.maxDesaturation ?? 0) * this.somaticEffect.oxygenDebt;
    this.somaticEffect.contrast =
      (effectConfig.maxContrast ?? 0) * this.somaticEffect.panic;
  }

  getHeartBandIntensity(startBpm, endBpm) {
    const range = Math.max(endBpm - startBpm, 1);
    const linear = clamp((this.heartRate - startBpm) / range, 0, 1);
    return linear * linear * (3 - 2 * linear);
  }

  getCurrentMaxRunSpeed() {
    const isTouchInput = this.inputSource.prefersTouch?.() ?? false;
    return isTouchInput
      ? this.config.run.mobileMaxSpeed
      : this.config.run.maxSpeed;
  }

  updateDistanceFromVideo(video) {
    if (!video?.duration || !Number.isFinite(video.duration)) {
      return;
    }

    const progress = clamp(video.currentTime / video.duration, 0, 1);
    this.distanceMeters = clamp(
      this.config.distance.startMeters * (1 - progress),
      0,
      this.config.distance.startMeters
    );
  }

  updateEndingEffect(video) {
    if (!video?.duration || !Number.isFinite(video.duration)) {
      this.endingEffect = {
        active: false,
        progress: 0,
        blurPx: 0
      };
      return;
    }

    const remainingSeconds = video.duration - video.currentTime;
    const active =
      remainingSeconds <= this.config.ending.durationSeconds &&
      remainingSeconds >= 0;
    const progress = active
      ? clamp(
          1 - remainingSeconds / this.config.ending.durationSeconds,
          0,
          1
        )
      : 0;

    this.endingEffect = {
      active,
      progress,
      blurPx: this.config.ending.maxBlurPx * progress
    };
  }

  updateOutcome(video) {
    if (this.outcome || !video?.duration || !Number.isFinite(video.duration)) {
      return;
    }

    const arrived =
      video.ended &&
      video.currentTime >=
        video.duration - this.config.ending.completionThresholdSeconds;
    const late = this.getCurrentClockSeconds() >= this.getClassStartSeconds();

    if (arrived) {
      this.outcome = late ? "failure" : "success";
    }
  }

  updateMessage(rawInputActive) {
    if (this.outcome === "success") {
      this.message = "Congrats!\nYou made it before class.";
      return;
    }

    if (this.outcome === "failure") {
      this.message = "late.\nclass has already started.";
      return;
    }

    if (this.isOverloaded() && rawInputActive && this.runUnlocked) {
      this.message = "catch your breath...";
      return;
    }

    if (this.shouldBlockRunning() && rawInputActive) {
      this.message = this.config.quietCorridor.blockedMessage;
      return;
    }

    if (this.quietCorridorExitMessageSeconds > 0) {
      this.message = this.config.quietCorridor.exitMessage;
      return;
    }

    if (this.shouldShowRunPrompt()) {
      const runPrompt =
        this.inputSource.getRunPromptMessage?.() ?? "hold space to run";
      this.message = `3 minutes until class starts.\n${runPrompt}`;
      return;
    }

    this.message = "";
  }

  isOverloaded() {
    return this.overloadActive;
  }

  isRunningIntentActive() {
    return (
      this.inputSource.isRunningIntent?.() ??
      this.runIntensity > this.config.run.runningThreshold
    );
  }

  isSensorInputMode() {
    const mode = this.inputSource.getMode?.();
    return mode === "phone" || mode === "watch" || mode === "phone-motion";
  }

  isQuietCorridorActive() {
    const corridor = this.config.quietCorridor;
    return (
      this.videoTime >= corridor.startSeconds &&
      this.videoTime < corridor.endSeconds
    );
  }

  shouldBlockRunning() {
    return this.runUnlocked && this.quietCorridorActive;
  }

  isRunUnlocked(video) {
    return (video?.currentTime ?? 0) >= this.config.run.unlockVideoTimeSeconds;
  }

  shouldShowRunPrompt() {
    return (
      this.runUnlocked &&
      this.videoTime <
        this.config.run.unlockVideoTimeSeconds +
          this.config.run.promptDurationSeconds
    );
  }

  getCurrentClockSeconds() {
    return this.getStartClockSeconds() + this.elapsedClockSeconds;
  }

  getStartClockSeconds() {
    return (
      this.config.clock.startHours * 3600 +
      this.config.clock.startMinutes * 60 +
      this.config.clock.startSeconds
    );
  }

  getClassStartSeconds() {
    return (
      this.config.clock.classStartHours * 3600 +
      this.config.clock.classStartMinutes * 60 +
      this.config.clock.classStartSeconds
    );
  }

  getTimeUntilClassStartSeconds() {
    return this.getClassStartSeconds() - this.getCurrentClockSeconds();
  }

  getSnapshot() {
    const snapshot = this.snapshot;
    const currentClockSeconds = this.getCurrentClockSeconds();
    const classStartSeconds = this.getClassStartSeconds();
    const timeUntilClassStart = classStartSeconds - currentClockSeconds;

    snapshot.elapsedClockSeconds = this.elapsedClockSeconds;
    snapshot.runIntensity = this.runIntensity;
    snapshot.isRunning = this.isRunning;
    snapshot.inputActive = this.inputActive;
    snapshot.playbackSpeed = this.playbackSpeed;
    snapshot.targetPlaybackSpeed = this.targetPlaybackSpeed;
    snapshot.heartRate = this.heartRate;
    snapshot.distanceMeters = this.distanceMeters;
    snapshot.videoTime = this.videoTime;
    snapshot.videoDuration = this.videoDuration;
    snapshot.timeRemaining = this.timeRemaining;
    snapshot.currentClockSeconds = currentClockSeconds;
    snapshot.classStartSeconds = classStartSeconds;
    snapshot.timeUntilClassStart = timeUntilClassStart;
    snapshot.classStarted = timeUntilClassStart <= 0;
    snapshot.runUnlocked = this.runUnlocked;
    snapshot.classroomHallway.hasEntered = this.hasEnteredClassroomHallway;
    snapshot.classroomHallway.progress = this.classroomHallwayProgress;
    snapshot.quietCorridor.active = this.quietCorridorActive;
    snapshot.quietCorridor.blocksRunning = this.shouldBlockRunning();
    snapshot.overload.active = this.isOverloaded();
    snapshot.overload.recoveryThresholdBpm =
      this.config.heart.overloadRecoveryThresholdBpm;
    snapshot.overload.elapsedSeconds = this.overloadElapsedSeconds;
    Object.assign(snapshot.somaticEffect, this.somaticEffect);
    snapshot.endingEffect.active = this.endingEffect.active;
    snapshot.endingEffect.progress = this.endingEffect.progress;
    snapshot.endingEffect.blurPx = this.endingEffect.blurPx;
    snapshot.outcome = this.outcome;
    snapshot.message = this.message;

    return snapshot;
  }
}
