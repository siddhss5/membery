"""Convert deskewed tile PNGs to SVG using vtracer.

vtracer produces high-quality color vector traces — ideal for the bold
outlines and flat colors of these game tiles.
"""

from pathlib import Path
import vtracer

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUT_DIR = PROJECT_ROOT / "web" / "tiles_clean"
OUTPUT_DIR = PROJECT_ROOT / "web" / "tiles_svg"


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    png_files = sorted(INPUT_DIR.glob("*.png"))
    print(f"Vectorizing {len(png_files)} tiles...")

    for png_path in png_files:
        svg_path = OUTPUT_DIR / f"{png_path.stem}.svg"

        vtracer.convert_image_to_svg_py(
            image_path=str(png_path),
            out_path=str(svg_path),
            colormode="color",
            hierarchical="stacked",
            mode="polygon",
            filter_speckle=4,
            color_precision=6,
            layer_difference=16,
            corner_threshold=60,
            length_threshold=4.0,
            max_iterations=10,
            splice_threshold=45,
            path_precision=3,
        )

        png_size = png_path.stat().st_size
        svg_size = svg_path.stat().st_size
        ratio = svg_size / png_size
        print(f"  {png_path.stem}: {png_size//1024}KB png -> {svg_size//1024}KB svg ({ratio:.1f}x)")

    print(f"\nDone! SVGs saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
