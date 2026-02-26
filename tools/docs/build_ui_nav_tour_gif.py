#!/usr/bin/env python3
"""
Build an animated GIF tour for README from the main Node.js UI screens.

The animation simulates a user clicking each left-menu tab:
- Visao geral
- Criar lead (demos)
- Leads
- CRM (Kanban)
- Parceiros
- Configuracoes
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageColor, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
IMG_DIR = ROOT / "docs" / "readme_images"
OUTPUT_GIF = IMG_DIR / "ui-nodejs-tour.gif"


@dataclass(frozen=True)
class Step:
    label: str
    image_name: str
    click_xy: tuple[int, int]


# Coordinates are based on source screenshots captured at 1904x933.
BASE_SIZE = (1904, 933)
STEPS: tuple[Step, ...] = (
    Step("Visao geral", "ui-visao-geral.png", (155, 166)),
    Step("Criar lead (demos)", "ui-criar-lead-demos.png", (155, 222)),
    Step("Leads", "ui-leads.png", (155, 278)),
    Step("CRM (Kanban)", "ui-crm-kanban.png", (155, 334)),
    Step("Parceiros", "ui-parceiros.png", (155, 391)),
    Step("Configuracoes", "ui-configuracoes.png", (155, 446)),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build README UI nav tour GIF.")
    parser.add_argument(
        "--output",
        default=str(OUTPUT_GIF),
        help=f"Output GIF path (default: {OUTPUT_GIF.as_posix()}).",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1440,
        help="Output width in pixels (default: 1440).",
    )
    parser.add_argument(
        "--colors",
        type=int,
        default=160,
        help="Palette color count for GIF compression (default: 160).",
    )
    return parser.parse_args()


def load_font(size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def draw_cursor(frame: Image.Image, x: float, y: float, click_strength: float = 0.0) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")

    px = int(round(x))
    py = int(round(y))
    sx = 17
    sy = 23

    # Cursor shadow
    shadow = [(px + 2, py + 3), (px + 2, py + 3 + sy), (px + 2 + sx, py + 3 + sy * 0.66)]
    draw.polygon(shadow, fill=(0, 0, 0, 120))

    # Cursor body
    points = [(px, py), (px, py + sy), (px + sx, py + int(sy * 0.64))]
    draw.polygon(points, fill=(245, 245, 245, 255), outline=(10, 10, 10, 255))

    if click_strength > 0:
        ring_alpha = int(190 * (1.0 - click_strength))
        ring_radius = int(10 + 24 * click_strength)
        ring_bbox = [px - ring_radius, py - ring_radius, px + ring_radius, py + ring_radius]
        draw.ellipse(ring_bbox, outline=(82, 191, 255, ring_alpha), width=3)


def draw_label(frame: Image.Image, label: str, step_idx: int, total: int) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")
    font = load_font(26)
    small = load_font(18)

    pad_x = 24
    pad_y = 18
    line_gap = 8
    text_1 = "Tour rapido da UI Node.js"
    text_2 = f"Passo {step_idx}/{total}: {label}"

    # Pillow compatibility for text sizing.
    bb1 = draw.textbbox((0, 0), text_1, font=font)
    bb2 = draw.textbbox((0, 0), text_2, font=small)
    box_w = max(bb1[2] - bb1[0], bb2[2] - bb2[0]) + 2 * pad_x
    box_h = (bb1[3] - bb1[1]) + (bb2[3] - bb2[1]) + line_gap + 2 * pad_y

    box = (18, 16, 18 + box_w, 16 + box_h)
    draw.rounded_rectangle(box, radius=14, fill=(6, 16, 33, 184), outline=(85, 172, 255, 185), width=2)
    draw.text((18 + pad_x, 16 + pad_y), text_1, font=font, fill=ImageColor.getrgb("#e8f2ff"))
    draw.text(
        (18 + pad_x, 16 + pad_y + (bb1[3] - bb1[1]) + line_gap),
        text_2,
        font=small,
        fill=ImageColor.getrgb("#9ed0ff"),
    )


def resize_with_width(img: Image.Image, width: int) -> Image.Image:
    if img.width == width:
        return img
    height = int(round(img.height * (width / img.width)))
    return img.resize((width, height), Image.Resampling.LANCZOS)


def scaled_point(point: tuple[int, int], width: int) -> tuple[float, float]:
    scale = width / BASE_SIZE[0]
    return point[0] * scale, point[1] * scale


def frame_from(
    base_img: Image.Image,
    label: str,
    step_idx: int,
    total: int,
    cursor_xy: tuple[float, float],
    click_strength: float = 0.0,
) -> Image.Image:
    frame = base_img.copy().convert("RGBA")
    draw_label(frame, label=label, step_idx=step_idx, total=total)
    draw_cursor(frame, cursor_xy[0], cursor_xy[1], click_strength=click_strength)
    return frame


def add_frames(
    out_frames: list[Image.Image],
    out_durations: list[int],
    frame_iter: Iterable[tuple[Image.Image, int]],
) -> None:
    for f, d in frame_iter:
        out_frames.append(f)
        out_durations.append(d)


def build_tour_gif(output_path: Path, width: int, colors: int) -> None:
    steps_data: list[tuple[Step, Image.Image, tuple[float, float]]] = []
    for step in STEPS:
        img_path = IMG_DIR / step.image_name
        if not img_path.exists():
            raise FileNotFoundError(f"Imagem base nao encontrada: {img_path}")
        img = Image.open(img_path).convert("RGBA")
        img = resize_with_width(img, width=width)
        steps_data.append((step, img, scaled_point(step.click_xy, width=width)))

    frames: list[Image.Image] = []
    durations: list[int] = []
    total = len(steps_data)

    for i, (step, current_img, current_xy) in enumerate(steps_data):
        # Hold on active screen.
        hold_frames = (
            frame_from(current_img, step.label, i + 1, total, current_xy, click_strength=0.0),
            260,
        )
        add_frames(frames, durations, [hold_frames])

        # Click pulse on active tab.
        click_phase_frames: list[tuple[Image.Image, int]] = []
        for k in range(5):
            phase = k / 4 if 4 else 1.0
            click_phase_frames.append(
                (frame_from(current_img, step.label, i + 1, total, current_xy, click_strength=phase), 90)
            )
        add_frames(frames, durations, click_phase_frames)

        if i == total - 1:
            add_frames(
                frames,
                durations,
                [
                    (frame_from(current_img, step.label, i + 1, total, current_xy, click_strength=0.0), 300),
                ],
            )
            break

        next_step, next_img, next_xy = steps_data[i + 1]

        # Move cursor to next menu item on current image.
        move_frames: list[tuple[Image.Image, int]] = []
        for k in range(1, 8):
            t = k / 7
            x = lerp(current_xy[0], next_xy[0], t)
            y = lerp(current_xy[1], next_xy[1], t)
            move_frames.append((frame_from(current_img, step.label, i + 1, total, (x, y)), 65))
        add_frames(frames, durations, move_frames)

        # Click pulse before route/screen transition.
        click_next_frames: list[tuple[Image.Image, int]] = []
        for k in range(5):
            phase = k / 4 if 4 else 1.0
            click_next_frames.append(
                (
                    frame_from(
                        current_img,
                        next_step.label,
                        i + 2,
                        total,
                        next_xy,
                        click_strength=phase,
                    ),
                    90,
                )
            )
        add_frames(frames, durations, click_next_frames)

        # Cross-fade to next screen while keeping cursor on clicked menu.
        fade_frames: list[tuple[Image.Image, int]] = []
        for k in range(1, 7):
            t = k / 6
            mixed = Image.blend(current_img, next_img, t)
            fade_frames.append((frame_from(mixed, next_step.label, i + 2, total, next_xy), 80))
        add_frames(frames, durations, fade_frames)

    # Quantize frames for smaller GIF.
    paletted: list[Image.Image] = []
    for frame in frames:
        paletted.append(frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=colors))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    paletted[0].save(
        output_path,
        save_all=True,
        append_images=paletted[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )


def main() -> int:
    args = parse_args()
    output = Path(args.output).resolve()
    build_tour_gif(output_path=output, width=max(640, args.width), colors=max(32, min(256, args.colors)))
    print(f"[ok] {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
