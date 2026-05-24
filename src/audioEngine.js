import { createDevice } from "@rnbo/js";

export class AudioEngine {
  constructor(config) {
    this.config = config;
    this.audioContext = null;
    this.device = null;
    this.startPromise = null;
    this.ready = false;
    this.parameterCache = new Map();
    this.missingParameters = new Set();
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
    this.device = await createDevice({
      context: this.audioContext,
      patcher
    });

    this.device.node.connect(this.audioContext.destination);
    this.ready = true;
    this.setParameter("heartVol", this.config.defaultHeartVolume ?? 1);

    return true;
  }

  updateFromSnapshot(snapshot) {
    if (!this.ready || !snapshot) {
      return;
    }

    this.setParameter("heartRate", snapshot.heartRate);
    this.setParameter("runIntensity", snapshot.runIntensity);
    this.setParameter("playbackSpeed", snapshot.playbackSpeed);
    this.setParameter("overloadActive", snapshot.overload?.active ? 1 : 0);
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
