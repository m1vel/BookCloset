"""Generates test books in many formats from public-domain texts (samples/src/*.json).

Run:  python scripts/make_samples.py
Needs: Pillow, python-docx. WinRAR (Rar.exe) for CBR if available.
"""
import base64, io, json, os, random, shutil, struct, subprocess, tarfile, textwrap, zipfile, html
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
S = ROOT / 'samples'
SRC = S / 'src'
FONTS = Path('C:/Windows/Fonts')


def font(name, size):
    for n in [name, 'georgia.ttf', 'arial.ttf']:
        p = FONTS / n
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


# ------------------------------------------------------------------ images
def make_cover(title, author, colors, size=(800, 1200), ornament=True):
    w, h = size
    img = Image.new('RGB', size, colors[0])
    d = ImageDraw.Draw(img)
    for y in range(h):  # vertical gradient
        t = y / h
        c = tuple(int(colors[0][i] * (1 - t) + colors[1][i] * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    rnd = random.Random(title)
    for _ in range(40):  # soft stars / bokeh
        x, y, r = rnd.randint(0, w), rnd.randint(0, int(h * .6)), rnd.randint(2, 9)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 240, 210))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    d = ImageDraw.Draw(img)
    # hills
    d.polygon([(0, h * .72), (w * .3, h * .62), (w * .6, h * .7), (w, h * .6), (w, h), (0, h)], fill=tuple(max(0, c - 40) for c in colors[1]))
    d.polygon([(0, h * .82), (w * .45, h * .74), (w, h * .84), (w, h), (0, h)], fill=tuple(max(0, c - 70) for c in colors[1]))
    gold = (233, 201, 143)
    d.rectangle([40, 40, w - 40, h - 40], outline=gold, width=3)
    d.rectangle([54, 54, w - 54, h - 54], outline=gold, width=1)
    fa = font('georgia.ttf', 40)
    ft = font('georgiab.ttf', 92)
    d.text((w / 2, 170), author.upper(), font=fa, fill=gold, anchor='mm')
    lines = textwrap.wrap(title, 14)
    y = 330
    for line in lines:
        d.text((w / 2, y), line, font=ft, fill=(255, 248, 235), anchor='mm')
        y += 110
    if ornament:
        d.line([(w / 2 - 120, y + 10), (w / 2 + 120, y + 10)], fill=gold, width=2)
        d.regular_polygon((w / 2, y + 10, 12), 4, fill=gold)
    return img


def make_illustration(seed, size=(900, 560), caption=''):
    rnd = random.Random(seed)
    img = Image.new('RGB', size, (246, 238, 222))
    d = ImageDraw.Draw(img)
    w, h = size
    for i in range(7):
        x = rnd.randint(0, w)
        r = rnd.randint(80, 220)
        col = rnd.choice([(196, 120, 72), (88, 120, 150), (120, 150, 98), (170, 90, 90), (210, 170, 90)])
        d.ellipse([x - r, h * .55 - r, x + r, h * .55 + r], fill=col)
    img = img.filter(ImageFilter.GaussianBlur(18))
    d = ImageDraw.Draw(img)
    d.polygon([(0, h * .75), (w * .5, h * .55), (w, h * .78), (w, h), (0, h)], fill=(60, 70, 60))
    for i in range(18):  # fence posts
        x = 30 + i * (w - 60) / 17
        d.rectangle([x - 4, h * .7, x + 4, h * .92], fill=(40, 30, 25))
    d.line([(20, h * .76), (w - 20, h * .76)], fill=(40, 30, 25), width=5)
    if caption:
        d.text((w / 2, 40), caption, font=font('georgiai.ttf', 34), fill=(60, 40, 25), anchor='mm')
    return img


def png_bytes(img, fmt='PNG', **kw):
    b = io.BytesIO()
    img.save(b, fmt, **kw)
    return b.getvalue()


# ------------------------------------------------------------------ texts
kap = json.load(open(SRC / 'kapitanskaya.json', encoding='utf-8'))
kash = json.load(open(SRC / 'kashtanka.json', encoding='utf-8'))

