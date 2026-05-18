export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

export function expSmoothingFactor(speed, deltaSeconds) {
  return 1 - Math.exp(-speed * deltaSeconds);
}

export function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180);
}
