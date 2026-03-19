"""Remove the off-white background from cropped tile images.

Strategy:
1. Convert to RGBA
2. Flood-fill from all four corners to find the background region
3. Expand the fill slightly to catch anti-aliased edges
4. Set background pixels to transparent
5. Trim to the bounding box of remaining opaque pixels (with padding)
"""

from pathlib import Path
from PIL import Image
from collections import deque

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TILES_DIR = PROJECT_ROOT / "web" / "tiles"
OUTPUT_DIR = PROJECT_ROOT / "web" / "tiles_clean"

# How close a pixel must be to the seed color to count as background.
# Higher = more aggressive removal. Tuned for off-white tile surfaces.
TOLERANCE = 40

# Padding around the trimmed artwork (pixels)
TRIM_PADDING = 8


def color_distance(c1, c2):
    """Euclidean distance in RGB space."""
    return ((c1[0]-c2[0])**2 + (c1[1]-c2[1])**2 + (c1[2]-c2[2])**2) ** 0.5


def flood_fill_mask(img, seed_points, tolerance):
    """Flood-fill from seed points, returning a set of background pixel coords."""
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

        px = pixels[x, y][:3]
        if color_distance(px, seed_color) > tolerance:
            continue

        visited.add((x, y))
        background.add((x, y))

        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            if (nx, ny) not in visited:
                queue.append((nx, ny, seed_color))

    return background


def expand_mask(mask, width, height, iterations=2):
    """Dilate the mask by a few pixels to catch anti-aliased edges."""
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


def clean_border(img, border_width=15):
    """Remove brown/tan table and tile-edge pixels from the image border.

    The physical tile edges (rounded corners, wood table showing through gaps)
    often survive flood fill because artwork blocks the path from corners.
    This targets specifically the brownish/tan colors of the table and tile
    edges, leaving white and colored artwork intact.
    """
    w, h = img.size
    pixels = img.load()

    for x in range(w):
        for y in range(h):
            # Only process pixels in the border region
            if not (x < border_width or x >= w - border_width or
                    y < border_width or y >= h - border_width):
                continue

            r, g, b, a = pixels[x, y]
            if a == 0:
                continue

            # Detect brown/tan table and tile edge colors:
            # These have R > G > B with low-medium brightness
            brightness = (r + g + b) / 3
            is_brownish = (r > b + 15 and g > b and brightness < 180 and
                           brightness > 30)

            # Also detect grayish tile edge shadows
            max_c = max(r, g, b)
            min_c = min(r, g, b)
            saturation = (max_c - min_c) / max_c if max_c > 0 else 0
            is_gray_edge = (saturation < 0.12 and 80 < brightness < 175)

            if is_brownish or is_gray_edge:
                pixels[x, y] = (0, 0, 0, 0)

    return img


# Tiles where white artwork touches the edges — flood fill would destroy them.
# These get border cleanup only (no flood fill).
BORDER_ONLY_TILES = {"stripes", "checkerboard", "dice"}

# Tiles needing tighter tolerance because white areas are close to edges
TIGHT_TOLERANCE_TILES = {
    "red_circle": 30,
    "hexagons": 35,
}


def remove_background(img, tile_name=""):
    """Remove background from a tile image, return RGBA with transparency."""
    img = img.convert("RGBA")
    w, h = img.size

    # Some tiles can't use flood fill at all — white artwork touches edges
    if tile_name not in BORDER_ONLY_TILES:
        tolerance = TIGHT_TOLERANCE_TILES.get(tile_name, TOLERANCE)

        # Seed from points along the entire perimeter to reach all background
        # regions, even when artwork blocks paths from corners.
        margin = 3
        step = 20
        seeds = []
        for x in range(margin, w - margin, step):
            seeds.append((x, margin))
            seeds.append((x, h - 1 - margin))
        for y in range(margin, h - margin, step):
            seeds.append((margin, y))
            seeds.append((w - 1 - margin, y))

        bg_mask = flood_fill_mask(img, seeds, tolerance)
        bg_mask = expand_mask(bg_mask, w, h, iterations=1)

        pixels = img.load()
        for x, y in bg_mask:
            pixels[x, y] = (0, 0, 0, 0)

    # Clean up border artifacts (tile edges, shadows, table wood)
    img = clean_border(img)

    return img


def trim_to_content(img, padding=TRIM_PADDING):
    """Trim transparent borders, keeping some padding."""
    bbox = img.getbbox()  # bounding box of non-transparent pixels
    if bbox is None:
        return img

    x1, y1, x2, y2 = bbox
    w, h = img.size

    # Add padding
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(w, x2 + padding)
    y2 = min(h, y2 + padding)

    return img.crop((x1, y1, x2, y2))


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    tile_files = sorted(TILES_DIR.glob("*.png"))
    print(f"Processing {len(tile_files)} tiles...")

    for tile_path in tile_files:
        img = Image.open(tile_path)
        cleaned = remove_background(img, tile_name=tile_path.stem)
        trimmed = trim_to_content(cleaned)

        out_path = OUTPUT_DIR / tile_path.name
        trimmed.save(out_path)

        orig_pixels = img.size[0] * img.size[1]
        bbox = trimmed.getbbox() or (0, 0, 0, 0)
        print(f"  {tile_path.stem}: {img.size} -> {trimmed.size}")

    print(f"\nDone! Cleaned tiles saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