KAP_TITLE, KAP_AUTHOR = 'Капитанская дочка', 'Александр Пушкин'
KASH_TITLE, KASH_AUTHOR = 'Каштанка', 'Антон Чехов'

kap_cover = make_cover(KAP_TITLE, 'А. С. Пушкин', [(126, 44, 36), (40, 30, 52)])
kash_cover = make_cover(KASH_TITLE, 'А. П. Чехов', [(32, 64, 96), (196, 120, 60)])
kap_illu = make_illustration('kap', caption='Белогорская крепость')
kash_illu = make_illustration('kash', caption='Зимний вечер')

# Chekhov: split into chapters by h3
kash_chapters = []
for tag, text in kash:
    if tag in ('h2', 'h3'):
        kash_chapters.append({'title': text, 'paras': []})
    elif kash_chapters:
        kash_chapters[-1]['paras'].append(text)
kash_chapters = [c for c in kash_chapters if c['paras']]


def x(s):
    return html.escape(s, quote=False)


# ------------------------------------------------------------------ FB2
def make_fb2(encoding='utf-8'):
    cover_b64 = base64.b64encode(png_bytes(kap_cover.resize((400, 600)), 'JPEG', quality=85)).decode()
    illu_b64 = base64.b64encode(png_bytes(kap_illu, 'JPEG', quality=80)).decode()
    sections = []
    for i, ch in enumerate(kap):
        parts = [f'<section><title><p>Глава {ch["num"]}</p><p>{x(ch["title"])}</p></title>']
        items = ch['items']
        # leading poems are epigraphs
        j = 0
        while j < len(items) and items[j][0] == 'poem':
            lines = ''.join(f'<v>{x(l)}</v>' for l in items[j][1].split('\n') if l.strip())
            parts.append(f'<epigraph><poem><stanza>{lines}</stanza></poem></epigraph>')
            j += 1
        if i == 2:
            parts.append('<image l:href="#illu.jpg"/>')
        for kind, text in items[j:]:
            if kind == 'poem':
                lines = ''.join(f'<v>{x(l)}</v>' for l in text.split('\n') if l.strip())
                parts.append(f'<poem><stanza>{lines}</stanza></poem>')
            else:
                t = x(text)
                if i == 0 and 'Гринев' in text and '<a' not in t:
                    t = t.replace('Гринев', 'Гринев<a l:href="#n1" type="note">[1]</a>', 1)
                parts.append(f'<p>{t}</p>')
        parts.append('</section>')
        sections.append(''.join(parts))
    xml = f'''<?xml version="1.0" encoding="{encoding}"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
 <title-info>
  <genre>prose_rus_classic</genre>
  <author><first-name>Александр</first-name><middle-name>Сергеевич</middle-name><last-name>Пушкин</last-name></author>
  <book-title>{KAP_TITLE}</book-title>
  <annotation><p>Исторический роман о Пугачёвском восстании. «Береги честь смолоду» — эпиграф, ставший пословицей.</p></annotation>
  <date value="1836">1836</date>
  <coverpage><image l:href="#cover.jpg"/></coverpage>
  <lang>ru</lang>
  <sequence name="Русская классика" number="1"/>
 </title-info>
 <document-info><author><nickname>BookCloset</nickname></author><id>bc-kapitanskaya-dochka</id><version>1.0</version></document-info>
 <publish-info><publisher>Викитека</publisher><year>1960</year></publish-info>
</description>
<body>
 <title><p>{KAP_AUTHOR}</p><p>{KAP_TITLE}</p></title>
 <epigraph><p>Береги честь смолоду.</p><text-author>Пословица</text-author></epigraph>
 {''.join(sections)}
</body>
<body name="notes">
 <title><p>Примечания</p></title>
 <section id="n1"><title><p>1</p></title><p>Пётр Андреевич Гринёв — рассказчик и главный герой романа.</p></section>
</body>
<binary id="cover.jpg" content-type="image/jpeg">{cover_b64}</binary>
<binary id="illu.jpg" content-type="image/jpeg">{illu_b64}</binary>
</FictionBook>'''
    return xml.encode(encoding, errors='replace')


