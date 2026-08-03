# Beyond the Wall --- SVG Engineering Specification v4.0

> **Примечание:** альтернативный, полностью детерминированный подход к тем же
> иллюстрациям, что описаны в `doc/TZ-btw-landing-illustrations.md` (там —
> AI-промпт-ориентированный бриф для нейросети). Здесь — точная координатная
> спецификация для программной/ручной генерации SVG без AI, с design tokens,
> React/Figma-маппингом и автоматической проверкой соответствия.

> Цель: полностью детерминированная спецификация, по которой любой
> разработчик или генератор может создать идентичный набор SVG без
> использования AI-промптов.

# 1. Архитектура

    design-tokens.json
    components/
      Phone.svg
      Hand.svg
      ScanCone.svg
      CameraMarker.svg
      CameraFOV.svg
      Cloud.svg
      Arrow.svg
    illustrations/
      hero.svg
      privacy.svg
      og-image.svg
    icons/
      open.svg
      point.svg
      detect.svg
      warning.svg

# 2. Design Tokens (JSON)

``` json
{
  "grid":8,
  "stroke":4,
  "radius":{"sm":8,"md":16,"lg":24},
  "colors":{
    "bg":"#0F172A",
    "primary":"#3B82F6",
    "success":"#22C55E",
    "warning":"#EAB308",
    "neutral":"#F8FAFC"
  }
}
```

# 3. Координатная система Hero

ViewBox: 0 0 1200 900

Телефон: - x=280 - y=420 - width=160 - height=320 - rx=24

Экран: - отступ 12 px

Точка начала сканирования: - (360,420)

ScanCone: - угол = 80° - радиус = 520 - начало = -40° - конец = +40° -
fill-opacity = 0.30

# 4. Камеры

Размер маркера = 28×28.

Координаты: - camera-1 (610,280) - camera-2 (760,360) - camera-3
(540,170)

Минимальное расстояние между центрами: 96 px.

FOV каждой камеры: - угол 24° - длина 110 px - stroke-width 2

# 5. Компоненты

## Phone

Параметры: width,height,radius,screenPadding.

## ScanCone

Параметры: originX,originY,radius,startAngle,endAngle,color,opacity.

## CameraMarker

Параметры: x,y,color,type(circle\|drop).

## CameraFOV

Параметры: origin,angle,length.

Все компоненты независимы и переиспользуются.

# 6. Правила построения

Все координаты кратны 8 px.

Все линии имеют: - linecap=round - linejoin=round

Максимальная вложенность групп: 2.

# 7. SVG API

Каждый SVG обязан иметь:

-   viewBox
-   width
-   height
-   role="img"
-   aria-hidden="true"

ID элементов стабильны: background phone screen scan-cone camera-1
camera-2 camera-3 camera-fov-1 camera-fov-2 camera-fov-3

# 8. React Mapping

Компоненты должны импортироваться без модификации:

    <HeroIllustration />
    <PrivacyIllustration />
    <CameraMarker />
    <ScanCone />

# 9. Figma Mapping

Каждая группа SVG соответствует Frame Figma.

Названия совпадают с id SVG.

# 10. Формулы

ScanCone:

start = centerAngle - angle/2

end = centerAngle + angle/2

FOV строится аналогично.

# 11. Автоматическая проверка

Проверяются:

-   только разрешённые цвета;
-   отсутствие filter;
-   отсутствие image;
-   отсутствие script;
-   координаты кратны 8;
-   размер файла;
-   уникальность id.

# 12. Производительность

Hero ≤20 KB

Privacy ≤8 KB

Icons ≤2 KB

Favicon ≤1 KB

# 13. Совместимость

SVG должны открываться без изменений в: - Chrome - Firefox - Safari -
Edge - Figma - Illustrator - Inkscape

# 14. Генерация

На основе настоящей спецификации возможно автоматически генерировать SVG
из JSON-манифеста без ручного редактирования.

Формат предназначен как для дизайнеров, так и для программной генерации
(React, SVG, Canvas, Figma Plugin, CLI).
