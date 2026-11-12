#!/usr/bin/env python3
"""Genera supabase/items.sql: catálogo de objetos D&D 5e (reglas 2024).

Fuente de mecánicas: System Reference Document 5.2 (SRD 5.2) de Wizards of the Coast LLC,
licencia Creative Commons Attribution 4.0 (CC-BY-4.0). Nombres traducidos y descripciones
redactadas para esta app. Escala del tablero: 1 casilla = 5 pies (20 pies = 4 casillas).

Efectos (fx):
  heal   -> {"t":"heal","dice":"2d4+2"}                     acción adicional, no gasta la acción de ronda
  dmg    -> {"t":"dmg","dice":..,"dtype":..,"range":casillas,"mode":"save|auto","dc":opcional,
             "half":bool,"only":[tipos],"burn":bool,"keep":bool}  gasta la acción de la ronda
  note   -> {"t":"note"}                                     efecto narrativo: se registra y lo resuelve el DM
"""
import json, re, unicodedata

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

ITEMS = []
def add(cat, name, en, descr='', cons=False, qty=1, fx=None, rarity=None):
    ITEMS.append(dict(id=slug(en), cat=cat, name=name, en=en, descr=descr, consumable=cons, qty=qty,
                      fx=fx, rarity=rarity))

NOTE = {"t": "note"}

# ---------------- Armas (38) ----------------
weapons = [
 # sencillas cuerpo a cuerpo
 ('Garrote', 'Club', '1d4 contundente · Ligera'),
 ('Daga', 'Dagger', '1d4 perforante · Sutil, Ligera, Arrojadiza (20/60)'),
 ('Gran garrote', 'Greatclub', '1d8 contundente · A dos manos'),
 ('Hacha de mano', 'Handaxe', '1d6 cortante · Ligera, Arrojadiza (20/60)'),
 ('Jabalina', 'Javelin', '1d6 perforante · Arrojadiza (30/120)'),
 ('Martillo ligero', 'Light Hammer', '1d4 contundente · Ligera, Arrojadiza (20/60)'),
 ('Maza', 'Mace', '1d6 contundente'),
 ('Bastón', 'Quarterstaff', '1d6 contundente · Versátil (1d8)'),
 ('Hoz', 'Sickle', '1d4 cortante · Ligera'),
 ('Lanza', 'Spear', '1d6 perforante · Arrojadiza (20/60), Versátil (1d8)'),
 # sencillas a distancia
 ('Dardo', 'Dart', '1d4 perforante · Sutil, Arrojadiza (20/60)'),
 ('Ballesta ligera', 'Light Crossbow', '1d8 perforante · Munición (80/320), Carga, A dos manos'),
 ('Arco corto', 'Shortbow', '1d6 perforante · Munición (80/320), A dos manos'),
 ('Honda', 'Sling', '1d4 contundente · Munición (30/120)'),
 # marciales cuerpo a cuerpo
 ('Hacha de batalla', 'Battleaxe', '1d8 cortante · Versátil (1d10)'),
 ('Mangual', 'Flail', '1d8 contundente'),
 ('Guja', 'Glaive', '1d10 cortante · Pesada, Alcance, A dos manos'),
 ('Gran hacha', 'Greataxe', '1d12 cortante · Pesada, A dos manos'),
 ('Espadón', 'Greatsword', '2d6 cortante · Pesada, A dos manos'),
 ('Alabarda', 'Halberd', '1d10 cortante · Pesada, Alcance, A dos manos'),
 ('Lanza de caballería', 'Lance', '1d10 perforante · Pesada, Alcance'),
 ('Espada larga', 'Longsword', '1d8 cortante · Versátil (1d10)'),
 ('Mazo', 'Maul', '2d6 contundente · Pesada, A dos manos'),
 ('Lucero del alba', 'Morningstar', '1d8 perforante'),
 ('Pica', 'Pike', '1d10 perforante · Pesada, Alcance, A dos manos'),
 ('Estoque', 'Rapier', '1d8 perforante · Sutil'),
 ('Cimitarra', 'Scimitar', '1d6 cortante · Sutil, Ligera'),
 ('Espada corta', 'Shortsword', '1d6 perforante · Sutil, Ligera'),
 ('Tridente', 'Trident', '1d8 perforante · Arrojadiza (20/60), Versátil (1d10)'),
 ('Martillo de guerra', 'Warhammer', '1d8 contundente · Versátil (1d10)'),
 ('Pico de guerra', 'War Pick', '1d8 perforante · Versátil (1d10)'),
 ('Látigo', 'Whip', '1d4 cortante · Sutil, Alcance'),
 # marciales a distancia
 ('Cerbatana', 'Blowgun', '1 perforante · Munición (25/100), Carga'),
 ('Ballesta de mano', 'Hand Crossbow', '1d6 perforante · Munición (30/120), Ligera, Carga'),
 ('Ballesta pesada', 'Heavy Crossbow', '1d10 perforante · Munición (100/400), Pesada, Carga, A dos manos'),
 ('Arco largo', 'Longbow', '1d8 perforante · Munición (150/600), Pesada, A dos manos'),
 ('Mosquete', 'Musket', '1d12 perforante · Munición (40/120), Carga, A dos manos'),
 ('Pistola', 'Pistol', '1d10 perforante · Munición (30/90), Carga'),
]
for n, en, d in weapons: add('Armas', n, en, d)

