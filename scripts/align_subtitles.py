#!/usr/bin/env python3
"""Align a ground-truth script with Whisper output to produce timed subtitles.

Supports two inputs:
  - Whisper JSON with word-level timestamps (--word_timestamps)
  - Whisper SRT (fallback, less precise)

The output SRT uses the EXACT script text, with timings derived from the audio
via Whisper. This guarantees subtitle content accuracy and strict correspondence
with the spoken audio.

Usage:
  python3 align_subtitles.py <script.txt> <whisper.json|whisper.srt> <output.srt>
"""
import json
import re
import sys
import difflib
from dataclasses import dataclass
from typing import List, Tuple, Optional


@dataclass
class CharTick:
    char: str
    time: float


@dataclass
class Cue:
    index: int
    start: str
    end: str
    text: str


# ---------------------------------------------------------------------------
# Time / text helpers
# ---------------------------------------------------------------------------

def parse_time(t: str) -> float:
    """Parse SRT time HH:MM:SS,mmm to seconds."""
    h, m, s, ms = map(int, re.split(r"[:.,]", t))
    return h * 3600 + m * 60 + s + ms / 1000


def fmt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    ms = int(round(seconds * 1000))
    s, ms = divmod(ms, 1000)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def normalize_chars(text: str) -> List[str]:
    """Return characters of text with whitespace removed."""
    return [c for c in text if not c.isspace()]


def normalize_with_mapping(text: str) -> Tuple[List[str], List[int]]:
    """Return (non-space chars, mapping from non-space index to original index)."""
    chars = []
    mapping = []
    for i, c in enumerate(text):
        if not c.isspace():
            chars.append(c)
            mapping.append(i)
    return chars, mapping


def fill_space_times(
    all_chars: List[str],
    mapping: List[int],
    non_space_times: List[float],
) -> List[float]:
    """Assign timestamps to every original char, including spaces."""
    n = len(all_chars)
    times: List[Optional[float]] = [None] * n
    for ns_idx, orig_idx in enumerate(mapping):
        times[orig_idx] = non_space_times[ns_idx]

    # Forward fill
    last: Optional[float] = None
    for i in range(n):
        if times[i] is not None:
            last = times[i]
        elif last is not None:
            times[i] = last

    # Backward fill leading gaps
    first = next((t for t in times if t is not None), None)
    if first is None:
        return [0.0] * n
    for i in range(n):
        if times[i] is None:
            times[i] = first
        else:
            break

    # Interpolate internal gaps (should only be spaces between two known chars)
    i = 0
    while i < n:
        if times[i] is None:
            left = i - 1
            right = i
            while right < n and times[right] is None:
                right += 1
            right = min(n - 1, right)
            t_left = times[left]
            t_right = times[right]
            if t_left is None or t_right is None:
                for j in range(left, right + 1):
                    times[j] = first
            else:
                count = right - left
                for j in range(left + 1, right + 1):
                    times[j] = t_left + (t_right - t_left) * (j - left) / count
            i = right + 1
        else:
            i += 1

    return [t if t is not None else first for t in times]


def visual_length(text: str) -> float:
    """Approximate on-screen width (same rule as parse_srt.js)."""
    total = 0.0
    for ch in text:
        if ch == " ":
            total += 0.35
        elif re.match(r"[A-Za-z0-9]", ch):
            total += 0.62
        elif re.match(r"[.,:;!?'\"`-]", ch):
            total += 0.38
        else:
            total += 1.0
    return total


# ---------------------------------------------------------------------------
# Whisper input parsers
# ---------------------------------------------------------------------------

def parse_whisper_json(path: str) -> List[CharTick]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    ticks: List[CharTick] = []
    for segment in data.get("segments", []):
        for word in segment.get("words", []):
            word_text = str(word.get("word", ""))
            chars = normalize_chars(word_text)
            if not chars:
                continue
            t0 = float(word.get("start", 0))
            t1 = float(word.get("end", t0))
            # Linearly interpolate character timestamps within the word.
            if len(chars) == 1:
                ticks.append(CharTick(chars[0], t0))
            else:
                step = (t1 - t0) / len(chars)
                for i, ch in enumerate(chars):
                    ticks.append(CharTick(ch, t0 + i * step))
    return ticks


