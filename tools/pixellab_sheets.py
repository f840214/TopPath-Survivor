#!/usr/bin/env python3
"""把 PixelLab 角色做成遊戲用的 PMD 圖表（assets/pokemon/<dex>/Idle|Walk|Attack.png）。

  python3 tools/pixellab_sheets.py <character_id> <dex> [--out meta.json]

從 https://api.pixellab.ai/mcp/characters/<id>/download 下載 zip（第一個狀態），
每個動畫一張表：欄＝圖格、列＝8 方向（PMD 順序：南、東南、東、東北、北、西北、西、西南）。
錨點：ax = 畫布中央，ay = 該動畫所有圖格最低像素的中位數（腳底）。
印出要貼進 js/data/custom.js 的 sprite 物件。
"""
import io, json, os, statistics, subprocess, sys, zipfile
from PIL import Image

DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']
ANIMS = {'idle': 'Idle', 'walk': 'Walk', 'attack': 'Attack', 'shoot': 'Shoot'}
DUR = {'Idle': 12, 'Walk': 5, 'Attack': 2, 'Shoot': 2}

def main():
    cid, dex = sys.argv[1], int(sys.argv[2])
    root = os.path.join(os.path.dirname(__file__), '..')
    url = 'https://api.pixellab.ai/mcp/characters/%s/download' % cid
    data = subprocess.run(['curl', '-s', url], capture_output=True).stdout
    z = zipfile.ZipFile(io.BytesIO(data))
    names = z.namelist()
    state = names[0].split('/')[0]
    out = os.path.join(root, 'assets', 'pokemon', str(dex))
    os.makedirs(out, exist_ok=True)
    meta = {'s': 2, 'k': 0.5, 'a': {}}
    for key, name in ANIMS.items():
        frames = {}
        for d in DIRS:
            fs = sorted(n for n in names if n.startswith('%s/animations/%s/%s/' % (state, key, d)))
            if not fs: break
            frames[d] = [Image.open(io.BytesIO(z.read(n))).convert('RGBA') for n in fs]
        if len(frames) != 8: continue
        n = min(len(v) for v in frames.values())
        W = max(im.width for v in frames.values() for im in v)
        H = max(im.height for v in frames.values() for im in v)
        sheet = Image.new('RGBA', (W * n, H * 8), (0, 0, 0, 0))
        bottoms = []
        for r, d in enumerate(DIRS):
            for i in range(n):
                im = frames[d][i]
                ox, oy = (W - im.width) // 2, H - im.height
                sheet.paste(im, (i * W + ox, r * H + oy))
                b = im.getbbox()
                if b: bottoms.append(b[3] + oy)
        sheet.save(os.path.join(out, name + '.png'), optimize=True)
        ay = statistics.median(bottoms) - 1.5
        meta['a'][name] = {'w': W, 'h': H, 'n': n, 'r': 8, 'd': [DUR[name]] * n, 'ax': W / 2 - 0.5, 'ay': ay}
        print('%s: %dx%d x%d  ay=%.1f' % (name, W, H, n, ay), file=sys.stderr)
    if '--out' in sys.argv:
        with open(sys.argv[sys.argv.index('--out') + 1], 'w') as f: json.dump(meta, f)
    print(json.dumps(meta))

if __name__ == '__main__':
    main()
