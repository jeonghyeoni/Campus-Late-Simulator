import { clamp, expSmoothingFactor, lerp } from "./utils.js";

export class SimulationState {
  constructor(config, inputSource) {
    this.config = config;
    this.inputSource = inputSource;
    this.reset();
  }

  reset() {
    this.elapsedClockSeconds = 0;
    this.runIntensity = 0;
    this.inputActive = false;
    this.isRunning = false;
    this.playbackSpeed = this.config.run.idleSpeed;
    this.targetPlaybackSpeed = this.config.run.idleSpeed;
    this.heartRate = this.config.heart.baseBpm;
    this.heartSampleAccumulator = 0;
    this.distanceMeters = this.config.distance.startMeters;
    this.videoTime = 0;
    this.runUnlocked = false;
    this.quietCorridorActive = false;
    this.previousQuietCorridorActive = false;
    this.quietCorridorExitMessageSeconds = 0;
    this.overloadActive = false;
    this.overloadElapsedSeconds = 0;
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
      this.playbackSpeed = this.targetPlaybackSpeed;
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

    if (this.isOverloaded()) {
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

    this.heartRate = Math.round(
      clamp(this.heartRate, heart.baseBpm, heart.maxBpm)
    );

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

  getCurrentMaxRunSpeed() {
    const isTouchInput = this.inputSource.prefersTouch?.() ?? false;
    const maxSpeed = isTouchInput
      ? this.config.run.mobileMaxSpeed
      : this.config.run.maxSpeed;
    const elevatedLimit = isTouchInput
      ? this.config.run.mobileElevatedHeartRateSpeedLimit
      : this.config.run.elevatedHeartRateSpeedLimit;

    if (this.heartRate > this.config.run.elevatedHeartRateThresholdBpm) {
      return elevatedLimit;
    }

    return maxSpeed;
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
      this.message =
        this.inputSource.getRunPromptMessage?.() ?? "hold space to run";
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

  getSnapshot() {
    return {
      elapsedClockSeconds: this.elapsedClockSeconds,
      runIntensity: this.runIntensity,
      isRunning: this.isRunning,
      inputActive: this.inputActive,
      playbackSpeed: this.playbackSpeed,
      targetPlaybackSpeed: this.targetPlaybackSpeed,
      heartRate: this.heartRate,
      distanceMeters: this.distanceMeters,
      videoTime: this.videoTime,
      runUnlocked: this.runUnlocked,
      quietCorridor: {
        active: this.quietCorridorActive,
        blocksRunning: this.shouldBlockRunning()
      },
      overload: {
        active: this.isOverloaded(),
        recoveryThresholdBpm: this.config.heart.overloadRecoveryThresholdBpm,
        elapsedSeconds: this.overloadElapsedSeconds
      },
      endingEffect: this.endingEffect,
      outcome: this.outcome,
      message: this.message
    };
  }
}