def parse_whisper_srt(path: str) -> List[CharTick]:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()

    ticks: List[CharTick] = []
    for block in re.split(r"\n\n+", content):
        lines = block.split("\n")
        if len(lines) < 3:
            continue
        time_line = lines[1].strip()
        text = " ".join(lines[2:]).strip()
        m = re.match(
            r"(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})",
            time_line,
        )
        if not m:
            continue
        t0 = parse_time(m.group(1))
        t1 = parse_time(m.group(2))
        chars = normalize_chars(text)
        if not chars:
            continue
        if len(chars) == 1:
            ticks.append(CharTick(chars[0], t0))
        else:
            step = (t1 - t0) / len(chars)
            for i, ch in enumerate(chars):
                ticks.append(CharTick(ch, t0 + i * step))
    return ticks


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

def map_script_to_whisper(
    script_norm: List[str],
    whisper_norm: List[str],
    whisper_ticks: List[CharTick],
    min_ratio: float = 0.65,
) -> List[float]:
    """Return a timestamp for every script_norm character."""
    sm = difflib.SequenceMatcher(None, whisper_norm, script_norm, autojunk=False)
    blocks = [
        (b, b + size, a, a + size)  # (script_start, script_end, whisper_start, whisper_end)
        for a, b, size in sm.get_matching_blocks()
        if size > 0
    ]

    # Diagnostic similarity
    matches = sum(script_end - script_start for script_start, script_end, _, _ in blocks)
    total = len(whisper_norm) + len(script_norm)
    ratio = 2 * matches / total if total else 0.0
    print(f"🎯 Script-audio character match ratio: {ratio:.2%}")
    if ratio < min_ratio:
        raise ValueError(
            f"Script does not match audio (match ratio {ratio:.2%} < {min_ratio:.2%}). "
            "The script used for subtitles must be the exact text spoken in the audio."
        )

    # Fill exact matches
    times: List[Optional[float]] = [None] * len(script_norm)
    for s_start, s_end, w_start, w_end in blocks:
        # Whisper indices map directly to tick indices
        for si in range(s_start, s_end):
            wi = w_start + (si - s_start)
            if 0 <= wi < len(whisper_ticks):
                times[si] = whisper_ticks[wi].time

    # Forward-fill gaps
    last: Optional[float] = None
    for i in range(len(times)):
        if times[i] is not None:
            last = times[i]
        elif last is not None:
            times[i] = last

    # Backward-fill leading gaps
    first_known: Optional[float] = next((t for t in times if t is not None), None)
    if first_known is None:
        raise ValueError("No alignment found between script and audio")
    for i in range(len(times)):
        if times[i] is None:
            times[i] = first_known
        else:
            break

    # Linearly interpolate any remaining internal gaps (shouldn't be many after forward fill)
    i = 0
    while i < len(times):
        if times[i] is None:
            start_i = max(0, i - 1)
            end_i = i
            while end_i < len(times) and times[end_i] is None:
                end_i += 1
            end_i = min(len(times) - 1, end_i)
            t_start = times[start_i]
            t_end = times[end_i]
            if t_start is None or t_end is None:
                for j in range(start_i, end_i + 1):
                    times[j] = first_known
            else:
                count = end_i - start_i
                for j in range(start_i + 1, end_i + 1):
                    times[j] = t_start + (t_end - t_start) * (j - start_i) / count
            i = end_i + 1
        else:
            i += 1

    return [t if t is not None else first_known for t in times]


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------

Unit = Tuple[int, int, List[str]]  # (start_idx, end_idx, chars)


def split_by_delimiters(chars: List[str], start_idx: int, pattern: re.Pattern) -> List[Unit]:
    """Split a character list by delimiters, keeping the delimiter on the previous unit.

    Returns units with absolute start/end indices in the original script_norm list.
    """
    units: List[Unit] = []
    current: List[str] = []
    current_start = start_idx
    for offset, ch in enumerate(chars):
        current.append(ch)
        if pattern.search(ch):
            if current:
                end_idx = start_idx + offset
                units.append((current_start, end_idx, current))
                current = []
                current_start = end_idx + 1
    if current:
        end_idx = start_idx + len(chars) - 1
        units.append((current_start, end_idx, current))
    return units


