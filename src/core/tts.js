import { getOpenAIClient } from "./openai.js";

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
const DEFAULT_TIMING_FALLBACK_MODEL = "whisper-1";
const DEFAULT_VOICE = "alloy";
const DEFAULT_FORMAT = "mp3";
const DEFAULT_CHUNKING = "auto";
const DEFAULT_MAX_CHUNK_CHARS = 1600;
const DEFAULT_MAX_TOTAL_CHARS = 120000;
const DEFAULT_TTS_INSTRUCTIONS =
  "Read in a professional tone. Sound human and natural. Respect punctuation, phrasing, and natural sentence breaks as if you understand the content.";

const MIME_BY_FORMAT = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  pcm: "audio/pcm",
};

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

function concatUint8Arrays(parts) {
  const arrays = parts.map((part) => toUint8Array(part));
  const total = arrays.reduce((sum, arr) => sum + arr.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.byteLength;
  }
  return out;
}

function uint8ArrayToBase64(bytes) {
  if (
    typeof Buffer !== "undefined" &&
    typeof Buffer.from === "function"
  ) {
    return Buffer.from(bytes).toString("base64");
  }

  if (typeof btoa === "function") {
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
  }

  throw new Error("TtsRuntimeError: no base64 encoder available in this runtime.");
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveMimeType(format) {
  return MIME_BY_FORMAT[String(format || "").toLowerCase()] || "application/octet-stream";
}

function resolveMimeTypeFromResponse(response, fallbackFormat) {
  const raw = String(response?.headers?.get?.("content-type") || "").trim();
  if (!raw) return resolveMimeType(fallbackFormat);
  return raw.split(";")[0]?.trim() || resolveMimeType(fallbackFormat);
}

function normalizeModelName(value) {
  return String(value || "").trim().toLowerCase();
}

function supportsWordTiming(model) {
  return normalizeModelName(model) === "whisper-1";
}

function buildTranscriptionParams({ file, model }) {
  return {
    file,
    model,
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  };
}

function buildUnavailableTimingMeta({
  speechModel,
  transcriptionModel,
  fallbackModel,
  voice,
  format,
  reason,
}) {
  return {
    speech_model: speechModel,
    transcription_model_requested: transcriptionModel,
    transcription_model: null,
    timing_fallback_model: fallbackModel,
    timing_status: "unavailable",
    timing_error: reason || null,
    voice,
    format,
    transcription_usage: null,
  };
}

function splitIntoSentences(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function chunkTextBySentence(text, maxChunkChars) {
  const sentences = splitIntoSentences(text);
  if (!sentences.length) return [];

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChunkChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      let offset = 0;
      while (offset < sentence.length) {
        const next = sentence.slice(offset, offset + maxChunkChars).trim();
        if (next) chunks.push(next);
        offset += maxChunkChars;
      }
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChunkChars) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    current = sentence;
  }

  if (current) chunks.push(current);
  return chunks;
}

async function synthesizeSpeechBuffer({
  openai,
  text,
  model,
  voice,
  format,
  speed,
  instructions,
}) {
  const speech = await openai.audio.speech.create({
    model,
    voice,
    input: text,
    response_format: format,
    speed,
    instructions,
  });
  const audioArrayBuffer = await speech.arrayBuffer();
  return {
    buffer: new Uint8Array(audioArrayBuffer),
    mimeType: resolveMimeTypeFromResponse(speech, format),
  };
}


async function transcribeWithTimings({
  openai,
  toFile,
  audioBuffer,
  format,
  timingAttempts,
}) {
  let transcription = null;
  let resolvedTimingStatus = "unavailable";
  let resolvedTranscriptionModel = null;
  let lastTimingError = null;

  for (const attempt of timingAttempts) {
    try {
      const file = await toFile(audioBuffer, `speech.${format}`);
      transcription = await openai.audio.transcriptions.create(
        buildTranscriptionParams({
          file,
          model: attempt.model,
        }),
      );
      resolvedTimingStatus = attempt.timing_status;
      resolvedTranscriptionModel = attempt.model;
      lastTimingError = null;
      break;
    } catch (error) {
      lastTimingError = error;
    }
  }

  return {
    transcription,
    resolvedTimingStatus,
    resolvedTranscriptionModel,
    lastTimingError,
  };
}

function mapTranscriptionWords(transcription, offsetSeconds = 0) {
  const safeOffset = Number(offsetSeconds) || 0;
  return (Array.isArray(transcription?.words) ? transcription.words : [])
    .map((word, index) => ({
      index,
      word: String(word?.word || "").trim(),
      start: toFiniteNumber(word?.start, 0) + safeOffset,
      end: toFiniteNumber(word?.end, 0) + safeOffset,
    }))
    .filter((word) => word.word.length > 0 && word.end >= word.start);
}

function buildTimingAttempts(transcriptionModel, timingFallbackModel) {
  const attempts = [];
  if (supportsWordTiming(transcriptionModel)) {
    attempts.push({
      model: transcriptionModel,
      timing_status: "direct",
    });
  }
  if (
    supportsWordTiming(timingFallbackModel) &&
    timingFallbackModel !== transcriptionModel
  ) {
    attempts.push({
      model: timingFallbackModel,
      timing_status: "fallback",
    });
  }
  return attempts;
}


