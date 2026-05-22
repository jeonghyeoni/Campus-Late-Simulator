export const CONFIG = {
  viewMode: "flat",
  video: {
    src: "https://pub-2d2d0dec4ce24f1cb3dce6e41e9a12a7.r2.dev/campuslatesimulatorsource.mp4",
    mobileSrc: "https://pub-2d2d0dec4ce24f1cb3dce6e41e9a12a7.r2.dev/campuslatesimulatorsource_mobile2.mp4",
    crossOrigin: null
  },
  flatView: {
    scale: 1.1,
    maxTranslateXPercent: 4,
    maxTranslateYPercent: 2.5,
    controlAreaRatio: 0.5,
    smoothing: 9
  },
  run: {
    idleSpeed: 1,
    maxSpeed: 2.3,
    elevatedHeartRateSpeedLimit: 2,
    elevatedHeartRateThresholdBpm: 150,
    mobileMaxSpeed: 1.45,
    mobileElevatedHeartRateSpeedLimit: 1.3,
    overloadSpeed: 0.4,
    playbackSmoothing: 4,
    unlockVideoTimeSeconds: 16,
    promptDurationSeconds: 4,
    intensityRisePerSecond: 1.35,
    intensityFallPerSecond: 0.9,
    runningThreshold: 0.08
  },
  heart: {
    baseBpm: 80,
    maxBpm: 176,
    overloadThresholdBpm: 175,
    overloadRecoveryThresholdBpm: 140,
    sampleIntervalSeconds: 1,
    activeRiseBpmPerSample: 3,
    recoveryBpmPerSample: 2,
    overloadRecoveryBpmPerSample: 3,
    activeJitterBpm: 2,
    recoveryJitterBpm: 1
  },
  overload: {
    scale: 1.22,
    swayPercent: 2.1,
    swayHz: 0.5,
    blurPx: 4
  },
  ending: {
    durationSeconds: 0.35,
    slowSpeed: 0.35,
    maxBlurPx: 8,
    completionThresholdSeconds: 0.02
  },
  message: {
    fadeMs: 650
  },
  clock: {
    startHours: 10,
    startMinutes: 26,
    startSeconds: 48,
    classStartHours: 10,
    classStartMinutes: 30,
    classStartSeconds: 0
  },
  distance: {
    startMeters: 230,
    walkMetersPerSecond: 1.15,
    runMetersPerSecond: 3.25
  }
};