def group_units(units: List[Unit], desired_count: int) -> List[Unit]:
    """Greedy grouping similar to parse_srt.js."""
    if desired_count <= 1 or len(units) <= desired_count:
        return units

    lengths = [visual_length("".join(u[2])) for u in units]
    total = sum(lengths)
    target = total / desired_count

    groups: List[Unit] = []
    current_chars: List[str] = []
    current_start: int = units[0][0]
    current_len = 0.0

    for i, (s_idx, e_idx, chars) in enumerate(units):
        remaining_units = len(units) - i
        remaining_slots = desired_count - len(groups)

        if (
            current_chars
            and remaining_slots > 1
            and (current_len + lengths[i] > target * 1.18 or remaining_units == remaining_slots)
        ):
            groups.append((current_start, s_idx - 1, current_chars))
            current_chars = list(chars)
            current_start = s_idx
            current_len = lengths[i]
        else:
            current_chars.extend(chars)
            current_len += lengths[i]

    if current_chars:
        groups.append((current_start, units[-1][1], current_chars))

    # Merge tail if too many groups
    while len(groups) > desired_count:
        tail = groups.pop()
        if tail:
            prev = list(groups[-1])
            prev[2].extend(tail[2])
            prev = (prev[0], tail[1], prev[2])
            groups[-1] = prev
    return groups


def split_long_unit(unit: Unit, max_vis: float) -> List[Unit]:
    """Split a unit by visual length when it has no clause delimiters."""
    s_idx, _, chars = unit
    subunits: List[Unit] = []
    cur: List[str] = []
    cur_start = s_idx
    cur_len = 0.0
    for offset, ch in enumerate(chars):
        cur.append(ch)
        cur_len += visual_length(ch)
        if cur_len >= max_vis:
            subunits.append((cur_start, s_idx + offset, cur))
            cur = []
            cur_start = s_idx + offset + 1
            cur_len = 0.0
    if cur:
        subunits.append((cur_start, s_idx + len(chars) - 1, cur))
    return subunits


def segment_script(
    script_norm: List[str],
    times: List[float],
    config: dict,
) -> List[Unit]:
    """Segment normalized script into subtitle units."""
    max_seg_sec = config.get("maxSegmentSeconds", 3.2)
    min_seg_sec = config.get("minSegmentSeconds", 0.9)
    max_vis = config.get("maxVisualLength", 26)

    # 1. Sentence-level split
    sentence_units = split_by_delimiters(script_norm, 0, re.compile(r"[。！？!?；;—]"))
    # 2. Clause-level split within each sentence
    all_units: List[Unit] = []
    for sent in sentence_units:
        all_units.extend(split_by_delimiters(sent[2], sent[0], re.compile(r"[，、：,:]")))

    result: List[Unit] = []
    for s_idx, e_idx, chars in all_units:
        text = "".join(chars)
        duration = times[e_idx] - times[s_idx]
        vis_len = visual_length(text)

        if duration <= 2.4 and vis_len <= max_vis * 1.2:
            result.append((s_idx, e_idx, chars))
            continue

        # Try clause-level sub-split
        subunits = split_by_delimiters(chars, s_idx, re.compile(r"[，、：,:]"))
        if len(subunits) <= 1:
            subunits = split_long_unit((s_idx, e_idx, chars), max_vis)

        # Desired segment count
        by_dur = max(1, int(duration / max_seg_sec))
        by_len = max(1, int(vis_len / (max_vis * 1.2)))
        max_by_dur = max(1, int(duration / min_seg_sec))
        desired = max(1, min(max(by_dur, by_len), max_by_dur, len(subunits)))

        grouped = group_units(subunits, desired)
        result.extend(grouped)

    return result


def build_cues(
    script_chars: List[str],
    times: List[float],
    config: dict,
) -> Tuple[List[Cue], List[dict]]:
    units = segment_script(script_chars, times, config)

    cues: List[Cue] = []
    word_cues: List[dict] = []
    for s_idx, e_idx, chars in units:
        text = "".join(chars).strip()
        if not text:
            continue
        # Collapse multiple spaces and remove spaces before CJK punctuation
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r" ([，。、：；！？])", r"\1", text)
        cues.append(
            Cue(
                index=len(cues) + 1,
                start=fmt_time(times[s_idx]),
                end=fmt_time(times[e_idx]),
                text=text,
            )
        )
        word_cues.append(
            {
                "index": len(word_cues) + 1,
                "start": round(float(times[s_idx]), 3),
                "end": round(float(times[e_idx]), 3),
                "text": text,
                "words": build_cue_words(chars, s_idx, e_idx, times),
            }
        )
    return cues, word_cues


# ---------------------------------------------------------------------------
# Word-level (karaoke) tokenization
# ---------------------------------------------------------------------------