async function resolveToFile() {
  if (toFilePromise) {
    return toFilePromise;
  }

  toFilePromise = (async () => {
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
  })();

  try {
    return await toFilePromise;
  } catch (error) {
    toFilePromise = null;
    throw error;
  }
}
let toFilePromise = null;

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
  const format = params.response_format || params.format || DEFAULT_FORMAT;
  const chunking = params.chunking || DEFAULT_CHUNKING;
  const maxChunkChars = Number(params.maxChunkChars) || DEFAULT_MAX_CHUNK_CHARS;
  const maxTotalChars = Number(params.maxTotalChars) || DEFAULT_MAX_TOTAL_CHARS;
  const includeWordTimings = params.includeWordTimings !== false;
  const transcriptionModel = params.transcriptionModel || DEFAULT_TRANSCRIPTION_MODEL;
  const timingFallbackModel = params.timingFallbackModel || DEFAULT_TIMING_FALLBACK_MODEL;
  const resolvedInstructions = params.instructions || DEFAULT_TTS_INSTRUCTIONS;

  if (text.length > maxTotalChars) {
    throw new Error(
      `TtsInputTooLargeError: input text length (${text.length}) exceeds maxTotalChars (${maxTotalChars}).`,
    );
  }

  const openai = await getOpenAIClient(client);
  const shouldChunk = chunking === "auto" && text.length > maxChunkChars;
  const chunks = shouldChunk ? chunkTextBySentence(text, maxChunkChars) : [text];

  if (format !== "mp3" && chunks.length > 1) {
    throw new Error(
      `TtsChunkingFormatError: chunking currently supports only mp3 output (received: ${format}).`,
    );
  }

  const audioBuffers = [];
  let responseMimeType = "";
  try {
    for (const chunkText of chunks) {
      const chunkResult = await synthesizeSpeechBuffer({
        openai,
        text: chunkText,
        model,
        voice,
        format,
        speed: params.speed,
        instructions: resolvedInstructions,
      });
      audioBuffers.push(chunkResult.buffer);
      if (!responseMimeType && chunkResult.mimeType) {
        responseMimeType = chunkResult.mimeType;
      }
    }
  } catch (error) {
    throw new Error(`TtsGenerationError: ${error?.message || "failed to generate speech"}`);
  }

  const audioBytes = concatUint8Arrays(audioBuffers);
  const audioBase64 = uint8ArrayToBase64(audioBytes);
  const mimeType = responseMimeType || resolveMimeType(format);

  if (!includeWordTimings) {
    return {
      text,
      audio_base64: audioBase64,
      mime_type: mimeType,
      duration_seconds: null,
      words: [],
      provider_meta: {
        speech_model: model,
        transcription_model_requested: transcriptionModel,
        transcription_model: null,
        timing_fallback_model: timingFallbackModel,
        timing_status: "disabled",
        timing_error: null,
        chunking,
        chunk_count: chunks.length,
        voice,
        format,
        transcription_usage: null,
      },
    };
  }

  const timingAttempts = buildTimingAttempts(
    transcriptionModel,
    timingFallbackModel,
  );

  if (!timingAttempts.length) {
    return {
      text,
      audio_base64: audioBase64,
      mime_type: mimeType,
      duration_seconds: null,
      words: [],
      provider_meta: buildUnavailableTimingMeta({
        speechModel: model,
        transcriptionModel,
        fallbackModel: timingFallbackModel,
        voice,
        format,
        reason:
          "No word-timing-compatible transcription model configured. Use `whisper-1` for timestamped words.",
      }),
    };
  }

  const toFile = await resolveToFile();
  let words = [];
  let timingError = null;
  let resolvedTimingStatus = "unavailable";
  let resolvedTranscriptionModel = null;
  let transcriptionUsage = null;
  let cumulativeOffset = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkAudioBuffer = audioBuffers[i];
    const timingResult = await transcribeWithTimings({
      openai,
      toFile,
      audioBuffer: chunkAudioBuffer,
      format,
      timingAttempts,
    });

    if (!timingResult.transcription) {
      timingError = timingResult.lastTimingError;
      words = [];
      resolvedTimingStatus = "unavailable";
      resolvedTranscriptionModel = null;
      transcriptionUsage = null;
      break;
    }

    if (timingResult.resolvedTimingStatus === "direct") {
      resolvedTimingStatus = resolvedTimingStatus === "fallback" ? "fallback" : "direct";
    } else if (timingResult.resolvedTimingStatus === "fallback") {
      resolvedTimingStatus = "fallback";
    }

    resolvedTranscriptionModel = timingResult.resolvedTranscriptionModel;
    if (timingResult.transcription?.usage) {
      transcriptionUsage = timingResult.transcription.usage;
    }

    const chunkWords = mapTranscriptionWords(
      timingResult.transcription,
      cumulativeOffset,
    );
    words.push(...chunkWords);
    cumulativeOffset = chunkWords.length
      ? chunkWords[chunkWords.length - 1].end
      : cumulativeOffset;
  }

  if (!words.length && timingError) {
    return {
      text,
      audio_base64: audioBase64,
      mime_type: mimeType,
      duration_seconds: null,
      words: [],
      provider_meta: {
        ...buildUnavailableTimingMeta({
          speechModel: model,
          transcriptionModel,
          fallbackModel: timingFallbackModel,
          voice,
          format,
          reason:
            timingError?.message || "failed to generate word timings",
        }),
        chunking,
        chunk_count: chunks.length,
      },
    };
  }

  return {
    text,
    audio_base64: audioBase64,
    mime_type: mimeType,
    duration_seconds: words.length ? words[words.length - 1].end : null,
    words,
    provider_meta: {
      speech_model: model,
      transcription_model_requested: transcriptionModel,
      transcription_model: resolvedTranscriptionModel,
      timing_fallback_model: timingFallbackModel,
      timing_status: resolvedTimingStatus,
      timing_error: null,
      chunking,
      chunk_count: chunks.length,
      voice,
      format,
      transcription_usage: transcriptionUsage,
    },
  };
}
