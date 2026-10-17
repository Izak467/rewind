# Phase 0 throwaway: test verified metadata matching on a sample of the real export.
# Usage: SSL_CERT_FILE=/etc/ssl/cert.pem python3 -I scripts/phase0/match_proto_v2.py "<export folder>" <out_report_path>
import json, os, sys, re, time, random, unicodedata, io, urllib.request, urllib.parse
from collections import defaultdict
from difflib import SequenceMatcher
from statistics import median
from PIL import Image

EXPORT, OUT = sys.argv[1], sys.argv[2]
UA = {'User-Agent': 'Rewind/0.1 (+https://github.com/Izak467/rewind)'}

def get(url, binary=False):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                b = r.read()
                return b if binary else json.loads(b)
        except Exception as e:
            err = e; time.sleep(2 + attempt * 3)
    raise err

# ---------- normalization ----------
NOISE = r'(remaster(ed)?|deluxe|edition|version|anniversary|expanded|bonus|explicit|clean|feat\.?|ft\.?|with |mono|stereo|re-?issue|special|collector|super|single)'
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[\(\[][^\)\]]*' + NOISE + r'[^\)\]]*[\)\]]', ' ', s)   # (Remastered 2011), [Deluxe]
    s = re.sub(r'\s+-\s+[^-]*' + NOISE + r'.*$', ' ', s)                  # - 2011 Remaster
    s = s.replace('&', ' and ')
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()
def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b: return 0.0
    if a == b: return 1.0
    return SequenceMatcher(None, a, b).ratio()
def artist_sim(ours, theirs):
    # their credit may be "A & B" or "A, B"; ours is the album artist
    parts = [theirs] + re.split(r',|&| and | x | with | featuring | feat\.? | ft\.? ', theirs or '')
    return max(sim(ours, p) for p in parts if p.strip())

# ---------- image hash ----------
def dhash(url):
    im = Image.open(io.BytesIO(get(url, binary=True))).convert('L').resize((9, 8))
    px = list(im.getdata())
    return [px[r * 9 + c] > px[r * 9 + c + 1] for r in range(8) for c in range(8)]
def ham(a, b): return sum(x != y for x, y in zip(a, b))

# ---------- load export ----------
plays = []
for f in sorted(os.listdir(EXPORT)):
    if f.startswith('Streaming_History_Audio_'):
        for r in json.load(open(os.path.join(EXPORT, f))):
            if r.get('spotify_track_uri'):
                plays.append(r)

track = {}                       # uri -> info
album_min = defaultdict(float)
artist_min = defaultdict(float)
artist_tracks = defaultdict(set)
for r in plays:
    u = r['spotify_track_uri']
    t = track.setdefault(u, {'uri': u, 'name': r['master_metadata_track_name'], 'artist': r['master_metadata_album_artist_name'],
                             'album': r['master_metadata_album_album_name'], 'min': 0.0, 'done': [], 'first': r['ts']})
    t['min'] += r['ms_played'] / 60000
    if r['reason_end'] == 'trackdone': t['done'].append(r['ms_played'])
    if r['ts'] < t['first']: t['first'] = r['ts']
    album_min[(t['artist'], t['album'])] += r['ms_played'] / 60000
    artist_min[t['artist']] += r['ms_played'] / 60000
    artist_tracks[t['artist']].add(t['name'])
for t in track.values():
    t['dur'] = int(median(t['done'])) if t['done'] else None

total_min = sum(album_min.values())
ranked = sorted(album_min.items(), key=lambda kv: -kv[1])
coverage = {n: sum(m for _, m in ranked[:n]) / total_min for n in (100, 250, 500, 1000, 2000)}
dur_known = sum(1 for t in track.values() if t['dur']) / len(track)
dur_known_min = sum(t['min'] for t in track.values() if t['dur']) / sum(t['min'] for t in track.values())

random.seed(7)
sample_albums = [k for k, _ in ranked[:25]] + random.sample([k for k, m in ranked[25:] if m >= 20], 25)

lines = []
def out(s=''): lines.append(s); print(s, flush=True)
out(f'albums: {len(album_min)}  top-N album coverage of minutes: ' + '  '.join(f'{n}:{v:.0%}' for n, v in coverage.items()))
out(f'song length known from export (median of trackdone plays): {dur_known:.0%} of tracks, {dur_known_min:.0%} of minutes')
out()

# ---------- albums via iTunes (v2) ----------
JUNK = re.compile(r'karaoke|tribute|originally performed|in the style of|made famous|cover version|lullaby|8-bit|instrumental version', re.I)
def itunes(params):
    time.sleep(3.2)  # Apple: ~20 calls/min
    return [c for c in get('https://itunes.apple.com/search?' + urllib.parse.urlencode(params))['results']
            if not JUNK.search(' '.join(str(c.get(k, '')) for k in ('artistName', 'collectionName', 'trackName', 'primaryGenreName')))]
