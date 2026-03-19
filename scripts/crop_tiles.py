"""Extract individual tile images from the source photo.

Applies perspective correction to rectify the camera angle,
then crops the 8x9 grid into individual tile PNGs.
"""

from pathlib import Path
from PIL import Image

# Paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_IMAGE = PROJECT_ROOT / "source_images" / "IMG_6646.jpeg"
OUTPUT_DIR = PROJECT_ROOT / "web" / "tiles"

# Grid dimensions
COLS = 8
ROWS = 9

# Four corners of the tile grid in the source photo (x, y).
# Order: top-left, top-right, bottom-right, bottom-left
SOURCE_CORNERS = [
    (50, 300),    # top-left (first cherry tile outer corner)
    (2975, 235),  # top-right (last beetle tile outer corner)
    (2935, 3650), # bottom-right (last stripes tile outer corner) — extended down
    (55, 3570),   # bottom-left (first flag tile outer corner) — extended down
]

# Target rectangle: width and height for the rectified grid image.
# Use the max span to preserve resolution.
RECT_W = 2920
RECT_H = 3340  # extended to capture full bottom row

TARGET_CORNERS = [
    (0, 0),
    (RECT_W, 0),
    (RECT_W, RECT_H),
    (0, RECT_H),
]

# Tile names: row-by-row, left-to-right.
# Each pair appears side by side, so columns 0+1 are a pair, 2+3, etc.
# We take one tile per pair (the left one: columns 0, 2, 4, 6).
TILE_NAMES = [
    # Row 0
    "cherries", "ellipse", "sparrow", "beetle",
    # Row 1
    "black_haired_boy", "ant", "diamonds", "triangle",
    # Row 2
    "lion", "bananas", "cardinal", "tulip",
    # Row 3
    "red_haired_boy", "canary", "dice", "rabbit",
    # Row 4
    "red_circle", "hexagon", "skipping_rope", "bee",
    # Row 5
    "lemon", "daisy", "checkerboard", "sunflower",
    # Row 6
    "roller_skate", "grasshopper", "owls", "parrot",
    # Row 7
    "peacock", "strawberry", "doll", "baby_carriage",
    # Row 8
    "flag", "rose", "tiger", "stripes",
]


def compute_perspective_coefficients(src_corners, dst_corners):
    """Compute the 8 coefficients for a perspective transform.

    Uses the standard approach of solving 8 linear equations
    for the projective mapping from src to dst quadrilateral.
    """
    # Build the system of equations: for each point pair (src -> dst),
    # x' = (a*x + b*y + c) / (g*x + h*y + 1)
    # y' = (d*x + e*y + f) / (g*x + h*y + 1)
    #
    # Rearranged: a*x + b*y + c - g*x*x' - h*y*x' = x'
    #             d*x + e*y + f - g*x*y' - h*y*y' = y'
    matrix = []
    for (x, y), (X, Y) in zip(src_corners, dst_corners):
        matrix.append([x, y, 1, 0, 0, 0, -X * x, -X * y])
        matrix.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])

    # Right-hand side
    rhs = []
    for (X, Y) in dst_corners:
        rhs.append(X)
        rhs.append(Y)

    # Solve using simple Gaussian elimination (8x8 system)
    A = [row + [r] for row, r in zip(matrix, rhs)]
    n = 8
    for col in range(n):
        # Find pivot
        max_row = max(range(col, n), key=lambda r: abs(A[r][col]))
        A[col], A[max_row] = A[max_row], A[col]
        pivot = A[col][col]
        for row in range(col + 1, n):
            factor = A[row][col] / pivot
            for j in range(col, n + 1):
                A[row][j] -= factor * A[col][j]

    # Back substitution
    coeffs = [0.0] * n
    for row in range(n - 1, -1, -1):
        coeffs[row] = A[row][n]
        for j in range(row + 1, n):
            coeffs[row] -= A[row][j] * coeffs[j]
        coeffs[row] /= A[row][row]

    return tuple(coeffs)


def rectify_image(img):
    """Apply perspective transform to straighten the tile grid."""
    coeffs = compute_perspective_coefficients(TARGET_CORNERS, SOURCE_CORNERS)
    rectified = img.transform(
        (RECT_W, RECT_H),
        Image.PERSPECTIVE,
        coeffs,
        Image.BICUBIC,
    )
    return rectified


def crop_tiles(rectified):
    """Crop individual tiles from the rectified grid image.

    Uses manually-calibrated gap positions (from grid_tool.html) rather
    than assuming uniform spacing — the physical tiles aren't evenly spaced.
    """
    # Column and row edges from the grid calibration tool.
    # These are the gap centers between tiles in the rectified image.
    col_edges = [0, 428, 796, 1168, 1528, 1884, 2236, 2588, 2920]
    row_edges = [0, 452, 808, 1160, 1540, 1896, 2216, 2628, 2980, 3340]

    # Inset from each cell edge to avoid gap/neighbor bleed (pixels)
    inset = 12

    # Per-tile crop adjustments: (dx1, dy1, dx2, dy2) added to the
    # default crop box. Positive dx1/dy1 = crop more from left/top,
    # negative dx2/dy2 = crop more from right/bottom.
    adjustments = {
        "ellipse": (0, 30, -15, 0),        # trim table bleed at top-right
        "checkerboard": (0, -10, 0, 0),   # extend up to show full pattern
        "stripes": (30, 0, 0, -45),       # trim bleed at bottom-left
        "baby_carriage": (0, 0, 0, -5),   # trim slight bleed at bottom
    }

    tiles = {}
    name_idx = 0
    for row in range(ROWS):
        for col in range(0, COLS, 2):  # left tile of each pair
            name = TILE_NAMES[name_idx]
            dx1, dy1, dx2, dy2 = adjustments.get(name, (0, 0, 0, 0))

            x1 = col_edges[col] + inset + dx1
            y1 = row_edges[row] + inset + dy1
            x2 = col_edges[col + 1] - inset + dx2
            y2 = row_edges[row + 1] - inset + dy2

            tile = rectified.crop((x1, y1, x2, y2))
            tiles[name] = tile
            name_idx += 1

    return tiles


def main():
    print(f"Loading {SOURCE_IMAGE}")
    img = Image.open(SOURCE_IMAGE)

    print("Applying perspective correction...")
    rectified = rectify_image(img)
    rectified.save(OUTPUT_DIR.parent / "rectified_debug.png")
    print(f"  Saved debug rectified image")

    print(f"Cropping {len(TILE_NAMES)} tiles...")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tiles = crop_tiles(rectified)

    for name, tile_img in tiles.items():
        out_path = OUTPUT_DIR / f"{name}.png"
        tile_img.save(out_path)
        print(f"  {name}: {tile_img.size}")

    print(f"\nDone! {len(tiles)} tiles saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
