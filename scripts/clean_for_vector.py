"""Prepare tiles for vectorization by isolating artwork on pure white.

Strategy:
1. Flood-fill from edges to find the background
2. Replace background with pure white
3. Leave the artwork pixels completely untouched
"""

from pathlib import Path
from PIL import Image
from collections import deque

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUT_DIR = PROJECT_ROOT / "web" / "tiles_clean"
OUTPUT_DIR = PROJECT_ROOT / "web" / "tiles_prepped"

TOLERANCE = 40

# Tiles where flood fill would eat white artwork
BORDER_ONLY_TILES = {"stripes", "checkerboard", "dice"}
TIGHT_TOLERANCE = {
    "red_circle": 30,
    "hexagons": 35,
}


def color_distance(c1, c2):
    return ((c1[0]-c2[0])**2 + (c1[1]-c2[1])**2 + (c1[2]-c2[2])**2) ** 0.5


def flood_fill_mask(img, seed_points, tolerance):
    w, h = img.size
    pixels = img.load()
    visited = set()
    background = set()
    queue = deque()

    for sx, sy in seed_points:
        seed_color = pixels[sx, sy][:3]
        queue.append((sx, sy, seed_color))

    while queue:
        x, y, seed_color = queue.popleft()
        if (x, y) in visited:
            continue
        if x < 0 or x >= w or y < 0 or y >= h:
            continue
        visited.add((x, y))

        px = pixels[x, y][:3]
        if color_distance(px, seed_color) > tolerance:
            continue

        background.add((x, y))
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx_, ny_ = x + dx, y + dy
            if (nx_, ny_) not in visited:
                queue.append((nx_, ny_, seed_color))

    return background


def expand_mask(mask, width, height, iterations=1):
    expanded = set(mask)
    for _ in range(iterations):
        new_pixels = set()
        for x, y in expanded:
            for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    new_pixels.add((nx, ny))
        expanded |= new_pixels
    return expanded


def find_background(img, tile_name):
    """Find background pixels via flood fill from perimeter."""
    w, h = img.size

    if tile_name in BORDER_ONLY_TILES:
        # For these tiles, just clean the outer border
        border = set()
        bw = 10
        for x in range(w):
            for y in range(h):
                if x < bw or x >= w - bw or y < bw or y >= h - bw:
                    r, g, b = img.getpixel((x, y))[:3]
                    brightness = (r + g + b) / 3
                    max_c = max(r, g, b)
                    min_c = min(r, g, b)
                    sat = (max_c - min_c) / max_c if max_c > 0 else 0
                    # Only whiten if it looks like background (not artwork)
                    if (brightness > 160 and sat < 0.15) or (sat < 0.12 and 80 < brightness < 175):
                        border.add((x, y))
        return border

    tolerance = TIGHT_TOLERANCE.get(tile_name, TOLERANCE)

    margin = 3
    step = 15
    seeds = []
    for x in range(margin, w - margin, step):
        seeds.append((x, margin))
        seeds.append((x, h - 1 - margin))
    for y in range(margin, h - margin, step):
        seeds.append((margin, y))
        seeds.append((w - 1 - margin, y))

    bg = flood_fill_mask(img, seeds, tolerance)
    bg = expand_mask(bg, w, h, iterations=1)
    return bg


def clean_tile(img, tile_name):
    """Replace background with pure white, leave artwork untouched."""
    img = img.convert("RGB")
    w, h = img.size

    bg_mask = find_background(img, tile_name)

    pixels = img.load()
    for x, y in bg_mask:
        pixels[x, y] = (255, 255, 255)

    return img


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    png_files = sorted(INPUT_DIR.glob("*.png"))
    print(f"Cleaning {len(png_files)} tiles...")

    for png_path in png_files:
        img = Image.open(png_path)
        cleaned = clean_tile(img, png_path.stem)
        out_path = OUTPUT_DIR / png_path.name
        cleaned.save(out_path)
        print(f"  {png_path.stem}")

    print(f"\nDone! Cleaned tiles saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
