#!/usr/bin/env python3
"""
Extract 8x8 B&W QuickDraw patterns from DeRez output of a PAT# resource.

Usage:
  python extract_patsharp_derez.py path/to/patterns.r --outdir out --scale 16 --sprite-cols 8

- Supports multiple `data 'PAT#' (ID, ...) { ... };` blocks per file.
- Writes individual PNGs and an optional sprite sheet per resource ID.
"""

import argparse
import os
import re
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit("This script requires Pillow. Install it with: pip install pillow") from e


PATBLOCK_RE = re.compile(
    r"data\s+'PAT#'\s*\(\s*(\d+)\s*[^)]*\)\s*\{\s*(.*?)\s*\};",
    re.DOTALL | re.IGNORECASE,
)

HEXSTR_RE = re.compile(r'\$\s*"(.*?)"', re.DOTALL)


def parse_derez_patsharp_bytes(block_text: str) -> bytes:
    """
    Given the inside of a DeRez data block, extract and concatenate all $"...":
    Returns raw bytes in resource order.
    """
    hex_chunks = HEXSTR_RE.findall(block_text)
    if not hex_chunks:
        return b""

    # Concatenate all $"..." contents, strip spaces/newlines, keep only hex digits
    hex_only = []
    for chunk in hex_chunks:
        # Remove whitespace and non-hex separators
        cleaned = re.sub(r"[^0-9A-Fa-f]", "", chunk)
        hex_only.append(cleaned)

    hex_str = "".join(hex_only)
    if len(hex_str) % 2 != 0:
        raise ValueError("Odd number of hex digits found; input may be malformed.")

    return bytes(int(hex_str[i : i + 2], 16) for i in range(0, len(hex_str), 2))


def decode_patsharp(raw: bytes):
    """
    Decode PAT# bytes: [u16_be count] + count * 8 bytes (each pattern is 8 rows).
    Returns list of 8-byte patterns (each entry is 'bytes' of length 8).
    """
    if len(raw) < 2:
        raise ValueError("PAT# too short to contain count.")
    count = int.from_bytes(raw[:2], "big")
    expected = 2 + count * 8
    if len(raw) < expected:
        raise ValueError(f"PAT# truncated: count={count}, need {expected} bytes, got {len(raw)}.")
    if len(raw) > expected:
        # Some tools might append padding; warn but proceed.
        extra = len(raw) - expected
        print(f"[warn] PAT# has {extra} trailing byte(s) beyond the declared count; ignoring.")

    patterns = []
    off = 2
    for _ in range(count):
        patterns.append(raw[off : off + 8])
        off += 8
    return patterns


def pattern_to_image(rows: bytes, scale: int = 16) -> Image.Image:
    """
    Convert 8 row bytes into a PIL 1-bit image (black ink on white).
    QuickDraw bit order: MSB is leftmost pixel.
    """
    img = Image.new("1", (8, 8), 1)  # 1 = white
    px = img.load()
    for y, byte in enumerate(rows):
        for x in range(8):
            bit = (byte >> (7 - x)) & 1  # MSB first
            # In QuickDraw, 1 = "ink" (black). In '1' mode, 0=black, 1=white.
            px[x, y] = 0 if bit else 1
    if scale and scale != 1:
        img = img.resize((8 * scale, 8 * scale), Image.NEAREST)
    return img


def save_sprite_sheet(images, cols: int, out_path: Path):
    if not images:
        return
    scale = images[0].size[0] // 8
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("1", (cols * 8 * scale, rows * 8 * scale), 1)
    for i, im in enumerate(images):
        r, c = divmod(i, cols)
        sheet.paste(im, (c * 8 * scale, r * 8 * scale))
    sheet.save(out_path)


def main():
    ap = argparse.ArgumentParser(description="Extract QuickDraw PAT# patterns from DeRez output.")
    ap.add_argument("rfile", help="Path to DeRez output file")
    ap.add_argument("--outdir", default="patsharp_out", help="Directory to write outputs")
    ap.add_argument("--scale", type=int, default=16, help="Integer scale factor for PNGs (default: 16)")
    ap.add_argument("--sprite-cols", type=int, default=8, help="Columns in sprite sheet (0 to skip sheet)")
    ap.add_argument("--select-id", type=int, default=None, help="If given, only export this PAT# resource ID")
    args = ap.parse_args()

    txt = Path(args.rfile).read_text(encoding="latin-1")

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    any_found = False
    for m in PATBLOCK_RE.finditer(txt):
        resid = int(m.group(1))
        if args.select_id is not None and resid != args.select_id:
            continue

        any_found = True
        body = m.group(2)
        raw = parse_derez_patsharp_bytes(body)
        patterns = decode_patsharp(raw)

        res_dir = outdir / f"PATsharp_{resid}"
        res_dir.mkdir(exist_ok=True)

        imgs = []
        for i, rows in enumerate(patterns):
            im = pattern_to_image(rows, args.scale)
            im.save(res_dir / f"pattern_{i:02d}.png")
            imgs.append(im)

            # Also write a tiny text file of the row bytes (handy for inspection)
            with open(res_dir / f"pattern_{i:02d}.hex", "w") as f:
                f.write(" ".join(f"{b:02X}" for b in rows) + "\n")

        if args.sprite_cols and args.sprite_cols > 0:
            save_sprite_sheet(imgs, args.sprite_cols, res_dir / "sheet.png")

        # Write a summary.txt
        with open(res_dir / "summary.txt", "w") as f:
            f.write(f"PAT# resource ID: {resid}\n")
            f.write(f"Patterns: {len(patterns)}\n")
            f.write(f"Scale: {args.scale}\n")

        print(f"[ok] Exported {len(patterns)} patterns from PAT#({resid}) into {res_dir}")

    if not any_found:
        raise SystemExit("No PAT# blocks found. Are you sure this is DeRez output for 'PAT#'?")

if __name__ == "__main__":
    main()
