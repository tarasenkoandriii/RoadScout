# ТЗ: иллюстрации для лендинга Beyond the Wall (BTW) — детализировано под генерацию нейросетью

**Статус:** предложение к реализации, готово к использованию как основа для промптов
**Контекст:** визуальные материалы для `doc/TZ-btw-landing.md`. Каждый раздел ниже написан
так, чтобы его можно было почти дословно передать в генератор изображений — с точными
цветами (hex), композицией, что включить и что явно исключить.

---

## 0. Важное техническое замечание — прочитать перед началом

**Нейросети (Midjourney/DALL·E/Stable Diffusion/аналоги) генерируют РАСТР (PNG/JPG), не
настоящий векторный SVG.** Если для веба принципиально нужен именно SVG (см. `doc/TZ-btw-
landing.md`, формат поставки) — есть два honest-пути, выберите один ДО начала генерации:

1. **Растр → трассировка в вектор постфактум.** Сгенерировать через обычный
   Midjourney/DALL·E/SDXL, затем прогнать через трассировщик (Adobe Illustrator "Image
   Trace", Inkscape "Trace Bitmap", или онлайн-сервис vectorizer.ai). Работает хорошо для
   **плоских иллюстраций с малым числом цветов и чёткими краями** (как раз наш стиль, см.
   ниже) — плохо работает для сложных градиентов/текстур, поэтому промпты ниже намеренно
   просят "flat vector illustration style, solid color fills, no gradients, no texture,
   no noise" — не только эстетика, а технически необходимое ограничение для чистой
   трассировки.
2. **SVG-нативный генератор.** Инструменты вроде Recraft.ai или Kittl AI умеют отдавать
   результат сразу в SVG, без трассировки — если есть доступ, это заметно упрощает
   пайплайн и даёт более чистые контуры сразу.

**Рекомендация:** путь 2 (SVG-нативный генератор), если доступен — иначе путь 1 с
трассировкой, строго придерживаясь ограничений стиля ниже (иначе трассировка даст грязный,
избыточно сложный SVG).

---

## 1. Style Lock — вставлять в КАЖДЫЙ промпт без исключений

Нейросети плохо держат консистентность между отдельными генерациями одного и того же
проекта — единственный надёжный способ получить визуально единый набор (hero + 4 иконки +
приватность + favicon) — **буквально повторять один и тот же блок стиля** в конце каждого
промпта, меняя только описание сцены/объекта. Ниже — этот блок, дословно (можно копировать
как есть, на английском — большинство генераторов дают более предсказуемый результат на
англоязычных промптах):

```
Style: flat vector illustration, minimalist, soft rounded shapes, no gradients, no
texture, no noise, no drop shadows, no realistic rendering, no 3D, no photorealism.
Solid color fills only. Clean geometric shapes with smooth rounded corners (border-radius
style, not sharp angles). Dark background #0F172A (deep navy-black, NOT pure black #000000).
Color palette limited strictly to: #3B82F6 (blue, for user/phone/scanning direction),
#22C55E (green, for detected/matched camera), #EAB308 (amber/yellow, for side or reverse-
view warning), #F8FAFC (off-white, for line work and neutral shapes). No other colors.
No text, no letters, no numbers, no logos, no watermarks anywhere in the image. No human
faces, no realistic human bodies — if a person is implied, show only a simplified hand/arm
silhouette, nothing more. No realistic surveillance camera equipment (no CCTV dome/bullet
camera shapes) — represent cameras as abstract simple circular or teardrop-shaped markers
only. Composition should read clearly at small sizes (icon-scale), avoid fine detail that
disappears when scaled down. Single focal point per image, generous negative space, centred
or rule-of-thirds composition.
```

**Негативный промпт** (если инструмент поддерживает отдельное поле negative prompt —
использовать ВО ВСЕХ генерациях):

```
Negative: photorealistic, realistic camera, CCTV, security camera equipment, human face,
realistic human body, text, letters, numbers, watermark, logo, gradient, noise texture,
drop shadow, 3D render, glossy, metallic, sharp hard shadows, red color, purple color,
pink color, cluttered composition, busy background, multiple focal points, thin hairline
strokes, photographic style, cinematic lighting, lens flare
```

---

## 2. Иллюстрации — по одной, с полным промпт-описанием

### 2.1 Hero-иллюстрация (главная)

**Назначение:** первый экран лендинга, самый важный визуал, должен читаться без подписи за
1–2 секунды.

**Композиция** (описывать в промпте буквально в этом порядке — генераторы лучше следуют
пространственным инструкциям, данным последовательно):
- Нижняя треть кадра, смещена немного влево от центра: упрощённый силуэт руки, держащей
  смартфон вертикально — рука прорисована минимально (обобщённый контур, не анатомически
  детальная), телефон — простой прямоугольник со скруглёнными углами, экран телефона —
  светлый прямоугольник внутри.
- От верхнего края экрана телефона расходится широкий полупрозрачный конус/веер (примерно
  70–90° раствора), направленный вверх и вправо, цвет конуса — #3B82F6 с прозрачностью
  ~25–35% (полупрозрачная заливка, не сплошная).
- Внутри веера, на разной дистанции от телефона — 3 небольших маркера-камеры: простые
  скруглённые капле- или кругообразные значки (не реалистичные камеры, см. Style Lock),
  один #22C55E (ближе к центру веера — "прямое совпадение"), один #EAB308 (ближе к краю
  веера — "боковой ракурс"), третий тоже #22C55E. От каждого маркера — тонкая короткая линия
  #F8FAFC, показывающая его собственный узкий сектор обзора, направленный НАЗАД, в сторону
  телефона (пересекающиеся тонкие треугольники-сектора, не сплошная заливка — только
  контурные линии).
