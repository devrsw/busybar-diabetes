#!/usr/bin/env python3
"""
Generates the trend arrow glide animations in src/animations/.

One .anim per arrow shape, size and palette color, played by the bar's firmware
so the motion is smooth without the app redrawing. The arrow travels along its
direction in a loop, fading in at the start of its path and out at the end,
with sub-pixel smoothing. It moves faster the faster glucose is changing.

Writes the BUSY Bar "bicycle1" .anim format as described in the firmware's
lib/anim_file/anim_file_format.h (see also its scripts/seq2anim.py): BGRA8888,
raw pixels, the first frame whole and later frames as changes from the one
before. No dependencies.

Run from the repo root after changing arrow shapes, colors or timing:

    python3 tools/make_arrow_anims.py
"""

import struct
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "animations"
FPS = 20

# Must match the color options in src/appmeta/settings.json.
COLORS = [
    "FF0000", "FF3000", "FF6000", "FFC000", "FFFF00", "00FF30",
    "00FFC0", "00C0FF", "0060FF", "A040FF", "FF40C0", "FFFFFF",
]

# --- Arrow shapes: must match upArrow / upRightArrow / arrowSet in src/display.ts ---

def up_arrow(width, height, shaft):
    mid = (width - 1) / 2
    grid = []
    for y in range(height):
        reach = y + 0.5 if y < width / 2 else shaft / 2 - 0.5
        grid.append("".join("#" if abs(x - mid) <= reach else "." for x in range(width)))
    return grid

def up_right_arrow(size, thickness):
    grid = []
    for y in range(size):
        line = ""
        for x in range(size):
            head = (y < thickness and x >= thickness) or (x >= size - thickness and y <= size - 3)
            shaft = size - 1 <= x + y <= size + thickness - 2
            line += "#" if head or shaft else "."
        grid.append(line)
    return grid

flip_v = lambda g: g[::-1]
flip_h = lambda g: [line[::-1] for line in g]
transpose = lambda g: ["".join(line[x] for line in g) for x in range(len(g[0]))]
double = lambda g: [f"{line}.{line}" for line in g]

def arrow_set(up, up_right):
    down = flip_v(up)
    return {
        "double_up": double(up),
        "single_up": up,
        "forty_five_up": up_right,
        "flat": flip_h(transpose(up)),
        "forty_five_down": flip_v(up_right),
        "single_down": down,
        "double_down": double(down),
    }

SIZES = {
    "small": arrow_set(up_arrow(8, 10, 2), up_right_arrow(9, 2)),
    "big": arrow_set(up_arrow(12, 12, 4), up_right_arrow(12, 3)),
}

# Direction of travel, as in NUDGE in src/display.ts.
DIRECTION = {
    "double_up": (0, -1), "single_up": (0, -1), "forty_five_up": (1, -1), "flat": (1, 0),
    "forty_five_down": (1, 1), "single_down": (0, 1), "double_down": (0, 1),
}

# Seconds per pass, by Dexcom's rate bands: flat < 1 mg/dL/min, 45° 1-2, single 2-3, double > 3.
PERIOD = {
    "flat": 3.2, "forty_five_up": 2.4, "forty_five_down": 2.4,
    "single_up": 1.6, "single_down": 1.6, "double_up": 1.1, "double_down": 1.1,
}

# How far the arrow travels each way from its resting spot (pixels). The big arrow has less room above and below.
TRAVEL = {"small": 3.0, "big": 2.0}
# Canvas padding along the direction of travel; the app offsets the element by this much.
PAD = 3

# --- Motion ---

def ease_in_out(t):
    return t * t * (3 - 2 * t)

def travel(p, distance):
    """Offset along the direction (px) and brightness (0-1) at cycle phase p in [0, 1).

    Constant speed from -distance to +distance, fading in over the first third of
    the path and out over the last third, so the jump back to the start is unseen."""
    fade = min(1.0, p / 0.3, (1 - p) / 0.3)
    return distance * (2 * p - 1), ease_in_out(fade)