# ---------------- Armaduras ----------------
armors = [
 ('Armadura acolchada', 'Padded Armor', 'Ligera · CA 11 + Des · Desventaja en Sigilo'),
 ('Armadura de cuero', 'Leather Armor', 'Ligera · CA 11 + Des'),
 ('Armadura de cuero tachonado', 'Studded Leather Armor', 'Ligera · CA 12 + Des'),
 ('Armadura de pieles', 'Hide Armor', 'Media · CA 12 + Des (máx. 2)'),
 ('Camisote de mallas', 'Chain Shirt', 'Media · CA 13 + Des (máx. 2)'),
 ('Cota de escamas', 'Scale Mail', 'Media · CA 14 + Des (máx. 2) · Desventaja en Sigilo'),
 ('Coraza', 'Breastplate', 'Media · CA 14 + Des (máx. 2)'),
 ('Semiplacas', 'Half Plate Armor', 'Media · CA 15 + Des (máx. 2) · Desventaja en Sigilo'),
 ('Cota de anillas', 'Ring Mail', 'Pesada · CA 14 · Desventaja en Sigilo'),
 ('Cota de mallas', 'Chain Mail', 'Pesada · CA 16 · Fue 13 · Desventaja en Sigilo'),
 ('Armadura de bandas', 'Splint Armor', 'Pesada · CA 17 · Fue 15 · Desventaja en Sigilo'),
 ('Armadura de placas', 'Plate Armor', 'Pesada · CA 18 · Fue 15 · Desventaja en Sigilo'),
 ('Escudo', 'Shield', '+2 a la CA'),
]
for n, en, d in armors: add('Armaduras', n, en, d)

# ---------------- Munición ----------------
for n, en, q in [('Flechas', 'Arrows', 20), ('Virotes', 'Bolts', 20), ('Balas de honda', 'Sling Bullets', 20),
                 ('Balas de arma de fuego', 'Firearm Bullets', 10), ('Agujas de cerbatana', 'Needles', 50)]:
    add('Munición', n, en, 'Munición para armas a distancia.', True, q, NOTE)

# ---------------- Equipo de aventurero ----------------
add('Equipo', 'Ácido (vial)', 'Acid', 'Lánzalo a una criatura a 20 pies: salvación de Des (CD 8 + Des + competencia) o 2d6 de daño de ácido.', True, 1,
    {"t": "dmg", "dice": "2d6", "dtype": "ácido", "range": 4, "mode": "save"})
add('Equipo', 'Fuego de alquimista (frasco)', 'Alchemists Fire', 'Lánzalo a 20 pies: salvación de Des o 1d4 de fuego y el objetivo queda Ardiendo (1d4 de fuego cada ronda).', True, 1,
    {"t": "dmg", "dice": "1d4", "dtype": "fuego", "range": 4, "mode": "save", "burn": True})
add('Equipo', 'Agua bendita (frasco)', 'Holy Water', 'Lánzala a 20 pies: si el objetivo es Infernal o No muerto, salvación de Des o 2d8 de daño radiante.', True, 1,
    {"t": "dmg", "dice": "2d8", "dtype": "radiante", "range": 4, "mode": "save", "only": ["infernal", "no muerto"]})