- Фон — сплошной #0F172A, без текстур/паттернов, допустим лишь очень лёгкий радиальный
  градиент яркости в районе телефона (edge case: ЕСЛИ инструмент вообще позволяет
  минимальный градиент яркости фона для акцента — иначе просто плоский однотонный фон).

**Формат:** квадратная (1:1) ИЛИ вертикальная (4:5) версия для мобильного hero, плюс
широкая (16:9 или 21:9) для десктопа — генерировать композицию так, чтобы центральная сцена
(телефон+веер+камеры) укладывалась в центральные 60% кадра, оставляя безопасные поля по
краям для обрезки под разные соотношения без потери сути сцены.

**Полный промпт (собрать так):**
```
A simplified hand holding a smartphone vertically, positioned in the lower third of the
frame, slightly left of center. From the top of the phone screen, a wide translucent cone
of light (about 80 degrees) sweeps upward and to the right, in semi-transparent blue
(#3B82F6, ~30% opacity). Inside the cone, three small rounded marker icons representing
detected cameras — two in green (#22C55E), one in amber (#EAB308) — each with a thin
outline showing a narrow viewing angle pointing back toward the phone. [+ Style Lock block
from section 1]
```

---

### 2.2 Иконки «Как это работает» (4 штуки, единая серия)

**Критично для консистентности:** генерировать все 4 **в одном промпте/одной сессии**, явно
попросив "a set of 4 icons in identical style, same line weight, same color logic, arranged
in a row" — если инструмент это поддерживает (Midjourney с несколькими сценами в сетке,
DALL·E с составным промптом) — это даёт заметно более согласованный результат, чем 4
отдельные независимые генерации. Если инструмент не поддерживает мультисцены — генерировать
по одной, но КАЖДЫЙ РАЗ дополнительно прикладывать первую иконку как референс-изображение
(image prompt/image reference), если функция доступна.

Единая сетка/канвас для всех четырёх: 120×120px, объект занимает центральные ~70×70px,
оставляя равные поля со всех сторон.

**2.2.1 Шаг 1 — «Открой в Telegram»**
Композиция: стилизованный бумажный самолётик (узнаваемый символ Telegram — простой
треугольный силуэт, НЕ логотип Telegram буквально, а обобщённая форма самолётика) слева,
простой контур смартфона справа, между ними — короткая пунктирная дуга-траектория,
показывающая движение самолётика к телефону. Цвет самолётика — #3B82F6, контур телефона —
#F8FAFC.
```
A minimalist paper airplane silhouette on the left, flying toward a simple smartphone
outline on the right, connected by a short dashed arc trajectory. Paper airplane in blue
(#3B82F6), phone outline in off-white (#F8FAFC). [+ Style Lock block]
```

**2.2.2 Шаг 2 — «Наведи телефон»**
Композиция: та же рука+телефон, что в hero, но упрощённая и центрированная (не в углу, а по
центру кадра), вокруг телефона — тонкая дуговая шкала (компас-стрічка), несколько коротких
делений вдоль дуги, одно деление подсвечено #3B82F6 (текущее направление).
```
A simplified hand holding a smartphone, centered in frame. Around the phone, a thin curved
arc (like a compass strip) with short tick marks along it, one tick mark highlighted in
blue (#3B82F6) indicating current direction. [+ Style Lock block]
```

