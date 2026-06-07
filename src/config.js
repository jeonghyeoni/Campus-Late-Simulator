const isLocalBridgeHost =
  ["localhost", "127.0.0.1", ""].includes(window.location.hostname) ||
  window.location.hostname.endsWith(".local");
const defaultBridgeWsUrl = isLocalBridgeHost
  ? "ws://127.0.0.1:8080"
  : "wss://159.223.46.64.sslip.io";

export const CONFIG = {
  viewMode: "flat",
  bridge: {
    wsUrl: import.meta.env.VITE_BRIDGE_WS_URL ?? defaultBridgeWsUrl,
    controllerBaseUrl:
      import.meta.env.VITE_CONTROLLER_BASE_URL ?? window.location.origin,
    motionSendHz: 30,
    reconnectIntervalMs: 2000,
    statusHoldMs: 900,
    keyboardFallback: true
  },
  sensorInput: {
    deadzone: 0.08,
    fullScale: 1.4,
    jerkDeadzone: 0.04,
    jerkFullScale: 0.65,
    baselineSmoothing: 0.03,
    intensityRiseSmoothing: 12,
    intensityFallSmoothing: 56,
    staleAfterMs: 220,
    runningThreshold: 0.08
  },
  motionSensorInput: {
    deadzone: 0.9,
    fullScale: 6,
    jerkDeadzone: 1.05,
    jerkFullScale: 5,
    baselineSmoothing: 0.02,
    intensityRiseSmoothing: 10,
    intensityFallSmoothing: 56,
    staleAfterMs: 120,
    runningThreshold: 0.18
  },
  video: {
    src: "https://pub-2d2d0dec4ce24f1cb3dce6e41e9a12a7.r2.dev/campuslatesimulatorsource_mobile.mp4",
    sources: [
      {
        id: "4k",
        label: "4K",
        src: "https://pub-2d2d0dec4ce24f1cb3dce6e41e9a12a7.r2.dev/campuslatesimulatorsource.mp4"
      },
      {
        id: "1080p",
        label: "1080p",
        src: "https://pub-2d2d0dec4ce24f1cb3dce6e41e9a12a7.r2.dev/campuslatesimulatorsource_mobile.mp4"
      },
      {
        id: "720p",
        label: "720p",
        src: "https://pub-2d2d0dec4ce24f1cb3dce6e41e9a12a7.r2.dev/campuslatesimulatorsource_mobile2.mp4"
      }
    ],
    crossOrigin: null,
    muted: false,
    playbackRateUpdateHz: 20,
    playbackRateMinDelta: 0.015,
    stallRecovery: {
      enabled: true,
      stalledAfterMs: 900,
      cooldownMs: 1200,
      minProgressSeconds: 0.025,
      seekNudgeSeconds: 0.045
    }
  },
  audio: {
    enabled: true,
    patchUrl: "/rnbo/CampusLateAudioEngine.export.json",
    dependenciesUrl: "/rnbo/dependencies.json",
    bgmTracks: [
      {
        title: "Monume House",
        file: "media\\bgm\\monume-house-509469.mp3"
      },
      {
        title: "Iron Velocity",
        file: "media\\bgm\\mroneilovealot-iron-velocity-industrial-techno-518642.mp3"
      },
      {
        title: "Arcade Rave",
        file: "media\\bgm\\music_zapsplat_game_music_action_fast_euro_house_pumping_fun_arcade_rave_024.mp3"
      },
      {
        title: "Funky Electro Disco",
        file: "media\\bgm\\music_zapsplat_game_music_action_fun_funky_electro_disco_023.mp3"
      },
      {
        title: "House Drum Loop",
        file: "media\\bgm\\musical_compressed_house_or_trance_drum_loop.mp3"
      },
      {
        title: "Subway Surfers Main Theme",
        file: "media\\bgm\\Subway Surfers Main Theme Music [OFFICIAL] - Marco Masri.mp3"
      },
      {
        title: "Eurodance Hyperpop",
        file: "media\\bgm\\van_wiese-eurodance-hyperpop-type-beat-132-bpm-prod-wizz-10864.mp3"
      },
      {
        title: "Eurodance Hyperpop Alt",
        file: "media\\bgm\\van_wiese-eurodance-hyperpop-type-beat-132-bpm-prod-wizz-10864 (1).mp3"
      },
      {
        title: "The Maximum Value",
        file: "media\\bgm\\yoshiyuki_tatsuya-the-maximum-value-448307.mp3"
      }
    ],
    debug: {
      dataBuffers: true,
      verifyDataBufferAfterSet: true
    }
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
    mobileMaxSpeed: 2.3,
    overloadSpeed: 0.4,
    playbackSmoothing: 4,
    sensorPlaybackRiseSmoothing: 8,
    sensorPlaybackFallSmoothing: 56,
    sensorPlaybackSampleHz: 20,
    unlockVideoTimeSeconds: 16,
    promptDurationSeconds: 4,
    intensityRisePerSecond: 1.35,
    intensityFallPerSecond: 0.9,
    runningThreshold: 0.08
  },
  quietCorridor: {
    startSeconds: 240,
    endSeconds: 273,
    blockedMessage: "quiet in the corridor.",
    exitMessage: "you can run now.",
    exitMessageDurationSeconds: 3
  },
  classroomHallway: {
    entrySeconds: 321
  },
  heart: {
    baseBpm: 80,
    idleMinBpm: 75,
    idleMaxBpm: 80,
    idleDriftBpmPerSample: 2,
    maxBpm: 176,
    overloadThresholdBpm: 160,
    overloadRecoveryThresholdBpm: 140,
    sampleIntervalSeconds: 1,
    activeSampleIntervalSeconds: 1.5,
    activeRiseBpmPerSample: 1.3,
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
