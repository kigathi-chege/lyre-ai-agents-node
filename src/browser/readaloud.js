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

export const READ_ALOUD_DEFAULTS = Object.freeze({
  instructions: DEFAULT_TTS_INSTRUCTIONS,
  speechOptions: Object.freeze({ ...DEFAULT_SPEECH_OPTIONS }),
  highlight: Object.freeze({ ...DEFAULT_HIGHLIGHT_OPTIONS }),
});

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

function buildTextMap(container) {
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

function resolveActiveWordIndex(words, currentTime, fromIndex = 0) {
  if (!words.length) return -1;

  const safeFromIndex = Math.max(0, Math.min(fromIndex, words.length - 1));

  for (let i = safeFromIndex; i < words.length; i += 1) {
    const word = words[i];
    if (currentTime >= word.start && currentTime < word.end) {
      return i;
    }
    if (currentTime < word.start) {
      return -1;
    }
  }

  for (let i = Math.min(safeFromIndex, words.length - 1); i >= 0; i -= 1) {
    const word = words[i];
    if (currentTime >= word.start && currentTime < word.end) {
      return i;
    }
    if (currentTime > word.end) {
      return -1;
    }
  }

  return -1;
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

export function attachReadAloud({
  content,
  trigger,
  endpoint,
  requestInit = {},
  speechOptions = {},
  highlight = {},
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

  const hasEndpoint = isNonEmptyString(endpoint);
  if (!hasEndpoint) {
    assertSpeechSynthesisSupport();
  }
  const resolvedSpeechOptions = normalizeSpeechOptions(speechOptions);
  const resolvedHighlight = normalizeHighlightOptions(highlight);

  const highlightName = "readaloud-active";

  const audio = new Audio();
  audio.preload = "auto";

  let textMap = buildTextMap(contentElement);
  let timedWords = [];
  let mappedWords = [];
  let activeWordIndex = -1;
  let rafId = null;
  let loaded = false;
  let loading = false;
  let lastKnownIndex = 0;
  let wordChangeHandlers = [];
  let localUtterance = null;
  let localPaused = false;
  let activeWrapper = null;

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
    emitWordChange(index);
  }

  function syncHighlight() {
    const index = resolveActiveWordIndex(
      timedWords,
      audio.currentTime,
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
    if (!hasEndpoint) {
      mappedWords = textMap.words.map((word) => ({
        ...word,
        start_time: null,
        end_time: null,
        timed_text: word.text,
      }));
      return;
    }

    mappedWords = timedWords
      .slice(0, textMap.words.length)
      .map((timedWord, index) => ({
        ...textMap.words[index],
        start_time: timedWord.start,
        end_time: timedWord.end,
        timed_text: timedWord.word,
      }));
  }

  async function load() {
    if (loaded || loading) return;
    loading = true;

    try {
      textMap = buildTextMap(contentElement);
      if (!textMap.text.trim()) {
        throw new Error("ReadAloudError: target content has no readable text.");
      }

      if (!hasEndpoint) {
        remapWords();
        loaded = true;
        return;
      }

      const response = await fetch(endpoint, {
        ...requestInit,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestInit.headers || {}),
        },
        body: JSON.stringify({
          text: textMap.text,
          instructions: String(instructions || DEFAULT_TTS_INSTRUCTIONS),
        }),
      });

      if (!response.ok) {
        throw new Error(
          `ReadAloudError: endpoint request failed with status ${response.status}.`,
        );
      }

      const payload = await response.json();
      if (!payload?.audio_base64 || !payload?.mime_type) {
        throw new Error(
          "ReadAloudError: endpoint response missing `audio_base64` or `mime_type`.",
        );
      }

      timedWords = Array.isArray(payload.words)
        ? payload.words
            .map((word, index) => ({
              index,
              word: String(word?.word || "").trim(),
              start: Number(word?.start) || 0,
              end: Number(word?.end) || 0,
            }))
            .filter((word) => word.word && word.end >= word.start)
        : [];

      remapWords();
      audio.src = buildAudioSource(payload.mime_type, payload.audio_base64);
      loaded = true;
    } finally {
      loading = false;
    }
  }

  async function play() {
    await load();

    if (!hasEndpoint) {
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

    await audio.play();
    stopSync();
    rafId = window.requestAnimationFrame(syncHighlight);
  }

  function pause() {
    if (!hasEndpoint) {
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
    if (!hasEndpoint) {
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
    remapWords();
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
    } catch {
      // Intentionally swallow click-time errors to avoid unhandled rejections in UI event flow.
    }
  }

  function destroy() {
    pause();
    clearHighlight();
    triggerElement.removeEventListener("click", handleTriggerClick);
    if (!hasEndpoint) {
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

  audio.addEventListener("ended", () => {
    stopSync();
    clearHighlight();
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
      if (!hasEndpoint) {
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
      };
    },
  };
}