(S / 'Пушкин - Капитанская дочка.fb2').write_bytes(make_fb2())
(S / 'Пушкин - Капитанская дочка (windows-1251).fb2').write_bytes(make_fb2('windows-1251'))
with zipfile.ZipFile(S / 'Пушкин - Капитанская дочка.fb2.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('Pushkin_Kapitanskaya_dochka.fb2', make_fb2())

# ------------------------------------------------------------------ TXT (various encodings)
def kap_text():
    out = [KAP_AUTHOR, KAP_TITLE, '', 'Береги честь смолоду.', '']
    for ch in kap:
        out += ['', f'Глава {ch["num"]}. {ch["title"]}', '']
        for kind, text in ch['items']:
            if kind == 'poem':
                out += ['    ' + l for l in text.split('\n')] + ['']
            else:
                out.append('    ' + text)
    return '\r\n'.join(out)


def kash_text():
    out = [KASH_AUTHOR, KASH_TITLE, '']
    for ch in kash_chapters:
        out += ['', ch['title'].upper(), '']
        for p in ch['paras']:
            out += [p, '']
    return '\n'.join(out)


(S / 'Пушкин - Капитанская дочка (cp1251).txt').write_bytes(kap_text().encode('cp1251', errors='replace'))
(S / 'Чехов - Каштанка.txt').write_text(kash_text(), encoding='utf-8')
(S / 'Чехов - Каштанка (koi8-r).txt').write_bytes(kash_text().replace('\xa0', ' ').encode('koi8_r', errors='replace'))
shutil.copy(SRC / 'alice.txt', S / 'Alice in Wonderland.txt')
with zipfile.ZipFile(S / 'Каштанка в архиве.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('kashtanka.txt', kash_text())

# ------------------------------------------------------------------ HTML (self-contained)
def data_uri(img, fmt='JPEG'):
    return f'data:image/{fmt.lower()};base64,' + base64.b64encode(png_bytes(img, fmt, quality=82)).decode()


def kap_html():
    body = [f'<h1>{KAP_TITLE}</h1><p class="author">{KAP_AUTHOR}</p>',
            f'<p><img src="{data_uri(kap_cover.resize((400, 600)))}" alt="Обложка" style="width:240px"></p>']
    for i, ch in enumerate(kap):
        body.append(f'<h2>Глава {ch["num"]}<br><small>{x(ch["title"])}</small></h2>')
        for kind, text in ch['items']:
            if kind == 'poem':
                body.append('<blockquote>' + '<br>'.join(x(l) for l in text.split('\n')) + '</blockquote>')
            else:
                body.append(f'<p>{x(text)}</p>')
        if i == 1:
            body.append(f'<figure><img src="{data_uri(kap_illu)}" alt="Иллюстрация"><figcaption>Буран в степи</figcaption></figure>')
    return f'''<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>{KAP_TITLE}</title>
<meta name="author" content="{KAP_AUTHOR}">
<style>body{{font-family:Georgia;max-width:40em;margin:auto}} .author{{font-style:italic}} figure{{text-align:center}}</style>
<script>document.title='hacked'</script></head><body>{''.join(body)}</body></html>'''


(S / 'Пушкин - Капитанская дочка.html').write_text(kap_html(), encoding='utf-8')

# ------------------------------------------------------------------ MHT
def make_mht():
    img = png_bytes(kash_illu, 'JPEG', quality=80)
    paras = ''.join(f'<p>{x(p)}</p>' for p in kash_chapters[0]['paras'])
    page = f'''<!DOCTYPE html><html><head><meta charset="utf-8"><title>{KASH_TITLE} — веб-архив</title></head>
<body><h1>{KASH_TITLE}</h1><h2>{x(kash_chapters[0]["title"])}</h2><img src="https://example.org/img/winter.jpg">{paras}</body></html>'''
    b = 'NextPart_BookCloset_000'
    subject = '=?utf-8?B?' + base64.b64encode(KASH_TITLE.encode()).decode() + '?='
    out = (f'From: <Saved by BookCloset>\r\nSubject: {subject}\r\nMIME-Version: 1.0\r\n'
           f'Content-Type: multipart/related; type="text/html"; boundary="{b}"\r\n\r\n'
           f'--{b}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n'
           f'Content-Location: https://example.org/kashtanka.html\r\n\r\n'
           + base64.encodebytes(page.encode('utf-8')).decode() +
           f'\r\n--{b}\r\nContent-Type: image/jpeg\r\nContent-Transfer-Encoding: base64\r\n'
           f'Content-Location: https://example.org/img/winter.jpg\r\n\r\n'
           + base64.encodebytes(img).decode() + f'\r\n--{b}--\r\n')
    return out.encode('ascii')


(S / 'Чехов - Каштанка (веб-архив).mht').write_bytes(make_mht())

# ------------------------------------------------------------------ Markdown
(S / 'BookCloset — заметки.md').write_text(f'''# BookCloset

Читалка, которая открывает **любые** книги: _EPUB, FB2, PDF, MOBI, DjVu_ и ещё два десятка форматов.

> «Береги честь смолоду» — А. С. Пушкин

## Возможности

1. Библиотека с обложками и коллекциями
2. Постраничный режим и прокрутка
3. Выделения, заметки, закладки
4. Статистика чтения

| Формат | Движок |
|---|---|
| EPUB | reflow |
| PDF | pages |

```js
const hello = "мир"
console.log(hello)
```

![Иллюстрация]({data_uri(kash_illu.resize((450, 280)))})

## Второй раздел

Текст второго раздела. Здесь проверяется оглавление, которое строится по заголовкам.
''', encoding='utf-8')

# ------------------------------------------------------------------ DOCX
try:
    from docx import Document
    from docx.shared import Inches, Pt
    doc = Document()
    doc.core_properties.title = KASH_TITLE
    doc.core_properties.author = KASH_AUTHOR
    doc.add_heading(KASH_TITLE, 0)
    p = doc.add_paragraph()
    p.add_run(KASH_AUTHOR).italic = True
    doc.add_picture(io.BytesIO(png_bytes(kash_cover.resize((400, 600)))), width=Inches(2.6))
    for i, ch in enumerate(kash_chapters):
        doc.add_heading(ch['title'], 1)
        for j, para in enumerate(ch['paras']):
            p = doc.add_paragraph()
            if j == 0:
                r = p.add_run(para[:1]); r.bold = True; r.font.size = Pt(16)
                p.add_run(para[1:])
            else:
                p.add_run(para)
        if i == 0:
            doc.add_picture(io.BytesIO(png_bytes(kash_illu)), width=Inches(5))
            t = doc.add_table(rows=3, cols=2)
            t.style = 'Table Grid'
            for r, (a, b) in enumerate([('Персонаж', 'Кто'), ('Каштанка', 'собака'), ('Лука Александрыч', 'столяр')]):
                t.cell(r, 0).text, t.cell(r, 1).text = a, b
    doc.save(S / 'Чехов - Каштанка.docx')
except ImportError:
    print('python-docx not installed, skipping DOCX')

# ------------------------------------------------------------------ RTF
def rtf_escape(s):
    out = []
    for ch in s:
        o = ord(ch)
        if ch in '\\{}':
            out.append('\\' + ch)
        elif o < 128:
            out.append(ch)
        else:
            out.append(f'\\u{o if o < 32768 else o - 65536}?')
    return ''.join(out)


def make_rtf():
    pic = png_bytes(kap_illu.resize((600, 373)))
    w, h = 600, 373
    parts = [r'{\rtf1\ansi\ansicpg1251\deff0{\fonttbl{\f0\froman\fcharset204 Georgia;}{\f1\fswiss\fcharset204 Arial;}}',
             r'{\info{\title ' + rtf_escape(KAP_TITLE) + r'}{\author ' + rtf_escape(KAP_AUTHOR) + '}}',
             r'\f0\fs24\sa120',
             r'{\pard\qc\b\fs48 ' + rtf_escape(KAP_TITLE) + r'\par}',
             r'{\pard\qc\i\fs28 ' + rtf_escape(KAP_AUTHOR) + r'\par}',
             r'{\pard\qc{\pict\pngblip\picw' + str(w) + r'\pich' + str(h) + r'\picwgoal' + str(w * 15) + r'\pichgoal' + str(h * 15) + ' ' + pic.hex() + r'}\par}']
    for ch in kap[:5]:
        parts.append(r'{\pard\sb360\sa120\b\fs32 ' + rtf_escape(f'Глава {ch["num"]}. {ch["title"]}') + r'\par}')
        for kind, text in ch['items']:
            if kind == 'poem':
                parts.append(r'{\pard\li720\i ' + r'\line '.join(rtf_escape(l) for l in text.split('\n')) + r'\par}')
            else:
                parts.append(r'{\pard\fi360\qj ' + rtf_escape(text) + r'\par}')
    parts.append('}')
    return '\n'.join(parts).encode('ascii')


(S / 'Пушкин - Капитанская дочка (главы I-V).rtf').write_bytes(make_rtf())

# ------------------------------------------------------------------ ODT
def make_odt():
    img = png_bytes(kash_illu, 'PNG')
    body = [f'<text:h text:outline-level="1">{x(KASH_TITLE)}</text:h>',
            f'<text:p text:style-name="Author">{x(KASH_AUTHOR)}</text:p>',
            '<text:p><draw:frame draw:name="img1" text:anchor-type="paragraph" svg:width="15cm" svg:height="9.3cm">'
            '<draw:image xlink:href="Pictures/illu.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>']
    for ch in kash_chapters:
        body.append(f'<text:h text:outline-level="2">{x(ch["title"])}</text:h>')
        for i, p in enumerate(ch['paras']):
            if i == 1:
                words = p.split(' ', 3)
                if len(words) > 3:
                    body.append(f'<text:p><text:span text:style-name="B">{x(" ".join(words[:3]))}</text:span> {x(words[3])}</text:p>')
                    continue
            body.append(f'<text:p>{x(p)}</text:p>')
    body.append('<text:list><text:list-item><text:p>Первый пункт</text:p></text:list-item><text:list-item><text:p>Второй пункт</text:p></text:list-item></text:list>')
    content = f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2">
<office:automatic-styles>
 <style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
 <style:style style:name="Author" style:family="paragraph"><style:text-properties fo:font-style="italic"/></style:style>
</office:automatic-styles>
<office:body><office:text>{''.join(body)}</office:text></office:body></office:document-content>'''
    meta = f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2">
<office:meta><dc:title>{KASH_TITLE}</dc:title><meta:initial-creator>{KASH_AUTHOR}</meta:initial-creator><dc:language>ru</dc:language></office:meta></office:document-meta>'''
    manifest = '''<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="Pictures/illu.png" manifest:media-type="image/png"/>
</manifest:manifest>'''
    path = S / 'Чехов - Каштанка.odt'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/vnd.oasis.opendocument.text', compress_type=zipfile.ZIP_STORED)
        z.writestr('content.xml', content, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('meta.xml', meta, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('META-INF/manifest.xml', manifest, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr('Pictures/illu.png', img, compress_type=zipfile.ZIP_STORED)


make_odt()

# ------------------------------------------------------------------ PalmDOC (.pdb, uncompressed)
def make_pdb():
    text = kash_text().encode('cp1251', errors='replace')
    recs = [text[i:i + 4096] for i in range(0, len(text), 4096)]
    rec0 = struct.pack('>HHIHHHH', 1, 0, len(text), len(recs), 4096, 0, 0)
    records = [rec0] + recs
    name = b'Kashtanka'.ljust(32, b'\0')
    header = name + struct.pack('>HHIIIIII4s4sIIH', 0, 0, 0, 0, 0, 0, 0, 0, b'TEXt', b'REAd', 0, 0, len(records))
    offset = len(header) + 8 * len(records) + 2
    entries = b''
    for i, r in enumerate(records):
        entries += struct.pack('>II', offset, i)
        offset += len(r)
    return header + entries + b'\0\0' + b''.join(records)


(S / 'Чехов - Каштанка.pdb').write_bytes(make_pdb())

# ------------------------------------------------------------------ comics
def comic_page(n, total):
    w, h = 1100, 1600
    rnd = random.Random(n * 7)
    img = Image.new('RGB', (w, h), (250, 247, 240))
    d = ImageDraw.Draw(img)
    pal = [(232, 93, 75), (66, 135, 245), (255, 196, 57), (92, 184, 120), (156, 102, 204), (240, 140, 60)]
    if n == 1:
        d.rectangle([0, 0, w, h], fill=(30, 36, 64))
        for i in range(60):
            x, y, r = rnd.randint(0, w), rnd.randint(0, h), rnd.randint(1, 4)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 220))
        d.ellipse([w / 2 - 260, 420, w / 2 + 260, 940], fill=(255, 196, 57))
        d.text((w / 2, 200), 'КОСМИЧЕСКИЙ', font=font('impact.ttf', 120), fill=(255, 255, 255), anchor='mm')
        d.text((w / 2, 330), 'КОТ', font=font('impact.ttf', 180), fill=(232, 93, 75), anchor='mm')
        d.text((w / 2, 1320), 'ВЫПУСК №1', font=font('arialbd.ttf', 60), fill=(255, 255, 255), anchor='mm')
        return img
    rows = rnd.choice([[1, 2], [2, 1, 2], [2, 2], [1, 1, 2]])
    gut = 24
    y = gut
    rh = (h - gut * (len(rows) + 1)) / len(rows)
    for cols in rows:
        cw = (w - gut * (cols + 1)) / cols
        for c in range(cols):
            x0 = gut + c * (cw + gut)
            col = rnd.choice(pal)
            d.rectangle([x0, y, x0 + cw, y + rh], fill=tuple(int(v * .35 + 255 * .65) for v in col), outline=(20, 20, 20), width=6)
            cx, cy = x0 + cw / 2, y + rh * .62
            d.ellipse([cx - 90, cy - 90, cx + 90, cy + 90], fill=col, outline=(20, 20, 20), width=5)
            d.polygon([(cx - 80, cy - 60), (cx - 50, cy - 140), (cx - 20, cy - 80)], fill=col, outline=(20, 20, 20))
            d.polygon([(cx + 80, cy - 60), (cx + 50, cy - 140), (cx + 20, cy - 80)], fill=col, outline=(20, 20, 20))
            bx, by = x0 + 30, y + 30
            d.rounded_rectangle([bx, by, bx + min(cw - 60, 380), by + 110], 40, fill=(255, 255, 255), outline=(20, 20, 20), width=4)
            d.text((bx + 24, by + 55), rnd.choice(['Мяу?!', 'Вперёд, к звёздам!', 'Где моя рыба?', 'Это ловушка!', 'Ура!']),
                   font=font('comicbd.ttf', 36), fill=(20, 20, 20), anchor='lm')
        y += rh + gut
    d.text((w - 40, h - 14), f'{n}/{total}', font=font('arialbd.ttf', 28), fill=(80, 80, 80), anchor='rb')
    return img


pages_dir = SRC / 'comic'
shutil.rmtree(pages_dir, ignore_errors=True)
pages_dir.mkdir(parents=True)
TOTAL = 9
for n in range(1, TOTAL + 1):
    comic_page(n, TOTAL).save(pages_dir / f'page_{n:02d}.jpg', 'JPEG', quality=84)
comicinfo = '''<?xml version="1.0"?><ComicInfo><Title>Космический кот</Title><Series>Космический кот</Series><Number>1</Number><Writer>BookCloset</Writer><Summary>Тестовый комикс из девяти страниц.</Summary><LanguageISO>ru</LanguageISO><Manga>No</Manga></ComicInfo>'''
(pages_dir / 'ComicInfo.xml').write_text(comicinfo, encoding='utf-8')
files = sorted(pages_dir.iterdir())
with zipfile.ZipFile(S / 'Космический кот #1.cbz', 'w') as z:
    for f in files:
        z.write(f, f.name)
with tarfile.open(S / 'Космический кот #1 (tar).cbt', 'w') as t:
    for f in files:
        t.add(f, f.name)
rar = Path('C:/Program Files/WinRAR/Rar.exe')
if rar.exists():
    out = S / 'Космический кот #1 (rar).cbr'
    out.unlink(missing_ok=True)
    subprocess.run([str(rar), 'a', '-ep', '-idq', str(out)] + [str(f) for f in files if f.suffix == '.jpg'], check=True)
kash_cover.save(S / 'Обложка-картинка.jpg', 'JPEG', quality=86)
print('samples generated')
