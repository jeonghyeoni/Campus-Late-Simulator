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
    this.displayedMessage = "";
    this.messageClearTimer = null;

    this.classStartValue.textContent = this.formatTime(
      config.clock.classStartHours,
      config.clock.classStartMinutes,
      config.clock.classStartSeconds
    );
  }

  render(snapshot) {
    this.clockValue.textContent = this.formatClock(snapshot.elapsedClockSeconds);
    this.heartValue.textContent = Math.round(snapshot.heartRate).toString();
    this.paceValue.textContent = this.formatPace(snapshot);
    this.speedValue.textContent = `${snapshot.playbackSpeed.toFixed(2)}x`;
    this.distanceValue.textContent = Math.ceil(snapshot.distanceMeters).toString();

    const distanceProgress =
      1 - snapshot.distanceMeters / this.config.distance.startMeters;
    this.distanceFill.style.transform = `scaleX(${distanceProgress})`;
    this.vignetteOverlay.dataset.active = snapshot.overload.active
      ? "true"
      : "false";
    this.renderMessage(snapshot);
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
      this.messageOverlay.textContent = this.displayedMessage;
      this.messageOverlay.dataset.visible = "true";
    } else {
      this.messageOverlay.dataset.visible = "false";

      if (this.displayedMessage && !this.messageClearTimer) {
        this.messageClearTimer = window.setTimeout(() => {
          this.displayedMessage = "";
          this.messageOverlay.textContent = "";
          this.messageClearTimer = null;
        }, this.config.message.fadeMs);
      }
    }

    this.messageOverlay.dataset.tone = snapshot.outcome ?? "notice";
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
