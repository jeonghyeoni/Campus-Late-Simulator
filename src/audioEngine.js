import { createDevice, TransportEvent, TransportState } from "@rnbo/js";
import { clamp } from "./utils.js";

const PUNCH_TRIGGER_SECONDS = 74;
const PUNCH_TRIGGER_RESET_MS = 50;
const TRIGGER_RESET_MS = 50;
const HALLUCINATION_HEART_THRESHOLD_BPM = 100;

export class AudioEngine {
  constructor(config) {
    this.config = config;
    this.audioContext = null;
    this.device = null;
    this.startPromise = null;
    this.ready = false;
    this.parameterCache = new Map();
    this.missingParameters = new Set();
    this.patcher = null;
    this.lastSnapshotVideoTime = null;
    this.punchTriggered = false;
    this.professorParamsInitialized = false;
    this.realProfessorTriggered = false;
    this.classroomHallwayVolumeRaised = false;
    this.pendingBgmTrack = null;
    this.bgmTrackPromise = null;
  }

  async start() {
    if (!this.config?.enabled) {
      return false;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.initialize().catch((error) => {
      console.warn("RNBO audio engine failed to start.", error);
      this.ready = false;
      return false;
    });

    return this.startPromise;
  }

  async initialize() {
    const AudioContextConstructor =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextConstructor) {
      throw new Error("This browser does not support AudioContext.");
    }

    this.audioContext = this.audioContext ?? new AudioContextConstructor();

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    const response = await fetch(this.config.patchUrl);
    if (!response.ok) {
      throw new Error(
        `Unable to load RNBO patch: ${response.status} ${response.statusText}`
      );
    }

    const patcher = await response.json();
    this.patcher = patcher;
    this.logPatcherDataBuffers(patcher);

    this.device = await createDevice({
      context: this.audioContext,
      patcher
    });
    this.logDeviceDataBuffers();
    this.initializeProfessorParameters();

    this.device.node.connect(this.audioContext.destination);
    await this.loadDataBufferDependencies();
    if (this.pendingBgmTrack) {
      await this.applyBgmTrack(this.pendingBgmTrack);
    }
    this.startTransport();
    this.ready = true;

    return true;
  }

  startTransport() {
    if (!this.device?.scheduleEvent) {
      return;
    }

    this.device.scheduleEvent(
      new TransportEvent(
        this.audioContext.currentTime * 1000,
        TransportState.RUNNING
      )
    );
    console.info("RNBO transport started.");
  }

  async loadDataBufferDependencies() {
    const dependencies = await this.getDataBufferDependencies();
    this.logResolvedDependencies(dependencies);

    if (!dependencies.length) {
      return;
    }

    const failedDirectLoads = await this.loadDataBuffersDirectly(dependencies);
    if (!failedDirectLoads.length || !this.device?.loadDataBufferDependencies) {
      return;
    }

    try {
      const results = await this.device.loadDataBufferDependencies(
        failedDirectLoads.map((failure) => failure.dependency)
      );
      const failed = results.filter((result) => result.type === "fail");

      if (failed.length) {
        console.warn("Some RNBO media dependencies failed to load.", failed);
      }
    } catch (error) {
      console.warn("RNBO media dependencies could not be loaded.", error);
    }
  }

  async loadDataBuffersDirectly(dependencies) {
    const failed = [];

    await Promise.all(
      dependencies.map(async (dependency) => {
        try {
          await this.loadDataBuffer(dependency);
        } catch (error) {
          failed.push({ dependency, error });
          console.warn(
            `RNBO media dependency "${dependency.id}" could not be loaded directly.`,
            error
          );
        }
      })
    );

    return failed;
  }

