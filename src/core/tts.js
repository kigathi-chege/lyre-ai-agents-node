import { getOpenAIClient } from "./openai.js";

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const DEFAULT_VOICE = "alloy";
const DEFAULT_FORMAT = "mp3";
const DEFAULT_TTS_INSTRUCTIONS =
  "Read in a professional tone. Sound human and natural. Respect punctuation, phrasing, and natural sentence breaks as if you understand the content.";

const MIME_BY_FORMAT = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/opus",
  flac: "audio/flac",
  pcm: "audio/pcm",
};

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveMimeType(format) {
  return MIME_BY_FORMAT[String(format || "").toLowerCase()] || "application/octet-stream";
}

async function resolveToFile() {
  try {
    const mod = await import("openai");
    if (typeof mod.toFile === "function") return mod.toFile;
    if (typeof mod.default?.toFile === "function") return mod.default.toFile;
  } catch {
    // Fall through to uploads import.
  }

  const uploads = await import("openai/uploads");
  if (typeof uploads.toFile === "function") return uploads.toFile;

  throw new Error("Failed to load `toFile` helper from `openai` package.");
}

export async function speak(client, params = {}) {
  if (client.config.mode !== "direct") {
    throw new Error("`tts.speak` is only available in direct mode with an OpenAI API key.");
  }

  const text = String(params.text || "").trim();
  if (!text) {
    throw new Error("`tts.speak` requires a non-empty `text` string.");
  }

  const model = params.model || DEFAULT_TTS_MODEL;
  const voice = params.voice || DEFAULT_VOICE;
  const format = params.format || DEFAULT_FORMAT;
  const includeWordTimings = params.includeWordTimings !== false;
  const transcriptionModel = params.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL;

  const openai = await getOpenAIClient(client);

  let speech;
  try {
    speech = await openai.audio.speech.create({
      model,
      voice,
      input: text,
      format,
      speed: params.speed,
      instructions: params.instructions || DEFAULT_TTS_INSTRUCTIONS,
    });
  } catch (error) {
    throw new Error(`TtsGenerationError: ${error?.message || "failed to generate speech"}`);
  }

  const audioArrayBuffer = await speech.arrayBuffer();
  const audioBuffer = Buffer.from(audioArrayBuffer);
  const audioBase64 = audioBuffer.toString("base64");
  const mimeType = resolveMimeType(format);

  if (!includeWordTimings) {
    return {
      text,
      audio_base64: audioBase64,
      mime_type: mimeType,
      duration_seconds: null,
      words: [],
      provider_meta: {
        speech_model: model,
        voice,
        format,
      },
    };
  }

  let transcription;
  try {
    const toFile = await resolveToFile();
    const file = await toFile(audioBuffer, `speech.${format}`);

    transcription = await openai.audio.transcriptions.create({
      file,
      model: transcriptionModel,
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });
  } catch (error) {
    throw new Error(`TtsTimingError: ${error?.message || "failed to generate word timings"}`);
  }

  const words = (Array.isArray(transcription?.words) ? transcription.words : [])
    .map((word, index) => ({
      index,
      word: String(word?.word || "").trim(),
      start: toFiniteNumber(word?.start, 0),
      end: toFiniteNumber(word?.end, 0),
    }))
    .filter((word) => word.word.length > 0 && word.end >= word.start);

  return {
    text,
    audio_base64: audioBase64,
    mime_type: mimeType,
    duration_seconds: words.length ? words[words.length - 1].end : null,
    words,
    provider_meta: {
      speech_model: model,
      transcription_model: transcriptionModel,
      voice,
      format,
      transcription_usage: transcription?.usage || null,
    },
  };
}