add('Equipo', 'Antitoxina (vial)', 'Antitoxin', 'Acción adicional: ventaja en salvaciones contra Envenenado durante 1 hora.', True, 1, NOTE)
add('Equipo', 'Equipo de sanador', 'Healers Kit', '10 usos. Acción de Usar: estabiliza a una criatura Inconsciente a 0 PV sin tirada de Medicina.', True, 10, NOTE)
add('Equipo', 'Aceite (frasco)', 'Oil', 'Lánzalo o viértelo: si el objetivo recibe daño de fuego antes de 1 minuto, sufre 5 de fuego extra.', True, 1, NOTE)
add('Equipo', 'Veneno básico (vial)', 'Basic Poison', 'Acción adicional: impregna un arma o 3 municiones; durante 1 minuto el impacto inflige 1d4 de veneno extra.', True, 1, NOTE)
add('Equipo', 'Raciones (1 día)', 'Rations', 'Comida para un día.', True, 5, NOTE)
add('Equipo', 'Antorcha', 'Torch', 'Luz brillante 20 pies y tenue 20 más durante 1 hora.', True, 3, NOTE)
add('Equipo', 'Vela', 'Candle', 'Luz brillante 5 pies durante 1 hora.', True, 3, NOTE)
add('Equipo', 'Abrojos (bolsa)', 'Caltrops', 'Cubren un cuadrado de 5 pies: salvación de Des CD 15 o 1 de perforante y velocidad 0.', True, 1, NOTE)
add('Equipo', 'Bolas de rodamiento (bolsa)', 'Ball Bearings', 'Cubren un cuadrado de 10 pies: salvación de Des CD 10 o Derribado.', True, 1, NOTE)
add('Equipo', 'Perfume (vial)', 'Perfume', '', True, 1, NOTE)
add('Equipo', 'Papel (hoja)', 'Paper', '', True, 5, NOTE)
add('Equipo', 'Pergamino (hoja)', 'Parchment', '', True, 5, NOTE)
for n, en, d in [
 ('Foco arcano', 'Arcane Focus', 'Canalizador de conjuros arcanos.'),
 ('Mochila', 'Backpack', ''), ('Barril', 'Barrel', ''), ('Cesta', 'Basket', ''), ('Saco de dormir', 'Bedroll', ''),
 ('Campana', 'Bell', ''), ('Manta', 'Blanket', ''), ('Polea y aparejo', 'Block and Tackle', ''), ('Libro', 'Book', ''),
 ('Botella de cristal', 'Glass Bottle', ''), ('Cubo', 'Bucket', ''), ('Estuche para virotes', 'Crossbow Bolt Case', ''),
 ('Estuche para mapas o pergaminos', 'Map or Scroll Case', ''), ('Cadena (10 pies)', 'Chain', ''), ('Cofre', 'Chest', ''),
 ('Equipo de escalada', 'Climbers Kit', 'Ventaja para no caer al escalar anclado.'), ('Ropa fina', 'Fine Clothes', ''),
 ('Ropa de viaje', 'Travelers Clothes', ''), ('Bolsa de componentes', 'Component Pouch', ''), ('Disfraz', 'Costume', ''),
 ('Palanca', 'Crowbar', 'Ventaja en pruebas de Fuerza para forzar.'), ('Foco druídico', 'Druidic Focus', ''),
 ('Frasco', 'Flask', ''), ('Garfio', 'Grappling Hook', ''), ('Símbolo sagrado', 'Holy Symbol', ''),
 ('Cepo de caza', 'Hunting Trap', 'Salvación de Des CD 13 o 1d4 de perforante y apresado.'), ('Tinta', 'Ink', ''),
 ('Pluma', 'Ink Pen', ''), ('Jarra', 'Jug', ''), ('Escalera (10 pies)', 'Ladder', ''), ('Lámpara', 'Lamp', ''),
 ('Linterna sorda', 'Bullseye Lantern', ''), ('Linterna con capucha', 'Hooded Lantern', ''), ('Cerradura', 'Lock', ''),
 ('Lupa', 'Magnifying Glass', ''), ('Grilletes', 'Manacles', ''), ('Mapa', 'Map', ''), ('Espejo', 'Mirror', ''),
 ('Red', 'Net', 'Salvación de Des o Apresado.'), ('Pértiga (10 pies)', 'Pole', ''), ('Olla de hierro', 'Iron Pot', ''),
 ('Saquito', 'Pouch', ''), ('Carcaj', 'Quiver', ''), ('Ariete portátil', 'Portable Ram', ''), ('Túnica', 'Robe', ''),
 ('Cuerda (50 pies)', 'Rope', ''), ('Saco', 'Sack', ''), ('Pala', 'Shovel', ''), ('Silbato de señales', 'Signal Whistle', ''),
 ('Clavos de hierro (10)', 'Iron Spikes', ''), ('Catalejo', 'Spyglass', ''), ('Cordel (10 pies)', 'String', ''),
 ('Tienda de campaña', 'Tent', ''), ('Yesquero', 'Tinderbox', ''), ('Vial', 'Vial', ''), ('Odre', 'Waterskin', ''),
 ('Kit de explorador', 'Explorers Pack', ''), ('Kit de mazmorreo', 'Dungeoneers Pack', ''), ('Kit de ladrón', 'Burglars Pack', ''),
 ('Kit de sacerdote', 'Priests Pack', ''), ('Kit de erudito', 'Scholars Pack', ''), ('Kit de diplomático', 'Diplomats Pack', ''),
 ('Kit de artista', 'Entertainers Pack', ''),
 ('Herramientas de ladrón', 'Thieves Tools', 'Para abrir cerraduras y desactivar trampas.'),
 ('Útiles de alquimista', 'Alchemists Supplies', ''), ('Útiles de herborista', 'Herbalism Kit', ''),
 ('Útiles de envenenador', 'Poisoners Kit', ''), ('Instrumento musical', 'Musical Instrument', ''),
]:
    add('Equipo', n, en, d)

