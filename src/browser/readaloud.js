const BLOCKED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "BUTTON",
  "AUDIO",
  "VIDEO",
]);
const BLOCK_PAUSE_TAGS = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "SECTION",
  "UL",
]);

const DEFAULT_TTS_INSTRUCTIONS = `Read in a composed, executive presentation style.

- Moderate pace, slightly slower than conversational speech
- Clear articulation of each sentence
- Subtle emphasis on key phrases
- Confident but not dramatic tone

Structure handling:
- Short pause at commas
- Medium pause at sentence endings
- Longer pause between paragraphs
- Treat headings as distinct segments with emphasis

Avoid:
- robotic monotone delivery
- overly expressive or theatrical tone
- rushing through complex sentences`;

const DEFAULT_SPEECH_OPTIONS = {
  voiceName: "Samantha",
  lang: "en-US",
  rate: 0.96,
  pitch: 1.0,
  volume: 1.0,
};
const DEFAULT_HIGHLIGHT_OPTIONS = {
  mode: "span",
  color: "#fde68a",
  textColor: "inherit",
  radius: "0.5em",
  padding: "0.02em 0.22em",
};
const DEFAULT_AUTOSCROLL_OPTIONS = {
  enabled: false,
  behavior: "smooth",
  block: "center",
  marginRatio: 0.24,
  throttleMs: 96,
};
const DEFAULT_PROGRESSIVE_OPTIONS = {
  enabled: true,
  maxChunkChars: 1600,
  prefetchAhead: 1,
  retryCount: 0,
  retryDelayMs: 700,
};

export const READ_ALOUD_DEFAULTS = Object.freeze({
  instructions: DEFAULT_TTS_INSTRUCTIONS,
  speechOptions: Object.freeze({ ...DEFAULT_SPEECH_OPTIONS }),
  highlight: Object.freeze({ ...DEFAULT_HIGHLIGHT_OPTIONS }),
  autoScroll: Object.freeze({ ...DEFAULT_AUTOSCROLL_OPTIONS }),
  progressive: Object.freeze({ ...DEFAULT_PROGRESSIVE_OPTIONS }),
});

export function extractReadAloudText(content) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error(
      "ReadAloudError: `extractReadAloudText` must run in a browser environment.",
    );
  }

  const contentElement = resolveElement(content, "content");
  const { text } = buildReadableText(contentElement);
  return text.trim();
}