def judge(c, artist, album, t, sp_hash):
    a_s = artist_sim(artist, c.get('artistName')); al_s = sim(album, c.get('collectionName'))
    t_s = sim(t['name'], c.get('trackName')) if c.get('trackName') else None
    d_ok = bool(t['dur'] and c.get('trackTimeMillis') and abs(c['trackTimeMillis'] - t['dur']) <= 3000)
    art_d = None
    if sp_hash and c.get('artworkUrl100'):
        try: art_d = ham(sp_hash, dhash(c['artworkUrl100']))
        except Exception: pass
    art_ok = art_d is not None and art_d <= 10
    if al_s >= 0.8 and art_ok and (a_s >= 0.85 or art_d <= 4): v = 'VERIFIED'
    elif a_s >= 0.85 and al_s >= 0.9 and d_ok: v = 'VERIFIED'
    elif a_s >= 0.85 and al_s >= 0.8: v = 'LIKELY'
    else: v = 'REJECT'
    return v, dict(a=a_s, al=al_s, t=t_s, dur=d_ok, art=art_d)
RANK = {'VERIFIED': 2, 'LIKELY': 1, 'REJECT': 0}
stats = defaultdict(int)
for i, (artist, album) in enumerate(sample_albums):
    tracks = sorted([t for t in track.values() if t['artist'] == artist and t['album'] == album], key=lambda t: -t['min'])
    t = tracks[0]; tag = 'TOP' if i < 25 else 'RND'
    try: sp_hash = dhash(get('https://open.spotify.com/oembed?url=' + t['uri'])['thumbnail_url'])
    except Exception: sp_hash = None
    best = None; tried = []
    strategies = [('song', {'term': f'{artist} {t["name"]}', 'entity': 'song', 'limit': 25}),
                  ('album', {'term': f'{artist} {album}', 'entity': 'album', 'limit': 15}),
                  ('song-title-only', {'term': t['name'], 'entity': 'song', 'limit': 50})]
    for name, params in strategies:
        try: res = itunes(params)
        except Exception as e: tried.append(f'{name}:error'); continue
        # cheap prefilter by names, then hash art only for the top few
        res.sort(key=lambda c: -(2 * sim(album, c.get('collectionName')) + artist_sim(artist, c.get('artistName'))
                                 + (sim(t['name'], c.get('trackName')) if c.get('trackName') else 0)))
        for c in res[:4]:
            v, parts = judge(c, artist, album, t, sp_hash)
            if not best or RANK[v] > RANK[best[0]]: best = (v, parts, c, name)
        tried.append(name)
        if best and best[0] == 'VERIFIED': break
    if not best:
        out(f'[{tag}] NONE     {artist} — {album}'); stats['NONE'] += 1; continue
    v, p, c, how = best
    stats[v] += 1
    date = c.get('releaseDate', '')[:10]
    flag = f' DATE-AFTER-FIRST-PLAY({t["first"][:10]})' if date and date > t['first'][:10] else ''
    out(f'[{tag}] {v:8} {artist} — {album}  →  {c.get("artistName")} / {c.get("collectionName")} | via {how} | '
        f'a={p["a"]:.2f} al={p["al"]:.2f} dur={"ok" if p["dur"] else "x"} art={p["art"]} | {date if v != "REJECT" else "-"} {c.get("primaryGenreName")}{flag}')

out(); out('album stats: ' + json.dumps(stats)); out()

# ---------- artist photos via Deezer (v2: anchor on songs you played) ----------
top_artists = [a for a, _ in sorted(artist_min.items(), key=lambda kv: -kv[1])]
sample_artists = top_artists[:15] + random.sample([a for a in top_artists[15:] if artist_min[a] >= 30], 15)
astats = defaultdict(int)
for i, artist in enumerate(sample_artists):
    tag = 'TOP' if i < 15 else 'RND'
    mine = sorted([t for t in track.values() if t['artist'] == artist], key=lambda t: -t['min'])[:3]
    votes = defaultdict(int); names = {}; pics = {}
    for t in mine:
        q = f'artist:"{artist}" track:"{norm(t["name"])}"'
        try: data = get('https://api.deezer.com/search/track?' + urllib.parse.urlencode({'q': q, 'limit': 10})).get('data', [])
        except Exception: data = []
        if not data:  # strict query found nothing: loose query
            try: data = get('https://api.deezer.com/search/track?' + urllib.parse.urlencode({'q': f'{artist} {t["name"]}', 'limit': 10})).get('data', [])
            except Exception: data = []
        seen = set()
        for d in data:
            a = d.get('artist', {})
            if a.get('id') in seen or artist_sim(artist, a.get('name')) < 0.85 or sim(t['name'], d.get('title')) < 0.75: continue
            seen.add(a['id']); votes[a['id']] += 1; names[a['id']] = a['name']; pics[a['id']] = a.get('picture_xl') or a.get('picture_big')
        time.sleep(0.2)
    need = min(2, len(mine))
    if votes:
        aid = max(votes, key=votes.get); n = votes[aid]
        v = 'VERIFIED' if n >= need else 'WEAK'
        out(f'[{tag}] {v:8} {artist} → {names[aid]}#{aid} ({n}/{len(mine)} of your top songs found under this artist) photo={"yes" if pics[aid] and "/artist//" not in pics[aid] else "MISSING"}')
    else:
        v = 'NONE'; out(f'[{tag}] NONE     {artist}')
    astats[v] += 1
out(); out('artist stats: ' + json.dumps(astats))
open(OUT, 'w').write('\n'.join(lines))