# ---------------- Pociones ----------------
add('Pociones', 'Poción de curación', 'Potion of Healing', 'Común. Recuperas 2d4 + 2 PV. Beberla es una acción adicional.', True, 1, {"t": "heal", "dice": "2d4+2"}, 'Común')
add('Pociones', 'Poción de curación mayor', 'Potion of Greater Healing', 'Poco común. Recuperas 4d4 + 4 PV.', True, 1, {"t": "heal", "dice": "4d4+4"}, 'Poco común')
add('Pociones', 'Poción de curación superior', 'Potion of Superior Healing', 'Rara. Recuperas 8d4 + 8 PV.', True, 1, {"t": "heal", "dice": "8d4+8"}, 'Rara')
add('Pociones', 'Poción de curación suprema', 'Potion of Supreme Healing', 'Muy rara. Recuperas 10d4 + 20 PV.', True, 1, {"t": "heal", "dice": "10d4+20"}, 'Muy rara')
add('Pociones', 'Poción de aliento de fuego', 'Potion of Fire Breath', 'Poco común. Durante 1 hora puedes exhalar fuego 3 veces sobre una criatura a 30 pies: salvación de Des CD 13, 4d6 de fuego (mitad si la supera).', True, 3,
    {"t": "dmg", "dice": "4d6", "dtype": "fuego", "range": 6, "mode": "save", "dc": 13, "half": True}, 'Poco común')