def coverage(grid, ox, oy, width, height):
    """How much of each canvas pixel the grid covers when shifted by (ox, oy): a box filter, for sub-pixel motion."""
    cov = [[0.0] * width for _ in range(height)]
    for gy, line in enumerate(grid):
        for gx, c in enumerate(line):
            if c != "#":
                continue
            left, top = gx + ox, gy + oy
            for y in range(int(top) - 1, int(top) + 2):
                for x in range(int(left) - 1, int(left) + 2):
                    if 0 <= x < width and 0 <= y < height:
                        w = max(0.0, min(left + 1, x + 1) - max(left, x))
                        h = max(0.0, min(top + 1, y + 1) - max(top, y))
                        cov[y][x] += w * h
    return cov

# --- .anim encoding ---

def frame_bytes(pixels, previous):
    """One file frame: everything for the first, then only the pixels that changed."""
    if previous is None:
        mask_enc, mask_bits, mask_data, changed = 1, 0, b"", pixels  # FullyWhite
    else:
        flags = [pixels[i:i + 4] != previous[i:i + 4] for i in range(0, len(pixels), 4)]
        changed = b"".join(pixels[i * 4:i * 4 + 4] for i, f in enumerate(flags) if f)
        if not any(flags):
            mask_enc, mask_bits, mask_data = 0, 0, b""  # FullyBlack: same as the last frame
        elif all(flags):
            mask_enc, mask_bits, mask_data = 1, 0, b""
        else:
            bitmap = bytearray()
            for i in range(0, len(flags), 8):
                byte = 0
                for j, f in enumerate(flags[i:i + 8]):
                    byte |= (128 >> j) if f else 0
                bitmap.append(byte)
            mask_enc, mask_bits, mask_data = 4, len(flags), bytes(bitmap)  # Bitmap
    pixel_enc = 0  # Raw
    header = struct.pack("<BHH", pixel_enc | (mask_enc << 4), mask_bits, len(changed))
    return header + mask_data + changed, mask_bits, len(changed)

def encode(frames, width, height):
    encoded, max_mask, max_pixels, previous = [], 0, 0, None
    for pixels in frames:
        data, mask_bits, pixel_len = frame_bytes(pixels, previous)
        encoded.append(data)
        max_mask, max_pixels, previous = max(max_mask, mask_bits), max(max_pixels, pixel_len), pixels
    header_len = struct.calcsize("<8s BBBB HHBB II II")
    name = b"default\0"
    # The one section starts at the first frame, right after the header and this section.
    section = struct.pack("<III", 0, len(frames) - 1, header_len + 12 + len(name)) + name
    frames_chunk = b"".join(encoded)
    header = struct.pack(
        "<8s BBBB HHBB II II", b"bicycle1",
        0, width, height, 2,  # flags, size, Bgra8888
        max_mask, max_pixels, FPS, 0,
        len(section), len(frames_chunk), 1, len(frames),
    )
    return header + section + frames_chunk

def render(grid, direction, color, period, distance):
    dx, dy = direction
    pad_x, pad_y = (PAD if dx else 0), (PAD if dy else 0)
    width, height = len(grid[0]) + 2 * pad_x, len(grid) + 2 * pad_y
    r, g, b = (int(color[i:i + 2], 16) for i in (0, 2, 4))
    frames = []
    count = round(period * FPS)
    for f in range(count):
        offset, brightness = travel(f / count, distance)
        cov = coverage(grid, pad_x + dx * offset, pad_y + dy * offset, width, height)
        px = bytearray()
        for y in range(height):
            for x in range(width):
                a = round(min(1.0, cov[y][x]) * brightness * 255)
                # Fully transparent pixels are all zero, so unchanged background never counts as a change.
                px.extend((b, g, r, a) if a else (0, 0, 0, 0))
        frames.append(bytes(px))
    return encode(frames, width, height)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("arrow-*.anim"):
        old.unlink()
    total = 0
    for size, arrows in SIZES.items():
        for trend, grid in arrows.items():
            for color in COLORS:
                data = render(grid, DIRECTION[trend], color, PERIOD[trend], TRAVEL[size])
                (OUT / f"arrow-{size}-{trend}-{color}.anim").write_bytes(data)
                total += len(data)
    print(f"wrote {len(SIZES) * 7 * len(COLORS)} animations, {total // 1024} KB, to {OUT}")

if __name__ == "__main__":
    main()
