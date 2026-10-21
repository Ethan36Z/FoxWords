// Word pronunciation using the browser's built-in speech synthesis.
// Works offline in modern browsers; no API key or audio files needed.

const PREFERRED_VOICES = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Alex"];

let cachedVoice = null;

function pickVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en-us"));
  cachedVoice =
    PREFERRED_VOICES.map((name) => english.find((v) => v.name.includes(name))).find(Boolean) ||
    english.find((v) => v.localService) ||
    english[0] ||
    null;
  return cachedVoice;
}

export const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;

if (canSpeak) {
  // Voices load asynchronously in Chrome; reset so the next call picks again
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    cachedVoice = null;
  });
}

export function speak(text, { rate = 0.9 } = {}) {
  if (!canSpeak || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = rate;
  const voice = pickVoice();
  if (voice) u.voice = voice;
  synth.speak(u);
}