for n, en, d, r in [
 ('Poción de amistad animal', 'Potion of Animal Friendship', 'Lanzas Amistad animal (CD 13) durante 1 hora.', 'Poco común'),
 ('Poción de clarividencia', 'Potion of Clairvoyance', 'Obtienes el efecto de Clarividencia.', 'Rara'),
 ('Poción de trepar', 'Potion of Climbing', 'Velocidad de trepar igual a la de caminar y ventaja en Atletismo para trepar durante 1 hora.', 'Común'),
 ('Poción de disminución', 'Potion of Diminution', 'Efecto de Agrandar/Reducir (reducir) durante 1d4 horas.', 'Rara'),
 ('Poción de vuelo', 'Potion of Flying', 'Velocidad de vuelo igual a la de caminar durante 1 hora.', 'Muy rara'),
 ('Poción de forma gaseosa', 'Potion of Gaseous Form', 'Efecto de Forma gaseosa durante 1 hora.', 'Rara'),
 ('Poción de fuerza de gigante de las colinas', 'Potion of Hill Giant Strength', 'Fuerza 21 durante 1 hora.', 'Poco común'),
 ('Poción de fuerza de gigante de escarcha', 'Potion of Frost Giant Strength', 'Fuerza 23 durante 1 hora.', 'Rara'),
 ('Poción de fuerza de gigante de piedra', 'Potion of Stone Giant Strength', 'Fuerza 23 durante 1 hora.', 'Rara'),
 ('Poción de fuerza de gigante de fuego', 'Potion of Fire Giant Strength', 'Fuerza 25 durante 1 hora.', 'Rara'),
 ('Poción de fuerza de gigante de las nubes', 'Potion of Cloud Giant Strength', 'Fuerza 27 durante 1 hora.', 'Muy rara'),
 ('Poción de fuerza de gigante de las tormentas', 'Potion of Storm Giant Strength', 'Fuerza 29 durante 1 hora.', 'Legendaria'),
 ('Poción de crecimiento', 'Potion of Growth', 'Efecto de Agrandar/Reducir (agrandar) durante 1d4 horas.', 'Poco común'),
 ('Poción de heroísmo', 'Potion of Heroism', '10 PV temporales y efecto de Bendición durante 1 hora.', 'Rara'),
 ('Poción de invisibilidad', 'Potion of Invisibility', 'Invisible durante 1 hora o hasta que ataques o lances un conjuro.', 'Muy rara'),
 ('Poción de invulnerabilidad', 'Potion of Invulnerability', 'Resistencia a todo el daño durante 1 minuto.', 'Rara'),
 ('Poción de longevidad', 'Potion of Longevity', 'Tu edad física se reduce 1d6 + 6 años.', 'Muy rara'),
 ('Poción de leer mentes', 'Potion of Mind Reading', 'Efecto de Detectar pensamientos (CD 13).', 'Rara'),
 ('Poción de veneno', 'Potion of Poison', 'Parece una poción beneficiosa, pero es veneno: el DM resuelve su efecto.', 'Poco común'),
 ('Poción de resistencia', 'Potion of Resistance', 'Resistencia a un tipo de daño durante 1 hora.', 'Poco común'),
 ('Poción de velocidad', 'Potion of Speed', 'Efecto de Acelerar durante 1 minuto.', 'Muy rara'),
 ('Poción de vitalidad', 'Potion of Vitality', 'Elimina el cansancio y el estado Envenenado; los Dados de Golpe curan al máximo durante 24 horas.', 'Muy rara'),
 ('Poción de respirar bajo el agua', 'Potion of Water Breathing', 'Respiras bajo el agua durante 24 horas.', 'Poco común'),
 ('Elixir de salud', 'Elixir of Health', 'Cura enfermedades y elimina Cegado, Ensordecido, Paralizado y Envenenado.', 'Rara'),
 ('Aceite de eterealidad', 'Oil of Etherealness', 'Efecto de Eterealidad durante 1 hora.', 'Rara'),
 ('Aceite de afilado', 'Oil of Sharpness', 'Un arma cortante o perforante obtiene +3 durante 1 hora.', 'Muy rara'),
 ('Aceite de resbalamiento', 'Oil of Slipperiness', 'Efecto de Libertad de movimiento durante 8 horas.', 'Poco común'),
 ('Filtro de amor', 'Philter of Love', 'Quedas hechizado por la siguiente criatura que veas durante 1 hora.', 'Poco común'),
]:
    add('Pociones', n, en, d, True, 1, NOTE, r)

# ---------------- Pergaminos ----------------
for lvl, r in [(0, 'Común'), (1, 'Común'), (2, 'Poco común'), (3, 'Poco común'), (4, 'Rara'), (5, 'Rara'),
               (6, 'Muy rara'), (7, 'Muy rara'), (8, 'Muy rara'), (9, 'Legendaria')]:
    lab = 'truco' if lvl == 0 else 'nivel ' + str(lvl)
    add('Pergaminos', 'Pergamino de conjuro (' + lab + ')', 'Spell Scroll Level ' + str(lvl),
        'Contiene un conjuro de ' + lab + '. Se consume al lanzarlo; el DM indica el conjuro.', True, 1, NOTE, r)

# ---------------- Objetos mágicos ----------------
for b, r in [(1, 'Poco común'), (2, 'Rara'), (3, 'Muy rara')]:
    add('Objetos mágicos', 'Arma +' + str(b), 'Weapon +' + str(b), '+' + str(b) + ' a las tiradas de ataque y daño.', rarity=r)
    add('Objetos mágicos', 'Armadura +' + str(b), 'Armor +' + str(b), '+' + str(b) + ' a la CA.', rarity={1: 'Rara', 2: 'Muy rara', 3: 'Legendaria'}[b])
    add('Objetos mágicos', 'Escudo +' + str(b), 'Shield +' + str(b), '+' + str(b) + ' a la CA además del escudo.', rarity={1: 'Poco común', 2: 'Rara', 3: 'Muy rara'}[b])
    add('Objetos mágicos', 'Munición +' + str(b), 'Ammunition +' + str(b), '+' + str(b) + ' a ataque y daño; se consume al impactar.', True, 10, NOTE, r)
add('Objetos mágicos', 'Varita de proyectil mágico', 'Wand of Magic Missiles', '7 cargas. Gasta 1: tres dardos de fuerza que impactan siempre, 3d4 + 3 de daño a un objetivo a 120 pies.', True, 7,
    {"t": "dmg", "dice": "3d4+3", "dtype": "fuerza", "range": 8, "mode": "auto", "keep": True}, 'Poco común')
