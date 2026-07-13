#!/usr/bin/env python3
"""Align Whisper SRT with original script text to fix ASR errors."""
import re
import sys
import difflib
from dataclasses import dataclass


@dataclass
class Cue:
    index: int
    start: str
    end: str
    text: str


def parse_srt(path: str) -> list[Cue]:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    blocks = re.split(r"\n\n+", content)
    cues = []
    for block in blocks:
        lines = block.split("\n")
        if len(lines) < 3:
            continue
        index = lines[0].strip()
        time_line = lines[1].strip()
        text = " ".join(lines[2:]).strip()
        m = re.match(
            r"(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})",
            time_line,
        )
        if not m:
            continue
        cues.append(Cue(index=index, start=m.group(1), end=m.group(2), text=text))
    return cues


def write_srt(path: str, cues: list[Cue]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for cue in cues:
            f.write(f"{cue.index}\n{cue.start} --> {cue.end}\n{cue.text}\n\n")


def align_text(original: str, whisper: str) -> list[tuple[int, int, int, int]]:
    """Return list of (orig_start, orig_end, whisper_start, whisper_end) aligned blocks."""
    sm = difflib.SequenceMatcher(None, whisper, original, autojunk=False)
    return [
        (block.b, block.b + block.size, block.a, block.a + block.size)
        for block in sm.get_matching_blocks()
        if block.size > 0
    ]


def map_whisper_range_to_original(
    w_start: int, w_end: int, aligned_blocks: list[tuple[int, int, int, int]]
) -> tuple[int, int]:
    """Map a character range in whisper text to the corresponding range in original text."""
    orig_parts = []
    for o_start, o_end, aw_start, aw_end in aligned_blocks:
        # overlap between [w_start, w_end] and [aw_start, aw_end]
        overlap_start = max(w_start, aw_start)
        overlap_end = min(w_end, aw_end)
        if overlap_start < overlap_end:
            ratio = (o_end - o_start) / (aw_end - aw_start)
            local_start = overlap_start - aw_start
            local_end = overlap_end - aw_start
            mapped_start = o_start + int(local_start * ratio)
            mapped_end = o_start + int(local_end * ratio)
            orig_parts.append((mapped_start, mapped_end))

    if not orig_parts:
        return 0, 0

    return orig_parts[0][0], orig_parts[-1][1]


def main():
    if len(sys.argv) != 4:
        print("Usage: align_subtitles.py <script.txt> <input.srt> <output.srt>")
        sys.exit(1)

    script_path, srt_in, srt_out = sys.argv[1:4]

    with open(script_path, "r", encoding="utf-8") as f:
        original = f.read().strip()

    cues = parse_srt(srt_in)
    if not cues:
        print("No cues found")
        sys.exit(1)

    whisper_text = "".join(c.text for c in cues)
    aligned_blocks = align_text(original, whisper_text)

    # Build character offset map for each cue in whisper_text
    char_pos = 0
    new_cues = []
    for cue in cues:
        w_start = char_pos
        w_end = char_pos + len(cue.text)
        o_start, o_end = map_whisper_range_to_original(
            w_start, w_end, aligned_blocks
        )
        corrected = original[o_start:o_end].strip()
        if not corrected:
            corrected = cue.text
        new_cues.append(
            Cue(index=cue.index, start=cue.start, end=cue.end, text=corrected)
        )
        char_pos = w_end

    write_srt(srt_out, new_cues)
    print(f"Aligned {len(new_cues)} cues -> {srt_out}")


if __name__ == "__main__":
    main()
