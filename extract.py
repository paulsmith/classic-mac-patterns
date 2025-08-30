#!/usr/bin/env python3
"""
Extract 8x8 B&W QuickDraw patterns from DeRez output of a PAT# resource.

Usage:
  python extract.py path/to/patterns.r --outdir out

- Supports multiple `data 'PAT#' (ID, ...) { ... };` blocks per file.
- Writes NetPBM (.pbm) files for archival and sprite sheets for reference.
"""

import argparse
import re
from pathlib import Path

try:
    from PIL import Image
except ImportError as e:
    raise SystemExit(
        "This script requires Pillow. Install it with: pip install pillow"
    ) from e


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
        raise ValueError(
            f"PAT# truncated: count={count}, need {expected} bytes, got {len(raw)}."
        )
    if len(raw) > expected:
        # Some tools might append padding; warn but proceed.
        extra = len(raw) - expected
        print(
            f"[warn] PAT# has {extra} trailing byte(s) beyond the declared count; ignoring."
        )

    patterns = []
    off = 2
    for _ in range(count):
        patterns.append(raw[off : off + 8])
        off += 8
    return patterns


def pattern_to_image(rows: bytes) -> Image.Image:
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
    return img


def write_pbm(rows: bytes, out_path: Path):
    """Write pattern as NetPBM (PBM) format for archival."""
    with open(out_path, "w") as f:
        f.write("P1\n")
        f.write("8 8\n")

        for byte in rows:
            bits = []
            for x in range(8):
                bit = (byte >> (7 - x)) & 1  # MSB first
                # In PBM: 0=white, 1=black (opposite of QuickDraw's meaning)
                bits.append(str(bit))
            f.write(" ".join(bits) + "\n")


def save_sprite_sheet(images, cols: int, out_path: Path):
    """Save a clean sprite sheet of patterns."""
    if not images:
        return
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("1", (cols * 8, rows * 8), 1)
    for i, im in enumerate(images):
        r, c = divmod(i, cols)
        sheet.paste(im, (c * 8, r * 8))
    sheet.save(out_path)


def save_labeled_sprite_sheet(images, cols: int, out_path: Path, scale: int = 4):
    """Save a labeled sprite sheet with borders and pattern indices."""
    if not images:
        return
    rows = (len(images) + cols - 1) // cols
    # Scale patterns and add space for labels
    pattern_size = 8 * scale
    label_height = 12  # Space for index numbers
    cell_w = pattern_size + 2  # Pattern + small border
    cell_h = pattern_size + label_height + 2
    sheet = Image.new("1", (cols * cell_w, rows * cell_h), 1)

    # Create drawing context
    try:
        from PIL import ImageDraw, ImageFont

        draw = ImageDraw.Draw(sheet)
        font = ImageFont.load_default()
    except ImportError:
        draw = None

    for i, im in enumerate(images):
        r, c = divmod(i, cols)
        x, y = c * cell_w + 1, r * cell_h + 1

        # Scale and paste the pattern
        scaled_pattern = im.resize((pattern_size, pattern_size), Image.NEAREST)
        sheet.paste(scaled_pattern, (x, y))

        # Add index label below pattern
        if draw:
            label_y = y + pattern_size + 2
            # Draw index number
            draw.text((x, label_y), str(i), fill=0, font=font)

    sheet.save(out_path)


def main():
    ap = argparse.ArgumentParser(
        description="Extract QuickDraw PAT# patterns from DeRez output."
    )
    ap.add_argument("rfile", help="Path to DeRez output file")
    ap.add_argument(
        "--outdir",
        default="patterns",
        help="Directory to write PBM files and sprite sheets",
    )
    args = ap.parse_args()

    txt = Path(args.rfile).read_text(encoding="latin-1")

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    any_found = False
    for m in PATBLOCK_RE.finditer(txt):
        resid = int(m.group(1))

        any_found = True
        body = m.group(2)
        raw = parse_derez_patsharp_bytes(body)
        patterns = decode_patsharp(raw)

        # Generate images and write PBM files in single loop
        imgs = []
        for i, rows in enumerate(patterns):
            # Create image for sprite sheet
            imgs.append(pattern_to_image(rows))

            # Write archival PBM file
            pbm_path = outdir / f"pattern_{i:02d}.pbm"
            write_pbm(rows, pbm_path)

        # Generate sprite sheets (8 columns)
        save_sprite_sheet(imgs, 8, outdir / f"patsharp_{resid}_sheet.png")
        save_labeled_sprite_sheet(
            imgs, 8, outdir / f"patsharp_{resid}_sheet_labeled.png"
        )

        print(f"[ok] Exported {len(patterns)} patterns from PAT#({resid}) to {outdir}")

    if not any_found:
        raise SystemExit(
            "No PAT# blocks found. Are you sure this is DeRez output for 'PAT#'?"
        )


if __name__ == "__main__":
    main()
