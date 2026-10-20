"""由 assets/logo.png 生成透明背景图标。

用法:
    python make_ico.py <源 png> <输出 ico> [输出透明 png]

白底抠图策略（默认 logo.png 是纯白底 + 无 alpha 的 P 图）：
  1. 从四边做 flood fill，把「接近纯白且与边界连通」的像素标成背景（保护角色身上的白色花边/高光）；
  2. 背景像素 alpha 归零；
  3. 对抠图边缘做一次轻微 alpha 抗锯齿（3x3 加权），避免 16/32px 下出现白边或锯齿；
  4. 居中补成正方形后写出多尺寸 ICO，可选同时写一张 256px 透明 PNG（托盘图标用）。
"""
import sys
from collections import deque

from PIL import Image, ImageFilter

WHITE_MIN = 232      # 各通道都不低于它才算"白"
CHROMA_MAX = 16      # 最大通道差（低饱和）才算"白"，避免抠掉浅色皮肤/发色


def build_background_mask(img):
    w, h = img.size
    px = img.load()
    white = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                white[y][x] = True
                continue
            lo, hi = min(r, g, b), max(r, g, b)
            if lo >= WHITE_MIN and hi - lo <= CHROMA_MAX:
                white[y][x] = True
    mask = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white[y][x] and not mask[y][x]:
                mask[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if white[y][x] and not mask[y][x]:
                mask[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and white[ny][nx] and not mask[ny][nx]:
                mask[ny][nx] = True
                q.append((nx, ny))
    return mask


def main():
    if len(sys.argv) < 3:
        print("用法: python make_ico.py <源 png> <输出 ico> [输出透明 png]")
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    dst_png = sys.argv[3] if len(sys.argv) > 3 else ""

    img = Image.open(src).convert("RGBA")
    w, h = img.size
    mask = build_background_mask(img)
    px = img.load()
    for y in range(h):
        for x in range(w):
            if mask[y][x]:
                px[x, y] = (0, 0, 0, 0)

    # 轻微羽化 alpha，消除硬边（颜色不变，仅平滑透明过渡）
    alpha = img.getchannel("A").filter(ImageFilter.GaussianBlur(0.6))
    img.putalpha(alpha)

    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)

    canvas.save(dst, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    if dst_png:
        canvas.save(dst_png, format="PNG")
    cleared = sum(1 for row in mask for v in row if v)
    print(f"icon: {dst} from {(w, h)} -> {canvas.size}, transparent px {cleared}/{w * h}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