add('Objetos mágicos', 'Varita de bolas de fuego', 'Wand of Fireballs', '7 cargas. Gasta 1: bola de fuego, salvación de Des CD 15, 8d6 de fuego (mitad si la supera).', True, 7,
    {"t": "dmg", "dice": "8d6", "dtype": "fuego", "range": 8, "mode": "save", "dc": 15, "half": True, "keep": True}, 'Rara')
add('Objetos mágicos', 'Varita de relámpagos', 'Wand of Lightning Bolts', '7 cargas. Gasta 1: relámpago, salvación de Des CD 15, 8d6 de rayo (mitad si la supera).', True, 7,
    {"t": "dmg", "dice": "8d6", "dtype": "rayo", "range": 8, "mode": "save", "dc": 15, "half": True, "keep": True}, 'Rara')
add('Objetos mágicos', 'Collar de bolas de fuego (cuenta)', 'Necklace of Fireballs', 'Cada cuenta lanzada estalla: salvación de Des CD 15, 8d6 de fuego (mitad si la supera).', True, 3,
    {"t": "dmg", "dice": "8d6", "dtype": "fuego", "range": 12 // 2, "mode": "save", "dc": 15, "half": True}, 'Rara')
for n, en, d, r in [
 ('Varita de telaraña', 'Wand of Web', '7 cargas: lanza Telaraña (CD 15).', 'Poco común'),
 ('Bastón de curación', 'Staff of Healing', '10 cargas: Curar heridas, Restablecimiento menor y Curar heridas en masa.', 'Rara'),
 ('Bolsa de contención', 'Bag of Holding', 'Guarda hasta 500 lb en un espacio extradimensional.', 'Poco común'),
 ('Botas élficas', 'Boots of Elvenkind', 'Ventaja en Sigilo para moverte en silencio.', 'Poco común'),
 ('Botas de velocidad', 'Boots of Speed', 'Duplica tu velocidad durante 10 minutos.', 'Rara'),
 ('Brazales de defensa', 'Bracers of Defense', '+2 a la CA sin armadura ni escudo.', 'Rara'),
 ('Capa élfica', 'Cloak of Elvenkind', 'Ventaja en Sigilo para esconderte.', 'Poco común'),
 ('Capa de protección', 'Cloak of Protection', '+1 a la CA y a las salvaciones.', 'Poco común'),
 ('Capa de invisibilidad', 'Cloak of Invisibility', 'Te vuelve invisible mientras llevas la capucha.', 'Legendaria'),
 ('Anillo de protección', 'Ring of Protection', '+1 a la CA y a las salvaciones.', 'Rara'),
 ('Anillo de caída de pluma', 'Ring of Feather Falling', 'Caes a 60 pies por ronda sin daño.', 'Rara'),
 ('Anillo de invisibilidad', 'Ring of Invisibility', 'Te vuelves invisible a voluntad.', 'Legendaria'),
 ('Anillo de regeneración', 'Ring of Regeneration', 'Recuperas 1d6 PV cada 10 minutos.', 'Muy rara'),
 ('Amuleto de salud', 'Amulet of Health', 'Constitución 19.', 'Rara'),
 ('Guanteletes de poder de ogro', 'Gauntlets of Ogre Power', 'Fuerza 19.', 'Poco común'),
 ('Cinturón de fuerza de gigante de las colinas', 'Belt of Hill Giant Strength', 'Fuerza 21.', 'Rara'),
 ('Diadema de intelecto', 'Headband of Intellect', 'Inteligencia 19.', 'Poco común'),
 ('Sombrero de disfraz', 'Hat of Disguise', 'Lanza Disfrazarse a voluntad.', 'Poco común'),
 ('Guantes de ladrón', 'Gloves of Thievery', 'Invisibles y +5 a Juego de manos.', 'Poco común'),
 ('Vara inamovible', 'Immovable Rod', 'Queda fija en el aire al pulsar su botón.', 'Poco común'),
 ('Linterna reveladora', 'Lantern of Revealing', 'Revela criaturas y objetos invisibles.', 'Poco común'),
 ('Cuerda de escalada', 'Rope of Climbing', 'Se mueve y anuda a tus órdenes.', 'Poco común'),
 ('Piedras de comunicación', 'Sending Stones', 'Lanza Recado entre las dos piedras una vez al día.', 'Poco común'),
 ('Escudo centinela', 'Sentinel Shield', 'Ventaja en iniciativa y en Percepción.', 'Poco común'),
 ('Periapto de cierre de heridas', 'Periapt of Wound Closure', 'Te estabilizas solo y duplicas la curación con Dados de Golpe.', 'Poco común'),
 ('Cuenta de alimento', 'Bead of Nourishment', 'Alimenta como un día de comida.', 'Común'),
 ('Jarra de agua inagotable', 'Decanter of Endless Water', 'Produce agua a voluntad.', 'Poco común'),
 ('Orbe flotante', 'Driftglobe', 'Esfera de luz que flota a tu lado.', 'Poco común'),
 ('Armadura de mithral', 'Mithral Armor', 'Sin desventaja en Sigilo ni requisito de Fuerza.', 'Poco común'),
 ('Armadura de adamantina', 'Adamantine Armor', 'Los críticos contra ti son impactos normales.', 'Poco común'),
 ('Lengua de fuego', 'Flame Tongue', 'Arma que arde: +2d6 de daño de fuego al impactar.', 'Rara'),
 ('Marca de escarcha', 'Frost Brand', 'Arma helada: +1d6 de frío y resistencia al fuego.', 'Muy rara'),
 ('Espada solar', 'Sun Blade', 'Hoja de luz radiante +2; daño extra a no muertos.', 'Rara'),
 ('Espada vorpal', 'Vorpal Sword', 'Espada +3; un 20 natural puede decapitar.', 'Legendaria'),
 ('Jabalina de relámpago', 'Javelin of Lightning', 'Una vez al día se convierte en un relámpago de 4d6.', 'Poco común'),
 ('Polvo de desaparición', 'Dust of Disappearance', 'Te vuelve invisible 2d4 minutos.', 'Poco común'),
]:
    add('Objetos mágicos', n, en, d, rarity=r)

# ---------------- Metadatos de equipo (eq) ----------------
RANGED = {'dart', 'light-crossbow', 'shortbow', 'sling', 'blowgun', 'hand-crossbow', 'heavy-crossbow', 'longbow', 'musket', 'pistol'}
for it in ITEMS:
    if it['cat'] == 'Armas':
        d = it['descr']
        dice, dtype = d.split(' · ')[0].split(' ')[:2]
        props = d.split(' · ')[1] if ' · ' in d else ''
        rng = 1
        if it['id'] in RANGED:
            mm = re.search(r'\((\d+)/', props); rng = min(20, max(1, int(mm.group(1)) // 5)) if mm else 4
        elif 'Alcance' in props:
            rng = 2
        it['eq'] = {"slot": "weapon", "dice": dice, "dtype": dtype, "range": rng,
                    "ranged": it['id'] in RANGED, "finesse": 'Sutil' in props, "twoh": 'A dos manos' in props}
ARMOR = {'padded-armor': (11, 'full', 0, True), 'leather-armor': (11, 'full', 0, False), 'studded-leather-armor': (12, 'full', 0, False),
         'hide-armor': (12, 'max2', 0, False), 'chain-shirt': (13, 'max2', 0, False), 'scale-mail': (14, 'max2', 0, True),
         'breastplate': (14, 'max2', 0, False), 'half-plate-armor': (15, 'max2', 0, True), 'ring-mail': (14, 'none', 0, True),
         'chain-mail': (16, 'none', 13, True), 'splint-armor': (17, 'none', 15, True), 'plate-armor': (18, 'none', 15, True)}
EQ = {k: {"slot": "armor", "ac": v[0], "dex": v[1], "str": v[2], "stealth": v[3]} for k, v in ARMOR.items()}
EQ.update({
 'shield': {"slot": "shield", "ac": 2},
 'sentinel-shield': {"slot": "shield", "ac": 2},
 'weapon-1': {"slot": "acc", "watk": 1, "wdmg": 1}, 'weapon-2': {"slot": "acc", "watk": 2, "wdmg": 2}, 'weapon-3': {"slot": "acc", "watk": 3, "wdmg": 3},
 'armor-1': {"slot": "acc", "ac": 1, "needArmor": True}, 'armor-2': {"slot": "acc", "ac": 2, "needArmor": True}, 'armor-3': {"slot": "acc", "ac": 3, "needArmor": True},
 'shield-1': {"slot": "acc", "ac": 1, "needShield": True}, 'shield-2': {"slot": "acc", "ac": 2, "needShield": True}, 'shield-3': {"slot": "acc", "ac": 3, "needShield": True},
 'cloak-of-protection': {"slot": "acc", "ac": 1, "save": 1, "attune": True},
 'ring-of-protection': {"slot": "acc", "ac": 1, "save": 1, "attune": True},
 'bracers-of-defense': {"slot": "acc", "ac": 2, "noArmor": True, "noShield": True, "attune": True},
 'amulet-of-health': {"slot": "acc", "set": {"con": 19}, "attune": True},
 'gauntlets-of-ogre-power': {"slot": "acc", "set": {"str": 19}, "attune": True},
 'belt-of-hill-giant-strength': {"slot": "acc", "set": {"str": 21}, "attune": True},
 'headband-of-intellect': {"slot": "acc", "set": {"int": 19}, "attune": True},
 'flame-tongue': {"slot": "acc", "wextra": "2d6", "attune": True},
 'frost-brand': {"slot": "acc", "wextra": "1d6", "attune": True},
 'sun-blade': {"slot": "weapon", "dice": "1d8", "dtype": "radiante", "range": 1, "finesse": True, "bonus": 2, "attune": True},
 'vorpal-sword': {"slot": "weapon", "dice": "1d8", "dtype": "cortante", "range": 1, "bonus": 3, "attune": True},
 'javelin-of-lightning': {"slot": "weapon", "dice": "1d6", "dtype": "perforante", "range": 6},
})
for k in ['boots-of-elvenkind', 'boots-of-speed', 'cloak-of-elvenkind', 'cloak-of-invisibility', 'ring-of-feather-falling',
          'ring-of-invisibility', 'ring-of-regeneration', 'hat-of-disguise', 'gloves-of-thievery', 'periapt-of-wound-closure',
          'mithral-armor', 'adamantine-armor', 'lantern-of-revealing', 'staff-of-healing', 'wand-of-web']:
    EQ[k] = {"slot": "acc", "attune": k in ('boots-of-speed', 'cloak-of-invisibility', 'ring-of-invisibility', 'ring-of-regeneration', 'staff-of-healing')}
for it in ITEMS:
    if it['id'] in EQ: it['eq'] = EQ[it['id']]
    it.setdefault('eq', None)

# ---------------- SQL ----------------
def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, int): return str(v)
    if isinstance(v, (dict, list)): return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"

ids = [i['id'] for i in ITEMS]
assert len(ids) == len(set(ids)), 'ids duplicados'
rows = ',\n'.join('(' + ', '.join(q(i[k]) for k in ['id', 'cat', 'name', 'en', 'descr', 'consumable', 'qty', 'fx', 'rarity', 'eq']) + ')' for i in ITEMS)
sql = f"""-- ============================================================
-- Mesa de Rol — VTT · Catálogo de objetos D&D 5e (reglas 2024)
-- Generado por supabase/gen_items.py — {len(ITEMS)} objetos.
-- Mecánicas: System Reference Document 5.2 (SRD 5.2) de Wizards of the Coast LLC,
-- licencia CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/). Traducción y textos propios.
-- ============================================================
create table if not exists public.items (
  id text primary key, cat text not null, name text not null, en text, descr text,
  consumable boolean not null default false, qty int not null default 1, fx jsonb, rarity text, eq jsonb
);
alter table public.items add column if not exists eq jsonb;
alter table public.items enable row level security;
drop policy if exists items_select on public.items;
create policy items_select on public.items for select using (true);

insert into public.items (id, cat, name, en, descr, consumable, qty, fx, rarity, eq) values
{rows}
on conflict (id) do update set cat = excluded.cat, name = excluded.name, en = excluded.en, descr = excluded.descr,
  consumable = excluded.consumable, qty = excluded.qty, fx = excluded.fx, rarity = excluded.rarity, eq = excluded.eq;
"""
open('/home/claude/vtt-dnd/supabase/items.sql', 'w', encoding='utf-8').write(sql)
eqs = [i for i in ITEMS if i['eq']]
upd = '\n'.join("update public.items set eq = " + q(i['eq']) + " where id = " + q(i['id']) + ";" for i in eqs)
open('/home/claude/vtt-dnd/supabase/equipment_items.sql', 'w', encoding='utf-8').write(
    "-- Metadatos de equipo (generado por gen_items.py). Re-ejecutable.\nalter table public.items add column if not exists eq jsonb;\n" + upd + "\n")
print('equipables:', len(eqs))
from collections import Counter
print(len(ITEMS), dict(Counter(i['cat'] for i in ITEMS)), 'con efecto automático:', sum(1 for i in ITEMS if i['fx'] and i['fx']['t'] != 'note'))
