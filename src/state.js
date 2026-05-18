import { clamp, expSmoothingFactor, lerp } from "./utils.js";

export class SimulationState {
  constructor(config, inputSource) {
    this.config = config;
    this.inputSource = inputSource;
    this.elapsedClockSeconds = 0;
    this.runIntensity = 0;
    this.inputActive = false;
    this.isRunning = false;
    this.playbackSpeed = config.run.idleSpeed;
    this.targetPlaybackSpeed = config.run.idleSpeed;
    this.heartRate = config.heart.baseBpm;
    this.heartSampleAccumulator = 0;
    this.distanceMeters = config.distance.startMeters;
    this.videoTime = 0;
    this.runUnlocked = false;
    this.overloadActive = false;
    this.overloadElapsedSeconds = 0;
    this.endingEffect = {
      active: false,
      progress: 0,
      blurPx: 0
    };
    this.message = "";
    this.outcome = null;
  }

  update(deltaSeconds, video) {
    this.inputSource.update(deltaSeconds);
    this.videoTime = video?.currentTime ?? 0;
    this.runUnlocked = this.isRunUnlocked(video);
    const rawInputActive =
      this.inputSource.isActive?.() ?? this.inputSource.getRunIntensity() > 0.01;
    this.inputActive = rawInputActive && this.runUnlocked;
    this.updateOverloadElapsed(deltaSeconds);

    const requestedRunIntensity = this.runUnlocked
      ? this.inputSource.getRunIntensity()
      : 0;
    this.runIntensity = this.isOverloaded() ? 0 : requestedRunIntensity;
    this.isRunning = this.runIntensity > this.config.run.runningThreshold;

    this.updateHeartRate(deltaSeconds);
    this.updateDistanceFromVideo(video);
    this.updateEndingEffect(video);
    this.updatePlaybackSpeed(deltaSeconds);
    this.elapsedClockSeconds += deltaSeconds;
    this.updateOutcome(video);
    this.updateMessage(rawInputActive);
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
    } else {
      this.targetPlaybackSpeed =
      this.config.run.idleSpeed +
      (this.getCurrentMaxRunSpeed() - this.config.run.idleSpeed) *
        this.runIntensity;
    }

    const amount = expSmoothingFactor(
      this.config.run.playbackSmoothing,
      deltaSeconds
    );
    this.playbackSpeed = lerp(
      this.playbackSpeed,
      this.targetPlaybackSpeed,
      amount
    );
  }

  updateHeartRate(deltaSeconds) {
    this.heartSampleAccumulator += deltaSeconds;

    while (
      this.heartSampleAccumulator >= this.config.heart.sampleIntervalSeconds
    ) {
      this.heartSampleAccumulator -= this.config.heart.sampleIntervalSeconds;
      this.sampleHeartRate();
    }
  }

  sampleHeartRate() {
    const heart = this.config.heart;

    if (this.isOverloaded()) {
      const recovery =
        heart.overloadRecoveryBpmPerSample +
        this.randomSigned(heart.recoveryJitterBpm);
      this.heartRate -= Math.max(2, recovery);
    } else if (this.inputActive) {
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
    if (this.heartRate > this.config.run.elevatedHeartRateThresholdBpm) {
      return this.config.run.elevatedHeartRateSpeedLimit;
    }

    return this.config.run.maxSpeed;
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

    const arrived = this.distanceMeters <= 0.5 || video.ended;
    const late = this.getCurrentClockSeconds() >= this.getClassStartSeconds();

    if (arrived) {
      this.outcome = late ? "failure" : "success";
    }
  }

  updateMessage(rawInputActive) {
    if (this.outcome === "success") {
      this.message = "You made it before class.";
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

    if (this.shouldShowRunPrompt()) {
      this.message = "hold space to run";
      return;
    }

    this.message = "";
  }

  isOverloaded() {
    return this.overloadActive;
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