  async loadDataBuffer(dependency) {
    if (!dependency.id || !dependency.file) {
      throw new Error("RNBO media dependency is missing an id or file path.");
    }

    console.info("RNBO media fetch URL:", {
      id: dependency.id,
      url: dependency.file
    });

    const response = await fetch(dependency.file);
    const contentType = response.headers.get("content-type");

    console.info("RNBO media fetch response:", {
      id: dependency.id,
      requestedUrl: dependency.file,
      responseUrl: response.url,
      status: response.status,
      contentType
    });

    if (!response.ok) {
      throw new Error(
        `Unable to load ${dependency.file}: ${response.status} ${response.statusText}`
      );
    }

    if (contentType?.includes("text/html")) {
      throw new Error(
        `RNBO media dependency "${dependency.id}" resolved to HTML instead of audio. ` +
          `Check that the final URL points to /rnbo/media/${dependency.id}.wav. ` +
          `Resolved URL: ${response.url}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const setResult = await this.device.setDataBuffer(
      dependency.id,
      audioBuffer
    );

    console.info(`RNBO setDataBuffer("${dependency.id}") completed.`, {
      file: dependency.file,
      result: setResult,
      channels: audioBuffer.numberOfChannels,
      duration: audioBuffer.duration,
      length: audioBuffer.length,
      sampleRate: audioBuffer.sampleRate
    });

    await this.verifyInjectedDataBuffer(dependency.id, audioBuffer);
  }

  async verifyInjectedDataBuffer(id, sourceAudioBuffer) {
    if (!this.config.debug?.verifyDataBufferAfterSet) {
      return;
    }

    if (!this.device?.releaseDataBuffer) {
      console.warn("RNBO device does not expose releaseDataBuffer().");
      return;
    }

    try {
      const releasedDataBuffer = await this.device.releaseDataBuffer(id);
      const internalAudioBuffer =
        releasedDataBuffer.getAsAudioBuffer(this.audioContext);

      console.info(`RNBO internal data buffer "${id}" verified.`, {
        channels: internalAudioBuffer.numberOfChannels,
        duration: internalAudioBuffer.duration,
        length: internalAudioBuffer.length,
        sampleRate: internalAudioBuffer.sampleRate
      });

      await this.device.setDataBuffer(id, sourceAudioBuffer);
      console.info(`RNBO internal data buffer "${id}" restored after verify.`);
    } catch (error) {
      console.warn(`RNBO internal data buffer "${id}" verification failed.`, {
        error
      });
    }
  }

  async getDataBufferDependencies() {
    const exportedDependencies = await this.fetchDependenciesJson();

    if (exportedDependencies.length) {
      return exportedDependencies.map((dependency) =>
        this.normalizeDependency(dependency)
      );
    }

    return (this.device.dataBufferDescriptions ?? []).map((dependency) =>
      this.normalizeDependency(dependency)
    );
  }

  logPatcherDataBuffers(patcher) {
    if (!this.config.debug?.dataBuffers) {
      return;
    }

    const externalDataRefs = patcher?.desc?.externalDataRefs ?? [];
    console.info("RNBO patcher externalDataRefs:", externalDataRefs);
  }

  logDeviceDataBuffers() {
    if (!this.config.debug?.dataBuffers) {
      return;
    }

    console.info("RNBO device dataBufferIds:", this.device?.dataBufferIds ?? []);
    console.info(
      "RNBO device dataBufferDescriptions:",
      this.device?.dataBufferDescriptions ?? []
    );
  }

  logResolvedDependencies(dependencies) {
    if (!this.config.debug?.dataBuffers) {
      return;
    }

    const deviceIds = new Set(this.device?.dataBufferIds ?? []);

    console.info("RNBO resolved media dependencies:", dependencies);

    dependencies.forEach((dependency) => {
      const matchesDeviceId = deviceIds.has(dependency.id);
      const message = {
        dependencyId: dependency.id,
        file: dependency.file,
        deviceDataBufferIds: [...deviceIds],
        matchesDeviceId
      };

      if (matchesDeviceId) {
        console.info("RNBO dependency id matches device data buffer id.", message);
      } else {
        console.warn(
          "RNBO dependency id does not match any device data buffer id.",
          message
        );
      }
    });
  }

  async fetchDependenciesJson() {
    if (!this.config.dependenciesUrl) {
      return [];
    }

    try {
      const response = await fetch(this.config.dependenciesUrl);
      if (!response.ok) {
        console.warn(
          `RNBO dependencies file was not loaded: ${response.status} ${response.statusText}`
        );
        return [];
      }

      const dependencies = await response.json();
      return Array.isArray(dependencies) ? dependencies : [];
    } catch (error) {
      console.warn("RNBO dependencies file could not be read.", error);
      return [];
    }
  }

  normalizeDependency(dependency) {
    const file = dependency.file ?? dependency.url;

    return {
      ...dependency,
      file: this.resolveDependencyUrl(file)
    };
  }

  resolveDependencyUrl(file) {
    if (!file) {
      return file;
    }

    const browserPath = file.replaceAll("\\", "/");

    if (/^(https?:)?\/\//.test(browserPath)) {
      return browserPath;
    }

    const normalizedPath = browserPath.replace(/^\/+/, "");
    const mediaPath = normalizedPath.startsWith("media/")
      ? normalizedPath
      : `media/${normalizedPath}`;
    const patchUrl = new URL(this.config.patchUrl, window.location.origin);
    const rnboDirectory = patchUrl.pathname
      .split("/")
      .slice(0, -1)
      .join("/");

    return `${rnboDirectory}/${mediaPath}`;
  }

  setBgmTrack(track) {
    if (!track?.file) {
      return Promise.resolve(false);
    }

    this.pendingBgmTrack = track;
    if (!this.device || !this.audioContext) {
      return Promise.resolve(false);
    }

    this.bgmTrackPromise = this.applyBgmTrack(track);
    return this.bgmTrackPromise;
  }

  async applyBgmTrack(track) {
    const dependency = this.normalizeDependency({
      id: "bgm",
      file: track.file
    });

    try {
      await this.loadDataBuffer(dependency);
      console.info("BGM track loaded.", {
        title: track.title ?? dependency.file,
        file: dependency.file
      });
      return true;
    } catch (error) {
      console.warn("BGM track could not be loaded.", {
        title: track.title ?? dependency.file,
        file: dependency.file,
        error
      });
      return false;
    }
  }

  updateFromSnapshot(snapshot) {
    if (!this.ready || !snapshot) {
      return;
    }

    this.setParameter("heartRate", snapshot.heartRate);
    this.setParameter("runIntensity", snapshot.runIntensity);
    this.setParameter("playbackSpeed", snapshot.playbackSpeed);
    this.setParameter("overloadActive", snapshot.overload?.active ? 1 : 0);
    this.updatePunchTrigger(snapshot);
    this.updateProfessorVoice(snapshot);
  }

  updatePunchTrigger(snapshot) {
    const videoTime = Number(snapshot.videoTime);
    if (!Number.isFinite(videoTime)) {
      return;
    }

    if (videoTime < PUNCH_TRIGGER_SECONDS - 0.5) {
      this.punchTriggered = false;
    }

    const crossedPunchTime =
      !this.punchTriggered &&
      videoTime >= PUNCH_TRIGGER_SECONDS &&
      (this.lastSnapshotVideoTime === null ||
        this.lastSnapshotVideoTime < PUNCH_TRIGGER_SECONDS);

    this.lastSnapshotVideoTime = videoTime;

    if (!crossedPunchTime) {
      return;
    }

    this.punchTriggered = true;
    this.setParameter("punchTrigger", 1);
    window.setTimeout(() => {
      this.setParameter("punchTrigger", 0);
    }, PUNCH_TRIGGER_RESET_MS);
  }

  updateProfessorVoice(snapshot) {
    this.initializeProfessorParameters();
    this.resetProfessorTriggersIfNeeded(snapshot);
    this.updateHallucinationProfessorVolume(snapshot);
    this.updateRealProfessorTrigger(snapshot);
    this.updateRealProfessorHallwayVolume(snapshot);
    this.updateRealProfessorNear(snapshot);
  }

  initializeProfessorParameters() {
    if (this.professorParamsInitialized) {
      return;
    }

    this.setHallucinationProfessorVolume(0);
    this.setParameter("realProfTrigger", 0);
    this.setParameter("realProfVol", 0);
    this.setParameter("realProfNear", 0);
    this.professorParamsInitialized = true;
  }

  resetProfessorTriggersIfNeeded(snapshot) {
    if (snapshot.classStarted === false) {
      this.realProfessorTriggered = false;
    }

    if (!snapshot.classroomHallway?.hasEntered) {
      if (this.classroomHallwayVolumeRaised) {
        this.setParameter("realProfVol", 0);
      }
      this.classroomHallwayVolumeRaised = false;
    }
  }

  updateHallucinationProfessorVolume(snapshot) {
    const classStarted = snapshot.classStarted === true;
    const heartRate = Number(snapshot.heartRate);
    const profVol =
      !classStarted &&
      Number.isFinite(heartRate) &&
      heartRate >= HALLUCINATION_HEART_THRESHOLD_BPM
        ? 1
        : 0;

    this.setHallucinationProfessorVolume(profVol);
  }

  setHallucinationProfessorVolume(value) {
    this.setParameter("profVol", value);
  }

  updateRealProfessorTrigger(snapshot) {
    if (snapshot.classStarted !== true || this.realProfessorTriggered) {
      return;
    }

    this.realProfessorTriggered = true;
    this.setHallucinationProfessorVolume(0);
    this.setParameter("realProfTrigger", 1);
    window.setTimeout(() => {
      this.setParameter("realProfTrigger", 0);
    }, TRIGGER_RESET_MS);
  }

  updateRealProfessorHallwayVolume(snapshot) {
    if (
      !snapshot.classroomHallway?.hasEntered ||
      this.classroomHallwayVolumeRaised
    ) {
      return;
    }

    this.classroomHallwayVolumeRaised = true;
    this.setParameter("realProfVol", 0.5);
  }

  updateRealProfessorNear(snapshot) {
    const near = clamp(snapshot.classroomHallway?.progress ?? 0, 0, 1);
    this.setParameter("realProfNear", near);
  }

  setParameter(name, value) {
    const parameter = this.getParameter(name);
    if (!parameter || !Number.isFinite(value)) {
      return false;
    }

    try {
      parameter.value = value;
      return true;
    } catch (error) {
      console.warn(`Unable to set RNBO parameter "${name}".`, error);
      return false;
    }
  }

  getParameter(name) {
    if (!this.device?.parametersById) {
      return null;
    }

    if (this.parameterCache.has(name)) {
      return this.parameterCache.get(name);
    }

    const parameter =
      this.device.parametersById.get(name) ??
      [...this.device.parametersById.values()].find(
        (candidate) => candidate.id === name || candidate.name === name
      ) ??
      null;

    if (!parameter && !this.missingParameters.has(name)) {
      this.missingParameters.add(name);
      console.warn(`RNBO parameter "${name}" was not found; skipping it.`);
    }

    this.parameterCache.set(name, parameter);
    return parameter;
  }
}