**2.2.3 Шаг 3 — «Камеры подсвечены»**
Композиция: упрощённый экран телефона (просто прямоугольник со скруглением, без руки — уже
крупный план именно экрана), на экране — 2–3 маркера-камеры (тот же стиль, что в hero:
скруглённые капле/круг-значки, #22C55E), с короткими линиями-секторами.
```
A close-up of a phone screen (rounded rectangle), showing 2-3 small rounded marker icons
representing detected cameras in green (#22C55E), each with a short thin line indicating
their viewing direction. [+ Style Lock block]
```

**2.2.4 Шаг 4 — «Боковой/встречный ракурс»**
Та же композиция, что шаг 3, но один из маркеров — #EAB308 вместо #22C55E, с небольшим
восклицательным символом рядом (простая форма — короткая вертикальная полоса + точка, НЕ
буква/типографский знак — см. запрет на текст в Style Lock).
```
A close-up of a phone screen (rounded rectangle) showing one marker icon in amber
(#EAB308) with a small abstract exclamation shape next to it (a short vertical bar plus a
dot — not a typographic character). [+ Style Lock block]
```

---

### 2.3 Иллюстрация приватности

**Композиция:** слева — тот же упрощённый силуэт телефона (без руки в этот раз, чуть
крупнее, отдельно стоящий объект), от него в сторону условного "облака/сервера" справа
тянется пунктирная стрелка, ПЕРЕСЕЧЁННАЯ по центру короткой диагональной чертой (символ
"не передаётся", тот же принцип, что дорожный знак запрета). Облако/сервер — предельно
простая форма (скруглённый прямоугольник или классическая "облачная" геометрическая форма),
контур #F8FAFC, без деталей внутри. Стрелка и перечёркивающая черта — #EAB308 (тот же
акцент "внимание", что уже используется для предупреждений в остальных иллюстрациях —
единообразие смысла цвета).

```
A simple smartphone outline on the left, a minimal cloud/server shape on the right,
connected by a dashed arrow pointing from phone to cloud. The arrow is crossed out by a
short diagonal line through its middle (a "not allowed" symbol, like a road sign),
rendered in amber (#EAB308). Cloud/server shape has a clean outline in off-white
(#F8FAFC), no internal detail. [+ Style Lock block]
```

**Формат:** компактная, широкая (не квадратная) — рассчитана на размещение рядом с текстом
абзаца, не на весь экран.

---

### 2.4 Favicon

**Композиция:** предельное упрощение hero-сцены — только конус сканирования (упрощённый до
простого треугольного/веерного силуэта, без деталей телефона/руки) + ОДНА точка-маркер
внутри него. Должен читаться как узнаваемое пятно даже на 16×16px — при такой генерации
явно указать "must remain recognizable and legible at 16x16 pixels, extremely simplified,
maximum 2 shapes total".

```
An extremely simplified icon: a single triangular/fan-shaped scanning cone in blue
(#3B82F6) with one small round dot marker in green (#22C55E) inside it. Maximum 2 shapes
total. Must remain clearly recognizable when scaled down to 16x16 pixels. [+ Style Lock
block, but background should be transparent, not #0F172A — specify "transparent
background" explicitly since this is used as a favicon over a browser tab, not on a dark
page background]
```

**Формат:** квадрат 512×512 (мастер-файл, дальше ресайзится стандартным favicon-пайплайном
до 16/32/180px), фон — **прозрачный**, не тёмный (единственное исключение из Style Lock по
фону, см. промпт выше).

---

### 2.5 Open Graph изображение

**Композиция:** широкая версия hero-сцены (см. 2.1), скомпонованная так, чтобы центральная
сцена (телефон+веер+камеры) занимала правые ~55% кадра, оставляя левые ~45% пустыми/с
плавным затемнением фона — это место **добавляется НЕ нейросетью, а отдельно, при вёрстке**:
название продукта текстом поверх готового изображения (см. `doc/TZ-btw-landing.md`, раздел
2.4). Сама нейросеть генерирует ТОЛЬКО сцену, без единой буквы (см. запрет на текст в Style
Lock) — текст накладывается программно (CSS/canvas) поверх на этапе сборки страницы, не
частью самого сгенерированного файла.

```
[Same composition as Hero, section 2.1], but composed so the phone-and-scanning-cone scene
occupies the right 55% of the frame, with the left 45% left relatively empty/darker for
text overlay to be added separately. [+ Style Lock block]
```

**Формат:** строго 1200×630px (стандарт Open Graph), фон #0F172A по всему кадру (включая
пустую левую часть — не прозрачный, финальное изображение используется как есть в
`<meta property="og:image">`).

---

## 3. Чек-лист после генерации (перед тем как считать иллюстрацию готовой)

- [ ] Ни одного текстового символа/цифры/буквы нигде на изображении (генераторы часто
      добавляют фантомный "текст"-мусор даже без запроса — проверять внимательно).
- [ ] Использованы только 4 цвета из палитры Style Lock — ничего постороннего (частая
      проблема генераторов — "утечка" случайного цвета в тень/градиент).
- [ ] Нет реалистичных камер видеонаблюдения (генераторы по умолчанию тяготеют к
      реалистичным CCTV-формам, даже при явном запрете — перегенерировать, если проскочило).
- [ ] Нет человеческих лиц/реалистичных тел.
- [ ] Иконки шага 2.2 визуально СОГласованы между собой (одна толщина линий, один масштаб
      объектов внутри кадра) — если явно разъезжаются по стилю, перегенерировать всю серию
      заново одним промптом, а не точечно один элемент.
- [ ] При уменьшении до реального размера использования (иконка ~48–96px, favicon 16px)
      композиция остаётся читаемой, детали не превращаются в кашу.