def is_latin_char(ch: str) -> bool:
    return bool(re.match(r"[A-Za-z0-9]", ch))


def is_cjk_char(ch: str) -> bool:
    return "一" <= ch <= "鿿"


def tokenize_chars(items: List[Tuple[str, int]]) -> List[List[Tuple[str, int]]]:
    """Group (char, abs_idx) items into karaoke tokens.

    Rules: latin/digit runs stay whole; CJK runs split into 2-char tokens
    (a run of 3 stays whole, so no lone trailing char is produced); any
    other character (punctuation, symbols) attaches to the previous token.
    """
    tokens: List[List[Tuple[str, int]]] = []
    i = 0
    n = len(items)
    while i < n:
        ch = items[i][0]
        if is_latin_char(ch):
            j = i
            while j < n and is_latin_char(items[j][0]):
                j += 1
            tokens.append(items[i:j])
            i = j
        elif is_cjk_char(ch):
            j = i
            while j < n and is_cjk_char(items[j][0]):
                j += 1
            run = items[i:j]
            k = 0
            while k < len(run):
                take = 3 if len(run) - k == 3 else 2
                tokens.append(run[k : k + take])
                k += take
            i = j
        else:
            if tokens:
                tokens[-1].append(items[i])
            else:
                tokens.append([items[i]])
            i += 1
    return tokens


def build_cue_words(
    chars: List[str],
    s_idx: int,
    e_idx: int,
    times: List[float],
) -> List[dict]:
    """Build word-level tokens with timings for one cue."""
    items = [(ch, s_idx + off) for off, ch in enumerate(chars) if not ch.isspace()]
    tokens = tokenize_chars(items)

    words: List[dict] = []
    for pos, token in enumerate(tokens):
        text = "".join(c for c, _ in token)
        if not text:
            continue
        start = float(times[token[0][1]])
        if pos + 1 < len(tokens):
            end = float(times[tokens[pos + 1][0][1]])
        else:
            end = float(times[e_idx])
        words.append(
            {
                "text": text,
                "start": round(start, 3),
                "end": round(max(end, start), 3),
            }
        )
    return words


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

def write_srt(path: str, cues: List[Cue]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for cue in cues:
            f.write(f"{cue.index}\n{cue.start} --> {cue.end}\n{cue.text}\n\n")


def write_words_json(path: str, word_cues: List[dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(word_cues, f, ensure_ascii=False, indent=2)


def load_segmentation_config() -> dict:
    env = os.environ.get("SUBTITLE_SEGMENTATION_JSON", "")
    defaults = {"maxSegmentSeconds": 3.2, "minSegmentSeconds": 0.9, "maxVisualLength": 26}
    if env:
        try:
            return {**defaults, **json.loads(env)}
        except Exception:
            pass
    return defaults


import os  # noqa: E402


def main():
    if len(sys.argv) not in (4, 5):
        print(
            "Usage: align_subtitles.py <script.txt> <whisper.json|whisper.srt> <output.srt> [words.json]"
        )
        sys.exit(1)

    script_path, whisper_path, srt_out = sys.argv[1:4]
    words_out = sys.argv[4] if len(sys.argv) == 5 else None

    with open(script_path, "r", encoding="utf-8") as f:
        script_text = f.read().strip()

    if whisper_path.lower().endswith(".json"):
        whisper_ticks = parse_whisper_json(whisper_path)
    else:
        whisper_ticks = parse_whisper_srt(whisper_path)

    if not whisper_ticks:
        print("❌ No Whisper characters found", file=sys.stderr)
        sys.exit(1)

    script_chars_all = list(script_text)
    script_norm, script_mapping = normalize_with_mapping(script_text)
    whisper_norm = [t.char for t in whisper_ticks]

    print(f"📄 Script chars: {len(script_norm)}, Whisper chars: {len(whisper_norm)}")

    try:
        non_space_times = map_script_to_whisper(
            script_norm, whisper_norm, whisper_ticks, min_ratio=0.65
        )
    except ValueError as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(2)

    all_times = fill_space_times(script_chars_all, script_mapping, non_space_times)

    config = load_segmentation_config()
    cues, word_cues = build_cues(script_chars_all, all_times, config)

    write_srt(srt_out, cues)
    print(f"✅ Aligned {len(cues)} cues -> {srt_out}")

    if words_out:
        write_words_json(words_out, word_cues)
        print(f"✅ Word-level timings -> {words_out}")


if __name__ == "__main__":
    main()
