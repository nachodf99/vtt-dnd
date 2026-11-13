# Genera los mapas y el audio de prueba en /tmp/vttest
import json, random, base64, wave, struct, math, os
from PIL import Image, ImageDraw
D = '/tmp/vttest'; os.makedirs(D, exist_ok=True)
W, H, g = 1400, 1000, 100
im = Image.new('RGB', (W, H), (120, 105, 85)); d = ImageDraw.Draw(im)
for x in range(0, W, g):
    for y in range(0, H, g):
        c = random.randint(95, 130); d.rectangle([x + 2, y + 2, x + g - 2, y + g - 2], fill=(c, c - 12, c - 30))
walls = []
def wall(a, b, c, e, door=0): walls.append({"c": [a, b, c, e], "door": door, "ds": 0, "sight": 20})
wall(700, 0, 700, 400); wall(700, 500, 700, 1000); wall(700, 400, 700, 500, door=1); wall(200, 300, 500, 300)
for w in walls: d.line(w["c"], fill=(30, 20, 10), width=12)
im.save(D + '/map.png')
json.dump({"name": "Prueba luces", "width": W, "height": H, "grid": {"size": g, "distance": 5}, "padding": 0, "darkness": 0.8, "walls": walls,
           "lights": [{"x": 350, "y": 700, "config": {"bright": 10, "dim": 20, "color": "#ff9b42", "alpha": 0.5}},
                      {"x": 1100, "y": 300, "config": {"bright": 10, "dim": 20, "color": "#6bb4ff", "alpha": 0.6}}]}, open(D + '/map.json', 'w'))
w = wave.open(D + '/tone.wav', 'w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
w.writeframes(b''.join(struct.pack('<h', int(8000 * math.sin(i / 8000 * 2 * math.pi * 440))) for i in range(16000))); w.close()
Wu, Hu, ppg = 10, 8, 70
Image.new('RGB', (Wu * ppg, Hu * ppg), (90, 80, 70)).save(D + '/uv.png')
json.dump({"format": 0.3, "resolution": {"map_origin": {"x": 0, "y": 0}, "map_size": {"x": Wu, "y": Hu}, "pixels_per_grid": ppg},
           "line_of_sight": [[{"x": 5, "y": 0}, {"x": 5, "y": 3}], [{"x": 5, "y": 5}, {"x": 5, "y": 8}]],
           "portals": [{"position": {"x": 5, "y": 4}, "bounds": [{"x": 5, "y": 3}, {"x": 5, "y": 5}], "rotation": 0, "closed": True, "freestanding": False}],
           "lights": [{"position": {"x": 2.5, "y": 2.5}, "range": 4, "intensity": 1, "color": "ffff9933", "shadows": True},
                      {"position": {"x": 7.5, "y": 6}, "range": 3, "intensity": 0.8, "color": "ff66aaff", "shadows": True}],
           "environment": {"baked_lighting": True, "ambient_light": "ff555555"}, "image": base64.b64encode(open(D + '/uv.png', 'rb').read()).decode()}, open(D + '/uv.dd2vtt', 'w'))
W2, H2 = 4200, 3000
Image.new('RGB', (W2, H2), (100, 90, 80)).save(D + '/big.png')
random.seed(1); bw = []
for i in range(600):
    x = random.randint(0, W2); y = random.randint(0, H2); L = random.randint(100, 400)
    bw.append({"c": [x, y, x + (L if i % 2 else 0), y + (0 if i % 2 else L)], "door": 1 if i % 25 == 0 else 0, "ds": 0, "sight": 20})
json.dump({"name": "Grande", "width": W2, "height": H2, "grid": {"size": 100, "distance": 5}, "padding": 0, "darkness": 0.9, "walls": bw,
           "lights": [{"x": random.randint(0, W2), "y": random.randint(0, H2), "config": {"bright": 10, "dim": 20, "color": "#ffaa55", "alpha": 0.5}} for _ in range(80)]}, open(D + '/big.json', 'w'))
print('Recursos de prueba en', D)
