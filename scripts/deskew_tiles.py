"""Deskew and crop tiles using manually-clicked corner coordinates.

Reads padded tile images and corner data, applies per-tile perspective
correction to produce clean, rectangular tile images.
"""

import json
from pathlib import Path
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PADDED_DIR = PROJECT_ROOT / "web" / "tiles_padded"
OUTPUT_DIR = PROJECT_ROOT / "web" / "tiles_clean"

# Target tile size (square output)
TILE_SIZE = 400

# Corner data from the interactive tool (pasted by user)
CORNERS = {"cherries":[{"x":36,"y":43},{"x":410,"y":50},{"x":414,"y":415},{"x":42,"y":408}],"ellipse":[{"x":49,"y":84},{"x":413,"y":94},{"x":412,"y":452},{"x":50,"y":445}],"sparrow":[{"x":49,"y":97},{"x":404,"y":112},{"x":400,"y":465},{"x":49,"y":454}],"beetle":[{"x":52,"y":91},{"x":399,"y":101},{"x":393,"y":453},{"x":52,"y":445}],"black_haired_boy":[{"x":38,"y":15},{"x":417,"y":25},{"x":419,"y":388},{"x":48,"y":386}],"ant":[{"x":53,"y":55},{"x":416,"y":59},{"x":419,"y":419},{"x":56,"y":414}],"diamonds":[{"x":55,"y":63},{"x":408,"y":74},{"x":405,"y":429},{"x":53,"y":419}],"triangle":[{"x":58,"y":53},{"x":402,"y":62},{"x":400,"y":411},{"x":57,"y":404}],"lion":[{"x":52,"y":34},{"x":426,"y":41},{"x":426,"y":402},{"x":58,"y":398}],"bananas":[{"x":60,"y":62},{"x":423,"y":69},{"x":425,"y":428},{"x":63,"y":422}],"cardinal":[{"x":58,"y":68},{"x":410,"y":77},{"x":407,"y":430},{"x":59,"y":426}],"tulip":[{"x":65,"y":52},{"x":409,"y":60},{"x":407,"y":405},{"x":63,"y":403}],"red_haired_boy":[{"x":47,"y":60},{"x":419,"y":62},{"x":421,"y":422},{"x":52,"y":421}],"canary":[{"x":54,"y":80},{"x":418,"y":87},{"x":421,"y":442},{"x":60,"y":442}],"dice":[{"x":56,"y":84},{"x":410,"y":89},{"x":404,"y":439},{"x":55,"y":434}],"rabbit":[{"x":58,"y":61},{"x":403,"y":66},{"x":401,"y":413},{"x":55,"y":411}],"red_circle":[{"x":55,"y":42},{"x":424,"y":43},{"x":428,"y":402},{"x":60,"y":405}],"hexagon":[{"x":65,"y":65},{"x":427,"y":66},{"x":428,"y":419},{"x":66,"y":420}],"skipping_rope":[{"x":57,"y":57},{"x":407,"y":59},{"x":407,"y":408},{"x":57,"y":405}],"bee":[{"x":57,"y":31},{"x":403,"y":36},{"x":403,"y":383},{"x":60,"y":381}],"lemon":[{"x":69,"y":49},{"x":440,"y":52},{"x":441,"y":410},{"x":72,"y":408}],"daisy":[{"x":435,"y":415},{"x":75,"y":415},{"x":76,"y":64},{"x":438,"y":63}],"checkerboard":[{"x":66,"y":52},{"x":415,"y":52},{"x":415,"y":402},{"x":65,"y":401}],"sunflower":[{"x":69,"y":27},{"x":414,"y":29},{"x":411,"y":376},{"x":67,"y":375}],"roller_skate":[{"x":77,"y":111},{"x":446,"y":111},{"x":446,"y":467},{"x":81,"y":470}],"grasshopper":[{"x":79,"y":119},{"x":438,"y":116},{"x":436,"y":472},{"x":79,"y":470}],"owls":[{"x":67,"y":101},{"x":415,"y":100},{"x":419,"y":450},{"x":67,"y":456}],"parrot":[{"x":65,"y":87},{"x":408,"y":82},{"x":410,"y":425},{"x":70,"y":433}],"peacock":[{"x":60,"y":59},{"x":429,"y":58},{"x":427,"y":412},{"x":58,"y":421}],"strawberry":[{"x":61,"y":61},{"x":421,"y":57},{"x":421,"y":411},{"x":60,"y":413}],"doll":[{"x":54,"y":43},{"x":404,"y":43},{"x":405,"y":390},{"x":55,"y":396}],"baby_carriage":[{"x":52,"y":22},{"x":395,"y":19},{"x":397,"y":363},{"x":54,"y":369}],"flag":[{"x":78,"y":75},{"x":430,"y":65},{"x":432,"y":410},{"x":78,"y":412}],"rose":[{"x":70,"y":71},{"x":429,"y":68},{"x":429,"y":407},{"x":69,"y":411}],"tiger":[{"x":59,"y":55},{"x":412,"y":50},{"x":411,"y":398},{"x":61,"y":405}],"stripes":[{"x":58,"y":32},{"x":400,"y":22},{"x":404,"y":372},{"x":59,"y":379}]}


def compute_perspective_coefficients(src_corners, dst_corners):
    """Compute the 8 coefficients for a perspective transform."""
    matrix = []
    for (x, y), (X, Y) in zip(src_corners, dst_corners):
        matrix.append([x, y, 1, 0, 0, 0, -X * x, -X * y])
        matrix.append([0, 0, 0, x, y, 1, -Y * x, -Y * y])

    rhs = []
    for (X, Y) in dst_corners:
        rhs.append(X)
        rhs.append(Y)

    A = [row + [r] for row, r in zip(matrix, rhs)]
    n = 8
    for col in range(n):
        max_row = max(range(col, n), key=lambda r: abs(A[r][col]))
        A[col], A[max_row] = A[max_row], A[col]
        pivot = A[col][col]
        for row in range(col + 1, n):
            factor = A[row][col] / pivot
            for j in range(col, n + 1):
                A[row][j] -= factor * A[col][j]

    coeffs = [0.0] * n
    for row in range(n - 1, -1, -1):
        coeffs[row] = A[row][n]
        for j in range(row + 1, n):
            coeffs[row] -= A[row][j] * coeffs[j]
        coeffs[row] /= A[row][row]

    return tuple(coeffs)


def deskew_tile(img, src_corners):
    """Perspective-correct a tile given its 4 corner points."""
    dst_corners = [
        (0, 0),
        (TILE_SIZE, 0),
        (TILE_SIZE, TILE_SIZE),
        (0, TILE_SIZE),
    ]

    src_tuples = [(c["x"], c["y"]) for c in src_corners]
    coeffs = compute_perspective_coefficients(dst_corners, src_tuples)

    result = img.transform(
        (TILE_SIZE, TILE_SIZE),
        Image.PERSPECTIVE,
        coeffs,
        Image.BICUBIC,
    )
    return result


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Deskewing {len(CORNERS)} tiles...")

    for name, corners in CORNERS.items():
        padded_path = PADDED_DIR / f"{name}.png"
        if not padded_path.exists():
            print(f"  {name}: MISSING padded image, skipping")
            continue

        img = Image.open(padded_path)
        result = deskew_tile(img, corners)

        out_path = OUTPUT_DIR / f"{name}.png"
        result.save(out_path)
        print(f"  {name}: {img.size} -> {result.size}")

    print(f"\nDone! Deskewed tiles saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