function resolveElement(target, label) {
  if (typeof target === "string") {
    const element = document.querySelector(target);
    if (!element) {
      throw new Error(
        `ReadAloudError: could not find ${label} element for selector: ${target}`,
      );
    }
    return element;
  }

  if (target instanceof Element) {
    return target;
  }

  throw new Error(
    `ReadAloudError: invalid ${label} target. Use a selector string or DOM element.`,
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isReadableTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  if (!node.nodeValue || !node.nodeValue.trim()) return false;

  const parent = node.parentElement;
  if (!parent || BLOCKED_TAGS.has(parent.tagName)) return false;
  if (parent.closest("[aria-hidden='true']")) return false;

  return true;
}

function getBlockContainer(element) {
  let current = element || null;
  while (current) {
    if (BLOCK_PAUSE_TAGS.has(current.tagName)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function buildReadableText(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isReadableTextNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const segments = [];
  let text = "";

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue || "";
    const block = getBlockContainer(node.parentElement);

    if (segments.length) {
      const previous = segments[segments.length - 1];
      const previousBlock = previous.block;
      const lastChar = text[text.length - 1] || "";
      const firstChar = value[0] || "";
      const hasWhitespaceGap = /\s/.test(lastChar) || /\s/.test(firstChar);
      const isNewBlock = previousBlock && block && previousBlock !== block;

      if (isNewBlock) {
        text += "\n\n";
      } else if (!hasWhitespaceGap) {
        text += " ";
      }
    }

    const start = text.length;
    text += value;
    segments.push({ node, start, end: text.length, text: value, block });
  }

  return { text, segments };
}

function buildTextMap(container) {
  const { text, segments } = buildReadableText(container);

  const words = [];
  const regex = /\S+/g;
  let match;
  while ((match = regex.exec(text))) {
    words.push({
      index: words.length,
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return { text, segments, words };
}

function findPosition(segments, absoluteOffset, isEnd = false) {
  if (!segments.length) return null;

  if (absoluteOffset <= 0) {
    return { node: segments[0].node, offset: 0 };
  }

  for (const segment of segments) {
    const inSegment =
      absoluteOffset > segment.start && absoluteOffset < segment.end;
    const atSegmentStart = absoluteOffset === segment.start;
    const atSegmentEnd = absoluteOffset === segment.end;

    if (inSegment || atSegmentStart || (isEnd && atSegmentEnd)) {
      return {
        node: segment.node,
        offset: Math.max(
          0,
          Math.min(segment.text.length, absoluteOffset - segment.start),
        ),
      };
    }
  }

  const last = segments[segments.length - 1];
  return { node: last.node, offset: last.text.length };
}

function createRangeForWord(segments, word) {
  const startPos = findPosition(segments, word.start, false);
  const endPos = findPosition(segments, word.end, true);

  if (!startPos || !endPos) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  return range;
}

function normalizeWordToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function toTimingValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findAlignedMatch(textNorm, timedNorm, textIndex, timedIndex, lookahead = 8) {
  for (let distance = 1; distance <= lookahead; distance += 1) {
    for (let textOffset = 0; textOffset <= distance; textOffset += 1) {
      const timedOffset = distance - textOffset;
      const candidateTextIndex = textIndex + textOffset;
      const candidateTimedIndex = timedIndex + timedOffset;
      if (
        candidateTextIndex >= textNorm.length ||
        candidateTimedIndex >= timedNorm.length
      ) {
        continue;
      }

      const textToken = textNorm[candidateTextIndex];
      const timedToken = timedNorm[candidateTimedIndex];
      if (textToken && timedToken && textToken === timedToken) {
        return {
          textIndex: candidateTextIndex,
          timedIndex: candidateTimedIndex,
        };
      }
    }
  }

  return null;
}

function assignTiming(word, start, end) {
  const safeStart = Math.max(0, Number(start) || 0);
  const safeEnd = Math.max(safeStart, Number(end) || safeStart);
  word.start_time = safeStart;
  word.end_time = safeEnd;
}

function alignTimedWordsToText(textWords, timingWords) {
  const aligned = textWords.map((word) => ({
    ...word,
    start_time: null,
    end_time: null,
    timed_text: word.text,
  }));

  if (!aligned.length || !timingWords.length) {
    return aligned;
  }

  const textNorm = textWords.map((word) => normalizeWordToken(word.text));
  const timedNorm = timingWords.map((word) => normalizeWordToken(word.word));
  const matches = [];

  let textIndex = 0;
  let timedIndex = 0;

  while (textIndex < textNorm.length && timedIndex < timedNorm.length) {
    const currentText = textNorm[textIndex];
    const currentTimed = timedNorm[timedIndex];

    if (currentText && currentTimed && currentText === currentTimed) {
      matches.push({ textIndex, timedIndex });
      textIndex += 1;
      timedIndex += 1;
      continue;
    }

    const alignedMatch = findAlignedMatch(
      textNorm,
      timedNorm,
      textIndex,
      timedIndex,
      8,
    );
    if (!alignedMatch) {
      textIndex += 1;
      continue;
    }

    textIndex = alignedMatch.textIndex;
    timedIndex = alignedMatch.timedIndex;
  }

  for (const match of matches) {
    const timedWord = timingWords[match.timedIndex];
    const start = toTimingValue(timedWord?.start);
    const end = toTimingValue(timedWord?.end);
    if (start === null || end === null || end < start) continue;
    assignTiming(aligned[match.textIndex], start, end);
    aligned[match.textIndex].timed_text = String(timedWord?.word || "").trim();
  }

  return aligned;
}

function resolveActiveMappedWordIndex(words, currentTime, fromIndex = 0) {
  if (!words.length) return -1;

  const safeFromIndex = Math.max(0, Math.min(fromIndex, words.length - 1));
  const safeTime = Number(currentTime) || 0;

  function resolveTiming(word) {
    const start = toTimingValue(word?.start_time);
    const end = toTimingValue(word?.end_time);
    if (start === null || end === null || end < start) return null;
    return { start, end };
  }

  for (let i = safeFromIndex; i < words.length; i += 1) {
    const timing = resolveTiming(words[i]);
    if (!timing) continue;
    if (safeTime >= timing.start && safeTime < timing.end) {
      return i;
    }
    if (safeTime < timing.start) {
      return -1;
    }
  }

  for (let i = Math.min(safeFromIndex, words.length - 1); i >= 0; i -= 1) {
    const timing = resolveTiming(words[i]);
    if (!timing) continue;
    if (safeTime >= timing.start && safeTime < timing.end) {
      return i;
    }
    if (safeTime > timing.end) {
      return -1;
    }
  }

  return -1;
}

function normalizeMappedTimingsToAudioDuration(words, audioDurationSeconds) {
  // Strict mode: keep provider timings exactly as provided.
  void words;
  void audioDurationSeconds;
  return;
}

function hasUsableMappedTimings(words) {
  if (!Array.isArray(words) || !words.length) return false;
  return words.some((word) => {
    const start = toTimingValue(word?.start_time);
    const end = toTimingValue(word?.end_time);
    return start !== null && end !== null && end >= start;
  });
}

function buildAudioSource(mimeType, audioBase64) {
  return `data:${mimeType};base64,${audioBase64}`;
}

function assertHighlightSupport() {
  if (
    typeof CSS === "undefined" ||
    typeof CSS.highlights === "undefined" ||
    typeof Highlight === "undefined"
  ) {
    throw new Error(
      "ReadAloudError: CSS Custom Highlight API is not available in this browser.",
    );
  }
}

function assertSpeechSynthesisSupport() {
  if (
    typeof window === "undefined" ||
    typeof window.speechSynthesis === "undefined" ||
    typeof window.SpeechSynthesisUtterance === "undefined"
  ) {
    throw new Error(
      "ReadAloudError: browser speech synthesis is not available.",
    );
  }
}

function resolveWordIndexFromChar(words, charIndex, fromIndex = 0) {
  if (!words.length) return -1;
  const safeChar = Number(charIndex) || 0;

  const clampedFrom = Math.max(0, Math.min(fromIndex, words.length - 1));
  for (let i = clampedFrom; i < words.length; i += 1) {
    const word = words[i];
    if (safeChar >= word.start && safeChar < word.end) return i;
    if (safeChar < word.start) return i;
  }

  for (let i = Math.min(clampedFrom, words.length - 1); i >= 0; i -= 1) {
    const word = words[i];
    if (safeChar >= word.start && safeChar < word.end) return i;
    if (safeChar >= word.end) return i;
  }

  return -1;
}

function normalizeSpeechOptions(input = {}) {
  return {
    voiceName: isNonEmptyString(input.voiceName)
      ? input.voiceName
      : DEFAULT_SPEECH_OPTIONS.voiceName,
    lang: isNonEmptyString(input.lang)
      ? input.lang
      : DEFAULT_SPEECH_OPTIONS.lang,
    rate: Number.isFinite(Number(input.rate))
      ? Number(input.rate)
      : DEFAULT_SPEECH_OPTIONS.rate,
    pitch: Number.isFinite(Number(input.pitch))
      ? Number(input.pitch)
      : DEFAULT_SPEECH_OPTIONS.pitch,
    volume: Number.isFinite(Number(input.volume))
      ? Number(input.volume)
      : DEFAULT_SPEECH_OPTIONS.volume,
  };
}

function normalizeHighlightOptions(input = {}) {
  return {
    mode: input.mode === "css" ? "css" : DEFAULT_HIGHLIGHT_OPTIONS.mode,
    color: isNonEmptyString(input.color)
      ? input.color
      : DEFAULT_HIGHLIGHT_OPTIONS.color,
    textColor: isNonEmptyString(input.textColor)
      ? input.textColor
      : DEFAULT_HIGHLIGHT_OPTIONS.textColor,
    radius: isNonEmptyString(input.radius)
      ? input.radius
      : DEFAULT_HIGHLIGHT_OPTIONS.radius,
    padding: isNonEmptyString(input.padding)
      ? input.padding
      : DEFAULT_HIGHLIGHT_OPTIONS.padding,
  };
}

function normalizeAutoScrollOptions(input = {}, hasTimedSource = false) {
  if (typeof input === "boolean") {
    return {
      enabled: input,
      behavior: DEFAULT_AUTOSCROLL_OPTIONS.behavior,
      block: DEFAULT_AUTOSCROLL_OPTIONS.block,
      marginRatio: DEFAULT_AUTOSCROLL_OPTIONS.marginRatio,
      throttleMs: DEFAULT_AUTOSCROLL_OPTIONS.throttleMs,
    };
  }

  const source = input && typeof input === "object" ? input : {};
  const defaultEnabled = hasTimedSource;

  return {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : defaultEnabled,
    behavior: source.behavior === "auto" ? "auto" : "smooth",
    block: source.block === "start" || source.block === "end"
      ? source.block
      : "center",
    marginRatio: Number.isFinite(Number(source.marginRatio))
      ? Math.max(0.05, Math.min(0.45, Number(source.marginRatio)))
      : DEFAULT_AUTOSCROLL_OPTIONS.marginRatio,
    throttleMs: Number.isFinite(Number(source.throttleMs))
      ? Math.max(24, Math.min(400, Number(source.throttleMs)))
      : DEFAULT_AUTOSCROLL_OPTIONS.throttleMs,
  };
}

function normalizeProgressiveOptions(input = {}) {
  const source = input && typeof input === "object" ? input : {};

  return {
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_PROGRESSIVE_OPTIONS.enabled,
    maxChunkChars: Number.isFinite(Number(source.maxChunkChars))
      ? Math.max(800, Math.min(24000, Number(source.maxChunkChars)))
      : DEFAULT_PROGRESSIVE_OPTIONS.maxChunkChars,
    prefetchAhead: Number.isFinite(Number(source.prefetchAhead))
      ? Math.max(1, Math.min(3, Number(source.prefetchAhead)))
      : DEFAULT_PROGRESSIVE_OPTIONS.prefetchAhead,
    retryCount: Number.isFinite(Number(source.retryCount))
      ? Math.max(0, Math.min(6, Number(source.retryCount)))
      : DEFAULT_PROGRESSIVE_OPTIONS.retryCount,
    retryDelayMs: Number.isFinite(Number(source.retryDelayMs))
      ? Math.max(120, Math.min(5000, Number(source.retryDelayMs)))
      : DEFAULT_PROGRESSIVE_OPTIONS.retryDelayMs,
  };
}

function waitMs(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function splitTextIntoProgressiveChunks(text, maxChunkChars) {
  const source = String(text || "");
  const limit = Math.max(1, Number(maxChunkChars) || DEFAULT_PROGRESSIVE_OPTIONS.maxChunkChars);
  if (!source.length) return [];

  const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|.+$/g;
  const sentences = [];
  let match;
  while ((match = sentenceRegex.exec(source))) {
    const value = match[0];
    if (!value) continue;
    sentences.push({
      text: value,
      start: match.index,
      end: match.index + value.length,
    });
  }

  const chunks = [];
  let buffer = "";
  let chunkStart = 0;
  let chunkEnd = 0;

  function pushBuffer() {
    if (!buffer) return;
    chunks.push({
      index: chunks.length,
      text: buffer,
      start: chunkStart,
      end: chunkEnd,
    });
    buffer = "";
    chunkStart = chunkEnd;
  }

  for (const sentence of sentences) {
    if (sentence.text.length > limit) {
      pushBuffer();
      let cursor = 0;
      while (cursor < sentence.text.length) {
        const part = sentence.text.slice(cursor, cursor + limit);
        const start = sentence.start + cursor;
        const end = start + part.length;
        chunks.push({
          index: chunks.length,
          text: part,
          start,
          end,
        });
        cursor += part.length;
      }
      chunkStart = sentence.end;
      chunkEnd = sentence.end;
      continue;
    }

    if (!buffer) {
      buffer = sentence.text;
      chunkStart = sentence.start;
      chunkEnd = sentence.end;
      continue;
    }

    if (buffer.length + sentence.text.length > limit) {
      pushBuffer();
      buffer = sentence.text;
      chunkStart = sentence.start;
      chunkEnd = sentence.end;
      continue;
    }

    buffer += sentence.text;
    chunkEnd = sentence.end;
  }

  pushBuffer();
  return chunks;
}

function findNearestScrollContainer(startElement) {
  let current = startElement?.parentElement || null;

  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const canScroll = (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight;
    if (canScroll) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function normalizeReadAloudData(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const audioBase64 = String(data.audio_base64 || "").trim();
  const mimeType = String(data.mime_type || "").trim();

  if (!audioBase64 || !mimeType) {
    throw new Error(
      "ReadAloudError: `data` must include non-empty `audio_base64` and `mime_type`.",
    );
  }

  const words = normalizeTimingWords(data.words);

  return {
    audio_base64: audioBase64,
    mime_type: mimeType,
    words,
  };
}

function normalizeTimingWords(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((word, index) => ({
      index,
      word: String(word?.word || "").trim(),
      start: Number(word?.start) || 0,
      end: Number(word?.end) || 0,
    }))
    .filter((word) => word.word && word.end >= word.start);
}

function normalizeReadAloudDataSource(source) {
  if (source === undefined || source === null) {
    return null;
  }

  if (typeof source !== "function") {
    throw new Error(
      "ReadAloudError: `dataSource` must be a function when provided.",
    );
  }

  return source;
}

export function attachReadAloud({
  content,
  trigger,
  endpoint,
  data,
  dataSource,
  requestInit = {},
  speechOptions = {},
  highlight = {},
  autoScroll = {},
  progressive = {},
  debugHook = null,
  instructions = DEFAULT_TTS_INSTRUCTIONS,
}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error(
      "ReadAloudError: `attachReadAloud` must run in a browser environment.",
    );
  }

  assertHighlightSupport();

  const contentElement = resolveElement(content, "content");
  const triggerElement = resolveElement(trigger, "trigger");

  const payloadData = normalizeReadAloudData(data);
  const hasData = Boolean(payloadData);
  const resolvedDataSource = normalizeReadAloudDataSource(dataSource);
  const hasDataSource = Boolean(resolvedDataSource);
  const hasEndpoint = isNonEmptyString(endpoint);
  const hasTimedSource = hasData || hasDataSource || hasEndpoint;
  if (!hasTimedSource) {
    assertSpeechSynthesisSupport();
  }
  const resolvedSpeechOptions = normalizeSpeechOptions(speechOptions);
  const userHighlight = normalizeHighlightOptions(highlight);
  const resolvedHighlight = hasTimedSource
    ? { ...userHighlight, mode: "css" }
    : userHighlight;
  const resolvedAutoScroll = normalizeAutoScrollOptions(autoScroll, hasTimedSource);
  const resolvedProgressive = normalizeProgressiveOptions(progressive);
  const resolvedDebugHook =
    typeof debugHook === "function" ? debugHook : null;

  const highlightName = "readaloud-active";

  const audio = new Audio();
  audio.preload = "auto";

  let textMap = buildTextMap(contentElement);
  let timedWords = [];
  let mappedWords = [];
  let progressiveMode = false;
  let progressiveChunks = [];
  let progressiveChunkData = [];
  let progressiveChunkPromises = new Map();
  let progressiveCurrentChunkIndex = 0;
  let progressiveChunkError = null;
  let progressiveBoundaryLoading = false;
  let timedErrorCode = null;
  let timedErrorMessage = null;
  let activeWordIndex = -1;
  let rafId = null;
  let loaded = false;
  let loading = false;
  let lastKnownIndex = 0;
  let wordChangeHandlers = [];
  let localUtterance = null;
  let localPaused = false;
  let activeWrapper = null;
  let lastScrollTs = 0;
  const nearestScrollContainer = findNearestScrollContainer(contentElement);

  function emitDebug(event) {
    if (!resolvedDebugHook) return;
    try {
      resolvedDebugHook(event);
    } catch {
      // ignore debug hook errors
    }
  }

  function clearTimedError() {
    timedErrorCode = null;
    timedErrorMessage = null;
  }

  function setTimedError(code, message, details = null) {
    timedErrorCode = code || "timed_error";
    timedErrorMessage = String(message || "Timed read-aloud failed.");
    emitDebug({
      type: "timed_error",
      code: timedErrorCode,
      message: timedErrorMessage,
      ...(details && typeof details === "object" ? details : {}),
    });
  }

  function unwrapActiveWrapper() {
    if (!activeWrapper || !activeWrapper.parentNode) {
      activeWrapper = null;
      return;
    }

    const parent = activeWrapper.parentNode;
    while (activeWrapper.firstChild) {
      parent.insertBefore(activeWrapper.firstChild, activeWrapper);
    }
    parent.removeChild(activeWrapper);
    parent.normalize();
    activeWrapper = null;
  }

  function emitWordChange(index) {
    const payload = index >= 0 ? mappedWords[index] : null;
    for (const handler of wordChangeHandlers) {
      handler(payload);
    }
  }

  function clearHighlight() {
    CSS.highlights.delete(highlightName);
    unwrapActiveWrapper();
    activeWordIndex = -1;
    emitWordChange(-1);
  }

  function maybeAutoScroll(range) {
    if (!resolvedAutoScroll.enabled || !range) return;

    const now = performance.now();
    if (now - lastScrollTs < resolvedAutoScroll.throttleMs) return;
    lastScrollTs = now;

    const rangeRect = range.getBoundingClientRect();
    if (!rangeRect || (!rangeRect.width && !rangeRect.height)) return;

    if (nearestScrollContainer) {
      const containerRect = nearestScrollContainer.getBoundingClientRect();
      const margin = Math.max(24, containerRect.height * resolvedAutoScroll.marginRatio);
      const topBound = containerRect.top + margin;
      const bottomBound = containerRect.bottom - margin;
      const outside = rangeRect.top < topBound || rangeRect.bottom > bottomBound;
      if (!outside) return;

      const targetTop =
        nearestScrollContainer.scrollTop +
        (rangeRect.top - containerRect.top) -
        nearestScrollContainer.clientHeight / 2 +
        rangeRect.height / 2;

      nearestScrollContainer.scrollTo({
        top: Math.max(0, targetTop),
        behavior: resolvedAutoScroll.behavior,
      });
      return;
    }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const margin = Math.max(24, viewportHeight * resolvedAutoScroll.marginRatio);
    const outside = rangeRect.top < margin || rangeRect.bottom > viewportHeight - margin;
    if (!outside) return;

    range.startContainer?.parentElement?.scrollIntoView({
      behavior: resolvedAutoScroll.behavior,
      block: resolvedAutoScroll.block,
      inline: "nearest",
    });
  }

  function getProgressiveChunkOffset(limitIndexExclusive) {
    let offset = 0;
    for (let i = 0; i < limitIndexExclusive; i += 1) {
      const duration = Number(progressiveChunkData[i]?.duration);
      if (Number.isFinite(duration) && duration > 0) {
        offset += duration;
        continue;
      }

      const chunkWords = progressiveChunkData[i]?.alignedWords;
      const fallbackEnd = Number(
        chunkWords?.length ? chunkWords[chunkWords.length - 1]?.end_time : 0,
      );
      if (Number.isFinite(fallbackEnd) && fallbackEnd > 0) {
        offset += fallbackEnd;
      }
    }
    return offset;
  }

  function applyHighlight(index) {
    if (index < 0 || index >= mappedWords.length) {
      if (activeWordIndex !== -1) {
        clearHighlight();
      }
      return;
    }

    if (activeWordIndex === index) return;

    if (resolvedHighlight.mode === "span" && activeWrapper) {
      // Remove previous wrapper before mapping/applying the next one.
      unwrapActiveWrapper();
      textMap = buildTextMap(contentElement);
      remapWords();
    }

    const word = mappedWords[index];
    const range = createRangeForWord(textMap.segments, word);

    if (!range) {
      clearHighlight();
      return;
    }

    if (resolvedHighlight.mode === "span") {
      const wrapper = document.createElement("span");
      wrapper.style.backgroundColor = resolvedHighlight.color;
      wrapper.style.color = resolvedHighlight.textColor;
      wrapper.style.borderRadius = resolvedHighlight.radius;
      wrapper.style.padding = resolvedHighlight.padding;
      wrapper.style.boxDecorationBreak = "clone";
      wrapper.style.webkitBoxDecorationBreak = "clone";

      try {
        range.surroundContents(wrapper);
        activeWrapper = wrapper;
      } catch {
        CSS.highlights.set(highlightName, new Highlight(range));
      }
    } else {
      CSS.highlights.set(highlightName, new Highlight(range));
    }

    activeWordIndex = index;
    lastKnownIndex = index;
    maybeAutoScroll(range);
    emitWordChange(index);
  }

  function syncHighlight() {
    let playbackTime = audio.currentTime;
    if (progressiveMode) {
      playbackTime =
        getProgressiveChunkOffset(progressiveCurrentChunkIndex) + audio.currentTime;
    }

    const index = resolveActiveMappedWordIndex(
      mappedWords,
      playbackTime,
      lastKnownIndex,
    );
    applyHighlight(index);

    if (!audio.paused && !audio.ended) {
      rafId = window.requestAnimationFrame(syncHighlight);
    }
  }

  function stopSync() {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function remapWords() {
    if (!hasTimedSource) {
      mappedWords = textMap.words.map((word) => ({
        ...word,
        start_time: null,
        end_time: null,
        timed_text: word.text,
      }));
      return;
    }

    mappedWords = alignTimedWordsToText(textMap.words, timedWords);
    normalizeMappedTimingsToAudioDuration(mappedWords, audio.duration);
  }

  function initializeProgressiveMappedWords() {
    mappedWords = textMap.words.map((word) => ({
      ...word,
      start_time: null,
      end_time: null,
      timed_text: word.text,
    }));
  }

  function recomputeProgressiveMappedWords() {
    initializeProgressiveMappedWords();

    for (let chunkIndex = 0; chunkIndex < progressiveChunks.length; chunkIndex += 1) {
      const timeOffset = getProgressiveChunkOffset(chunkIndex);
      const chunkData = progressiveChunkData[chunkIndex];
      if (!chunkData || !Array.isArray(chunkData.alignedWords)) {
        continue;
      }

      for (const chunkWord of chunkData.alignedWords) {
        const targetIndex = chunkWord.absoluteIndex;
        if (targetIndex < 0 || targetIndex >= mappedWords.length) continue;
        const start = toTimingValue(chunkWord.start_time);
        const end = toTimingValue(chunkWord.end_time);
        if (start === null || end === null || end < start) continue;

        assignTiming(
          mappedWords[targetIndex],
          timeOffset + start,
          timeOffset + end,
        );
        mappedWords[targetIndex].timed_text = chunkWord.timed_text || mappedWords[targetIndex].text;
      }

    }
  }

  function getChunkWordSlice(chunk) {
    const words = textMap.words.filter(
      (word) => word.end > chunk.start && word.start < chunk.end,
    );

    return words.map((word) => ({
      ...word,
      start: Math.max(0, word.start - chunk.start),
      end: Math.max(0, word.end - chunk.start),
      absoluteIndex: word.index,
    }));
  }

  function buildRequestHeaders() {
    return {
      "Content-Type": "application/json",
      ...(requestInit.headers || {}),
    };
  }

  async function requestTimedPayload({
    text,
    chunk_index = 0,
    total_chunks = 1,
    instructions: requestInstructions,
  }) {
    if (hasDataSource) {
      const raw = await resolvedDataSource({
        text,
        chunk_index,
        total_chunks,
        instructions: requestInstructions,
      });
      return normalizeReadAloudData(raw);
    }

    const response = await fetch(endpoint, {
      ...requestInit,
      method: "POST",
      headers: buildRequestHeaders(),
      body: JSON.stringify({
        text,
        chunk_index,
        total_chunks,
        instructions: requestInstructions,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `ReadAloudError: endpoint request failed with status ${response.status}.`,
      );
    }

    return normalizeReadAloudData(await response.json());
  }

  async function decodeChunkDuration(audioSrc) {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.src = audioSrc;

    return new Promise((resolve) => {
      const cleanup = () => {
        probe.removeAttribute("src");
        probe.load();
      };

      const done = () => {
        const duration = Number(probe.duration);
        cleanup();
        resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
      };

      probe.addEventListener("loadedmetadata", done, { once: true });
      probe.addEventListener("error", done, { once: true });
    });
  }

  async function fetchChunkPayload(chunk) {
    let attempt = 0;
    const instructionText = String(instructions || DEFAULT_TTS_INSTRUCTIONS);
    const source = hasDataSource ? "dataSource" : "endpoint";

    while (attempt <= resolvedProgressive.retryCount) {
      const attemptNumber = attempt + 1;
      emitDebug({
        type: "chunk_attempt",
        source,
        chunk_index: chunk.index,
        total_chunks: progressiveChunks.length,
        attempt: attemptNumber,
      });
      try {
        const payload = await requestTimedPayload({
          text: chunk.text,
          chunk_index: chunk.index,
          total_chunks: progressiveChunks.length,
          instructions: instructionText,
        });
        emitDebug({
          type: "chunk_success",
          source,
          chunk_index: chunk.index,
          total_chunks: progressiveChunks.length,
          attempt: attemptNumber,
        });
        return payload;
      } catch (error) {
        emitDebug({
          type: "chunk_error",
          source,
          chunk_index: chunk.index,
          total_chunks: progressiveChunks.length,
          attempt: attemptNumber,
          error: error?.message || "unknown error",
        });
        if (attempt >= resolvedProgressive.retryCount) {
          const message =
            error?.message ||
            `chunk ${chunk.index + 1}/${progressiveChunks.length} failed to load`;
          throw new Error(`ReadAloudError: ${message}`);
        }
        emitDebug({
          type: "chunk_retry_scheduled",
          source,
          chunk_index: chunk.index,
          total_chunks: progressiveChunks.length,
          attempt: attemptNumber,
          retry_in_ms: resolvedProgressive.retryDelayMs * attemptNumber,
          error: error?.message || "unknown error",
        });
      }

      attempt += 1;
      await waitMs(resolvedProgressive.retryDelayMs * attempt);
    }

    throw new Error(
      `ReadAloudError: chunk ${chunk.index + 1}/${progressiveChunks.length} failed to load.`,
    );
  }

  async function ensureProgressiveChunk(index) {
    if (index < 0 || index >= progressiveChunks.length) {
      throw new Error(`ReadAloudError: chunk index ${index} is out of range.`);
    }

    if (progressiveChunkData[index]) {
      return progressiveChunkData[index];
    }

    if (progressiveChunkPromises.has(index)) {
      return progressiveChunkPromises.get(index);
    }

    const chunk = progressiveChunks[index];
    const pending = (async () => {
      const payload = await fetchChunkPayload(chunk);
      const chunkTextWords = getChunkWordSlice(chunk);
      const audioSrc = buildAudioSource(payload.mime_type, payload.audio_base64);
      const duration = await decodeChunkDuration(audioSrc);
      const alignedWords = alignTimedWordsToText(chunkTextWords, payload.words);
      if (!hasUsableMappedTimings(alignedWords)) {
        setTimedError(
          "timing_unavailable",
          "Synchronized word timings are missing for a chunk. Audio continues without highlight for unmatched regions.",
          {
            source: hasDataSource ? "dataSource" : "endpoint",
            chunk_index: chunk.index,
            total_chunks: progressiveChunks.length,
          },
        );
        emitDebug({
          type: "timing_words_missing",
          source: hasDataSource ? "dataSource" : "endpoint",
          chunk_index: chunk.index,
          total_chunks: progressiveChunks.length,
        });
      }
      normalizeMappedTimingsToAudioDuration(alignedWords, duration);

      const built = {
        payload,
        audioSrc,
        duration,
        alignedWords,
      };

      progressiveChunkData[index] = built;
      recomputeProgressiveMappedWords();
      return built;
    })();

    progressiveChunkPromises.set(index, pending);

    try {
      return await pending;
    } finally {
      progressiveChunkPromises.delete(index);
    }
  }

  function scheduleProgressivePrefetch() {
    if (!progressiveMode) return;
    for (let i = 1; i <= resolvedProgressive.prefetchAhead; i += 1) {
      const targetIndex = progressiveCurrentChunkIndex + i;
      if (targetIndex >= progressiveChunks.length) break;
      ensureProgressiveChunk(targetIndex).catch(() => {
        // Boundary logic handles surfaced errors.
      });
    }
  }

  async function setAudioToProgressiveChunk(index) {
    const built = await ensureProgressiveChunk(index);
    progressiveCurrentChunkIndex = index;
    audio.src = built.audioSrc;
    audio.currentTime = 0;
  }

  function isProgressiveEndPosition() {
    if (!progressiveMode || !progressiveChunks.length) return false;
    if (progressiveCurrentChunkIndex !== progressiveChunks.length - 1) return false;

    const duration = Number(audio.duration);
    if (!Number.isFinite(duration) || duration <= 0) return false;
    return audio.currentTime >= Math.max(0, duration - 0.05);
  }

  async function load() {
    if (loaded || loading) return;
    loading = true;
    progressiveChunkError = null;
    clearTimedError();

    try {
      textMap = buildTextMap(contentElement);
      if (!textMap.text.trim()) {
        throw new Error("ReadAloudError: target content has no readable text.");
      }

      if (!hasTimedSource) {
        remapWords();
        loaded = true;
        return;
      }

      progressiveMode = false;
      progressiveChunks = [];
      progressiveChunkData = [];
      progressiveChunkPromises = new Map();
      progressiveCurrentChunkIndex = 0;

      let payload = payloadData;
      if (!payload && (hasEndpoint || hasDataSource)) {
        const maybeChunks = splitTextIntoProgressiveChunks(
          textMap.text,
          resolvedProgressive.maxChunkChars,
        );
        const shouldUseProgressive =
          resolvedProgressive.enabled && maybeChunks.length > 1;

        if (shouldUseProgressive) {
          progressiveMode = true;
          progressiveChunks = maybeChunks;
          initializeProgressiveMappedWords();
          await setAudioToProgressiveChunk(0);
          scheduleProgressivePrefetch();
          loaded = true;
          return;
        }
      }

      if (!payload) {
        payload = await requestTimedPayload({
          text: textMap.text,
          chunk_index: 0,
          total_chunks: 1,
          instructions: String(instructions || DEFAULT_TTS_INSTRUCTIONS),
        });
      }

      if (!payload) {
        throw new Error(
          "ReadAloudError: no read-aloud data available. Provide `data`, `dataSource`, or `endpoint`.",
        );
      }

      timedWords = payload.words;

      remapWords();
      if (!hasUsableMappedTimings(mappedWords)) {
        setTimedError(
          "timing_unavailable",
          "Synchronized word timings are unavailable for this payload. Audio can still play.",
          {
            source: hasDataSource ? "dataSource" : hasEndpoint ? "endpoint" : "data",
            chunk_index: 0,
            total_chunks: 1,
          },
        );
        emitDebug({
          type: "timing_words_missing",
          source: hasDataSource ? "dataSource" : hasEndpoint ? "endpoint" : "data",
          chunk_index: 0,
          total_chunks: 1,
        });
      }
      audio.src = buildAudioSource(payload.mime_type, payload.audio_base64);

      // Ensure mapped timings span the actual audio duration to avoid early highlight dropouts.
      await new Promise((resolve) => {
        const done = () => resolve();
        audio.addEventListener("loadedmetadata", done, { once: true });
        audio.addEventListener("error", done, { once: true });
      });
      normalizeMappedTimingsToAudioDuration(mappedWords, audio.duration);

      loaded = true;
    } finally {
      loading = false;
    }
  }

  async function play() {
    try {
      await load();
    } catch (error) {
      setTimedError(
        "load_failed",
        error?.message || "Failed to prepare timed read-aloud audio.",
      );
      throw error;
    }

    if (!hasTimedSource) {
      if (window.speechSynthesis.paused && localPaused) {
        window.speechSynthesis.resume();
        localPaused = false;
        return;
      }

      window.speechSynthesis.cancel();
      clearHighlight();
      lastKnownIndex = 0;

      localUtterance = new SpeechSynthesisUtterance(textMap.text);

      localUtterance.lang = resolvedSpeechOptions.lang;
      localUtterance.rate = resolvedSpeechOptions.rate;
      localUtterance.pitch = resolvedSpeechOptions.pitch;
      localUtterance.volume = resolvedSpeechOptions.volume;

      const availableVoices = window.speechSynthesis.getVoices();
      const byName = availableVoices.find(
        (candidate) => candidate.name === resolvedSpeechOptions.voiceName,
      );
      const byLanguage = availableVoices.find(
        (candidate) => candidate.lang === resolvedSpeechOptions.lang,
      );
      const voice = byName || byLanguage || availableVoices[0] || null;
      if (voice) {
        localUtterance.voice = voice;
      }

      localUtterance.onboundary = (event) => {
        if (typeof event.charIndex !== "number") return;
        const index = resolveWordIndexFromChar(
          textMap.words,
          event.charIndex,
          lastKnownIndex,
        );
        if (index >= 0) {
          lastKnownIndex = index;
        }
        applyHighlight(index);
      };

      localUtterance.onend = () => {
        localPaused = false;
        clearHighlight();
      };

      localUtterance.onerror = () => {
        localPaused = false;
        clearHighlight();
      };

      window.speechSynthesis.speak(localUtterance);
      return;
    }

    if (!audio.src) {
      throw new Error("ReadAloudError: audio source could not be prepared.");
    }

    if (progressiveChunkError) {
      setTimedError(
        "chunk_failed",
        progressiveChunkError?.message || "A progressive chunk failed to load.",
      );
      throw progressiveChunkError;
    }

    if (progressiveMode && (audio.ended || isProgressiveEndPosition())) {
      await setAudioToProgressiveChunk(0);
      lastKnownIndex = 0;
      clearHighlight();
      scheduleProgressivePrefetch();
    }

    const duration = Number(audio.duration);
    const isEndedPosition =
      Number.isFinite(duration) &&
      duration > 0 &&
      audio.currentTime >= Math.max(0, duration - 0.05);
    if (!progressiveMode && (audio.ended || isEndedPosition)) {
      audio.currentTime = 0;
      lastKnownIndex = 0;
      clearHighlight();
    }

    try {
      await audio.play();
      clearTimedError();
    } catch (error) {
      const name = String(error?.name || "");
      const isInteractionRequired =
        name === "NotAllowedError" ||
        /notallowed|gesture|interaction|autoplay/i.test(
          String(error?.message || ""),
        );
      if (isInteractionRequired) {
        setTimedError(
          "interaction_required",
          "Playback was blocked by the browser. Tap play again to continue.",
        );
      } else {
        setTimedError(
          "play_failed",
          error?.message || "Audio playback failed.",
        );
      }
      throw error;
    }
    stopSync();
    if (hasUsableMappedTimings(mappedWords)) {
      rafId = window.requestAnimationFrame(syncHighlight);
    } else {
      clearHighlight();
    }
  }

  function pause() {
    if (!hasTimedSource) {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        localPaused = true;
      }
      return;
    }

    audio.pause();
    stopSync();
  }

  async function toggle() {
    if (!hasTimedSource) {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        pause();
        return;
      }
      await play();
      return;
    }

    if (audio.paused) {
      await play();
    } else {
      pause();
    }
  }

  function refresh() {
    textMap = buildTextMap(contentElement);
    if (progressiveMode) {
      recomputeProgressiveMappedWords();
    } else {
      remapWords();
    }
    applyHighlight(activeWordIndex);
  }

  function onWordChange(handler) {
    if (typeof handler !== "function") {
      throw new Error(
        "ReadAloudError: `onWordChange` expects a function handler.",
      );
    }

    wordChangeHandlers.push(handler);
    return () => {
      wordChangeHandlers = wordChangeHandlers.filter(
        (candidate) => candidate !== handler,
      );
    };
  }

  async function handleTriggerClick(event) {
    event.preventDefault();
    try {
      await toggle();
    } catch (error) {
      if (!timedErrorCode) {
        setTimedError(
          "toggle_failed",
          error?.message || "Unable to toggle timed read-aloud.",
        );
      }
    }
  }

  function destroy() {
    pause();
    clearHighlight();
    triggerElement.removeEventListener("click", handleTriggerClick);
    if (!hasTimedSource) {
      window.speechSynthesis.cancel();
      localUtterance = null;
      localPaused = false;
      wordChangeHandlers = [];
      return;
    }
    audio.removeAttribute("src");
    audio.load();
    wordChangeHandlers = [];
  }

  audio.addEventListener("ended", async () => {
    stopSync();

    if (!progressiveMode) {
      clearHighlight();
      return;
    }

    const endedDuration = Number(audio.duration);
    if (
      Number.isFinite(endedDuration) &&
      endedDuration > 0 &&
      progressiveChunkData[progressiveCurrentChunkIndex]
    ) {
      const currentChunkData = progressiveChunkData[progressiveCurrentChunkIndex];
      currentChunkData.duration = endedDuration;
      recomputeProgressiveMappedWords();
    }

    const nextIndex = progressiveCurrentChunkIndex + 1;
    if (nextIndex >= progressiveChunks.length) {
      clearHighlight();
      return;
    }

    progressiveBoundaryLoading = true;
    loading = true;
    try {
      await setAudioToProgressiveChunk(nextIndex);
      scheduleProgressivePrefetch();
      progressiveBoundaryLoading = false;
      loading = false;
      await audio.play();
      if (hasUsableMappedTimings(mappedWords)) {
        rafId = window.requestAnimationFrame(syncHighlight);
      } else {
        clearHighlight();
      }
    } catch (error) {
      progressiveBoundaryLoading = false;
      loading = false;
      progressiveChunkError = error instanceof Error
        ? error
        : new Error("ReadAloudError: failed to prepare next progressive chunk.");
      clearHighlight();
    }
  });

  triggerElement.addEventListener("click", handleTriggerClick);

  return {
    play,
    pause,
    toggle,
    refresh,
    onWordChange,
    destroy,
    get state() {
      if (!hasTimedSource) {
        return {
          loaded,
          loading,
          playing:
            window.speechSynthesis.speaking && !window.speechSynthesis.paused,
          activeWordIndex,
        };
      }

      return {
        loaded,
        loading,
        playing: !audio.paused,
        activeWordIndex,
        progressive: progressiveMode
          ? {
              currentChunkIndex: progressiveCurrentChunkIndex,
              totalChunks: progressiveChunks.length,
              boundaryLoading: progressiveBoundaryLoading,
              error: progressiveChunkError?.message || null,
            }
          : null,
        error: timedErrorCode
          ? {
              code: timedErrorCode,
              message: timedErrorMessage,
            }
          : null,
      };
    },
  };
}
