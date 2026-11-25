let ctx: AudioContext | null = null;
let unlocked = false;
let last = 0;

export function unlockSound() {
  unlocked = true;
  const AudioCtor = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ctx && AudioCtor) ctx = new AudioCtor();
  void ctx?.resume();
}

function tone(freq: number, at: number, dur: number, type: OscillatorType) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function chime(kind: "success" | "error" | "raise" | "reply" | "status") {
  if (!unlocked || !ctx) return;
  if (Date.now() - last < 80) return;
  last = Date.now();
  void ctx.resume();
  const now = ctx.currentTime;
  if (kind === "success") {
    tone(660, now, 0.08, "sine");
    tone(880, now + 0.09, 0.12, "sine");
  }
  if (kind === "error") tone(196, now, 0.16, "triangle");
  if (kind === "raise") tone(880, now, 0.12, "sine");
  if (kind === "reply") {
    tone(660, now, 0.09, "sine");
    tone(520, now + 0.1, 0.11, "sine");
  }
  if (kind === "status") tone(440, now, 0.1, "triangle");
}
