#!/usr/bin/env python3
"""Art QA for a kie.mjs spec: checks every shipped image and draws a contact sheet.

  python3 tools/art/check.py tools/<slug>/art.json [--only a,b] [--cols 8] [--dark] [--out studio/art-check/x.png]

Run from the repo root, after every `kie.mjs batch` and before the art is wired in. Needs Pillow + numpy
(user site-packages, so no `python3 -I`). Reads the spec exactly the way kie.mjs does (defaults + item) and
checks <outDir>/<id>.webp, the file that ships.

FAIL (exit 1, regenerate with `kie.mjs batch <spec> --force --only <id>`):
  missing   the file isn't there
  blank     the image is flat (a failed generation)
  no-alpha  cutout: true but nothing is transparent (the background got baked in)
  bg-left   cutout: true but the corners are opaque (the cutout kept part of the background)
WARN (look at it on the sheet, fix it if it shows in the game):
  size      the long side isn't the spec's `max`, or the aspect is off the spec's
  edge      cutout: the subject touches an image edge, so the generator cropped it
  small     cutout: the subject spans under half the canvas, so it draws small for its size
  halo      cutout: a light fringe round the subject, which shows on dark scenes
  alpha     no cutout, but the image has transparent pixels
  heavy     the file is over its size budget (cutout 0.5 B/px, full images 0.45 B/px)
  jump      a state pair (x-happy / x-sad / x-idle ...) whose subject height or feet differ, so the swap pops
Also reports the folder's total weight against the 3 MB budget, and files in outDir that no spec in
tools/<slug>/ makes (orphans that still ship).

Writes studio/art-check/<slug>[-<spec>].png (every image on a checkerboard with id, size and KB; red frame =
FAIL, amber = WARN) and a .json report beside it. Open the PNG during the art review.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

STATES = {'happy', 'sad', 'idle', 'win', 'lose', 'hit', 'angry', 'wide', 'hero', 'open', 'closed', 'full',
          'empty', 'cry', 'cheer', 'eat', 'sleep', 'worried', 'joy', 'scared', 'mad', 'smile', 'wave', 'jump'}
BUDGET_MB = 3.0


def load_spec(path):
    spec = json.load(open(path))
    d = {'aspect': '1:1', 'res': '1K', 'cutout': False, 'max': 512, 'q': 82, **spec.get('defaults', {})}
    out_dir = os.path.abspath(spec['outDir']) if spec.get('outDir') else os.path.dirname(os.path.abspath(path))
    return spec, d, out_dir


def sibling_ids(spec_path, out_dir):
    """Ids made by any spec in the same tools/<slug>/ folder that writes to the same outDir."""
    ids = set()
    folder = os.path.dirname(os.path.abspath(spec_path))
    for f in os.listdir(folder):
        if not f.endswith('.json') or f.endswith('.manifest.json'):
            continue
        try:
            s = json.load(open(os.path.join(folder, f)))
        except (ValueError, OSError):
            continue
        if isinstance(s, dict) and s.get('outDir') and os.path.abspath(s['outDir']) == out_dir:
            ids.update(it['id'] for it in s.get('items', []) if 'id' in it)
    return ids


def erode(mask, n):
    for _ in range(n):
        p = np.pad(mask, 1)
        mask = p[1:-1, 1:-1] & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return mask


def measure(path):
    im = Image.open(path)
    im.load()
    has_alpha = im.mode in ('RGBA', 'LA', 'PA') or 'transparency' in im.info
    rgba = np.asarray(im.convert('RGBA'), dtype=np.int16)
    h, w = rgba.shape[:2]
    a = rgba[..., 3]
    lum = 0.299 * rgba[..., 0] + 0.587 * rgba[..., 1] + 0.114 * rgba[..., 2]
    m = {'w': w, 'h': h, 'bytes': os.path.getsize(path), 'has_alpha': bool(has_alpha),
         'clear': float((a < 8).mean())}
    solid = a > 24
    m['std'] = float(lum[solid].std()) if solid.any() else 0.0
    k = max(3, min(w, h) // 40)
    m['corners'] = int(sum(a[ys, xs].mean() > 200 for ys, xs in
                           [(slice(0, k), slice(0, k)), (slice(0, k), slice(w - k, w)),
                            (slice(h - k, h), slice(0, k)), (slice(h - k, h), slice(w - k, w))]))
    if solid.any():
        ys, xs = np.where(solid)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        m['bbox'] = [x0, y0, x1, y1]
        m['fill'] = (x1 - x0) * (y1 - y0) / (w * h)
        e = 2
        side = {'top': solid[:e].mean(), 'bottom': solid[-e:].mean(), 'left': solid[:, :e].mean(),
                'right': solid[:, -e:].mean()}
        m['edges'] = [s for s, v in side.items() if v > 0.03]
        m['span'] = max((x1 - x0) / w, (y1 - y0) / h)
        # Halo = a semi-transparent fringe that is near-white AND clearly lighter than the subject's own edge
        # just inside it (so white or icy subjects don't count).
        ring = (a > 16) & (a < 200)
        core = a >= 250
        inner = core & ~erode(core, 3)
        white = (rgba[..., :3].min(axis=2) > 225)
        m['ring_px'] = int(ring.sum())
        m['ring_white'] = float(white[ring].mean()) if ring.any() else 0.0
        m['ring_lift'] = float(lum[ring].mean() - lum[inner].mean()) if ring.any() and inner.any() else 0.0
    else:
        m.update(bbox=None, fill=0.0, span=0.0, edges=[], ring_px=0, ring_white=0.0, ring_lift=0.0)
    return m, im.convert('RGBA')


def judge(o, m):
    fails, warns = [], []
    w, h = m['w'], m['h']
    if m['std'] < 4:
        fails.append('blank: the image is flat')
    long_side = max(w, h)
    if long_side != int(o['max']):
        warns.append(f"size: long side {long_side}, spec max {o['max']}")
    try:
        aw, ah = (float(x) for x in str(o['aspect']).split(':'))
        if abs((w / h) / (aw / ah) - 1) > 0.04:
            warns.append(f"size: {w}x{h} is off the spec aspect {o['aspect']}")
    except ValueError:
        pass
    cut = bool(o.get('cutout'))
    if cut:
        if not m['has_alpha'] or m['clear'] < 0.02:
            fails.append('no-alpha: cutout but nothing is transparent (background baked in)')
        elif m['corners'] >= 3:
            fails.append(f"bg-left: {m['corners']} opaque corners, the cutout kept background")
        else:
            if m['edges']:
                warns.append(f"edge: subject touches the {'/'.join(m['edges'])} edge (cropped?)")
            if m['span'] < 0.5:
                warns.append(f"small: subject spans {m['span'] * 100:.0f}% of the canvas")
            if m['ring_px'] > 40 and m['ring_white'] > 0.3 and m['ring_lift'] > 35:
                warns.append(f"halo: edge {m['ring_white'] * 100:.0f}% near-white, {m['ring_lift']:.0f} lighter than the subject")
        budget = 0.5
    else:
        if m['has_alpha'] and m['clear'] > 0.001:
            warns.append(f"alpha: {m['clear'] * 100:.1f}% transparent but the spec has no cutout")
        budget = 0.45
    if m['bytes'] > budget * w * h:
        warns.append(f"heavy: {m['bytes'] / 1024:.0f} KB, budget {budget * w * h / 1024:.0f} KB")
    return fails, warns


def family_jumps(rows):
    """State pairs swap in place, so their subjects should match in height and feet position."""
    groups = {}
    for r in rows:
        parts = r['id'].rsplit('-', 1)
        if len(parts) == 2 and parts[1] in STATES and r['m'] and r['m'].get('bbox') and r['cutout']:
            groups.setdefault(parts[0], []).append(r)
    for g, rs in groups.items():
        if len(rs) < 2:
            continue
        hs = [(r['m']['bbox'][3] - r['m']['bbox'][1]) / r['m']['h'] for r in rs]
        feet = [r['m']['bbox'][3] / r['m']['h'] for r in rs]
        mh, mf = float(np.median(hs)), float(np.median(feet))
        for r, hh, ff in zip(rs, hs, feet):
            bits = []
            if abs(hh / mh - 1) > 0.12:
                bits.append(f"{(hh / mh - 1) * 100:+.0f}% height")
            if abs(ff - mf) > 0.06:
                bits.append(f"feet {(ff - mf) * 100:+.0f}% of the canvas")
            if bits:
                r['warns'].append(f"jump: vs the {g}-* set, {', '.join(bits)}")


def font(size):
    for f in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def sheet(rows, title, out, cols, dark):
    tile, pad, label = 168, 8, 34
    cw, ch = tile + pad * 2, tile + pad * 2 + label
    n = len(rows)
    cols = max(1, min(cols, n))
    rws = (n + cols - 1) // cols
    head = 40
    img = Image.new('RGB', (cols * cw + pad, head + rws * ch + pad), (24, 24, 30) if dark else (245, 245, 248))
    d = ImageDraw.Draw(img)
    f1, f2, ft = font(12), font(11), font(17)
    ink = (235, 235, 240) if dark else (30, 30, 36)
    sub = (160, 160, 170) if dark else (110, 110, 120)
    d.text((pad + 4, 11), title, fill=ink, font=ft)
    c1, c2 = ((40, 40, 48), (56, 56, 66)) if dark else ((255, 255, 255), (214, 214, 220))
    checker = Image.new('RGB', (tile, tile), c1)
    cd = ImageDraw.Draw(checker)
    for y in range(0, tile, 12):
        for x in range(0, tile, 12):
            if (x // 12 + y // 12) % 2:
                cd.rectangle([x, y, x + 11, y + 11], fill=c2)
    for i, r in enumerate(rows):
        x, y = pad + (i % cols) * cw, head + (i // cols) * ch
        frame = (220, 40, 40) if r['fails'] else (235, 160, 20) if r['warns'] else None
        if frame:
            d.rectangle([x - 1, y - 1, x + tile + pad * 2 - 3, y + tile + pad * 2 + label - 5], outline=frame, width=3)
        bx, by = x + pad - 1, y + pad - 1
        img.paste(checker, (bx, by))
        if r.get('im') is not None:
            t = r['im'].copy()
            t.thumbnail((tile, tile), Image.LANCZOS)
            img.paste(t, (bx + (tile - t.width) // 2, by + (tile - t.height) // 2), t)
        else:
            d.text((bx + 50, by + 70), 'MISSING', fill=(220, 40, 40), font=f1)
        name = r['id'] if len(r['id']) <= 26 else r['id'][:25] + '…'
        d.text((bx, by + tile + 4), name, fill=ink, font=f1)
        m = r['m']
        info = f"{m['w']}x{m['h']}  {m['bytes'] / 1024:.0f} KB" if m else ''
        tags = sorted({s.split(':')[0] for s in r['fails'] + r['warns']})
        d.text((bx, by + tile + 19), info + ('  ' + ' '.join(tags) if tags else ''),
               fill=frame or sub, font=f2)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('spec')
    ap.add_argument('--only', help='comma-separated ids')
    ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--dark', action='store_true', help='dark checkerboard (shows light halos)')
    ap.add_argument('--out', help='sheet path (default studio/art-check/<slug>[-<spec>].png)')
    a = ap.parse_args()

    spec, D, out_dir = load_spec(a.spec)
    only = set(a.only.split(',')) if a.only else None
    items = [it for it in spec['items'] if not only or it['id'] in only]
    rows = []
    for it in items:
        o = {**D, **it}
        p = os.path.join(out_dir, f"{it['id']}.webp")
        r = {'id': it['id'], 'cutout': bool(o.get('cutout')), 'm': None, 'im': None, 'fails': [], 'warns': []}
        if not os.path.exists(p):
            r['fails'].append(f'missing: {os.path.relpath(p)}')
        else:
            r['m'], r['im'] = measure(p)
            r['fails'], r['warns'] = judge(o, r['m'])
        rows.append(r)
    family_jumps(rows)

    slug = os.path.basename(os.path.dirname(os.path.abspath(a.spec)))
    stem = os.path.splitext(os.path.basename(a.spec))[0]
    name = slug if stem == 'art' else f'{slug}-{stem}'
    out = a.out or os.path.join('studio', 'art-check', name + ('-dark' if a.dark else '') + '.png')

    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out_dir) for f in fs) \
        if os.path.isdir(out_dir) else 0
    known = sibling_ids(a.spec, out_dir)
    orphans = sorted(f[:-5] for f in os.listdir(out_dir) if f.endswith('.webp') and f[:-5] not in known) \
        if os.path.isdir(out_dir) and not only else []
    nf = sum(1 for r in rows if r['fails'])
    nw = sum(1 for r in rows if r['warns'] and not r['fails'])
    title = (f"{name}: {len(rows)} images, {nf} FAIL, {nw} WARN, folder {total / 1048576:.2f} MB"
             f"{' (over ' + str(BUDGET_MB) + ' MB)' if total > BUDGET_MB * 1048576 else ''}")
    sheet(rows, title, out, a.cols, a.dark)

    for r in rows:
        for s in r['fails']:
            print(f"FAIL {r['id']}: {s}")
    for r in rows:
        for s in r['warns']:
            print(f"WARN {r['id']}: {s}")
    if total > BUDGET_MB * 1048576 and spec.get('outDir', '').startswith('games/'):
        print(f'WARN folder: {os.path.relpath(out_dir)} is {total / 1048576:.2f} MB, budget {BUDGET_MB} MB')
    if orphans:
        print(f"INFO {len(orphans)} file(s) in {os.path.relpath(out_dir)} that no spec makes: {', '.join(orphans[:12])}"
              f"{' …' if len(orphans) > 12 else ''}")
    print(title)
    print(f'sheet: {out}')
    report = {'spec': a.spec, 'outDir': os.path.relpath(out_dir), 'totalBytes': total, 'orphans': orphans,
              'items': [{'id': r['id'], 'fails': r['fails'], 'warns': r['warns'],
                         **({k: r['m'][k] for k in ('w', 'h', 'bytes', 'span', 'edges')} if r['m'] else {})}
                        for r in rows]}
    json.dump(report, open(os.path.splitext(out)[0] + '.json', 'w'), indent=1)
    sys.exit(1 if nf else 0)


if __name__ == '__main__':
    main()
