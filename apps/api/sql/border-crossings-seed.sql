-- Прикордонні переходи для "час очікування на кордоні" (краудсорс, див.
-- src/border-crossings). Координати приблизні (центр переходу) — досить для маркера на карті,
-- не для навігації в реальному часі. Ідемпотентно (ON CONFLICT DO NOTHING).
-- Прогнати: docker compose exec api npx prisma db execute --file sql/border-crossings-seed.sql --schema prisma/schema.prisma
INSERT INTO "BorderCrossing" (id, name, slug, lat, lng, "countryFrom", "countryTo", "createdAt") VALUES
  ('bc_krakovets_korczowa', 'Краковець — Корчова', 'krakovets-korczowa', 50.1063, 23.1892, 'UA', 'PL', now()),
  ('bc_shehyni_medyka',     'Шегині — Медика',     'shehyni-medyka',     49.8064, 22.7717, 'UA', 'PL', now()),
  ('bc_yahodyn_dorohusk',   'Ягодин — Дорогуськ',  'yahodyn-dorohusk',   51.1719, 23.8494, 'UA', 'PL', now()),
  ('bc_uzhhorod_vysne',     'Ужгород — Вишнє Нємецьке', 'uzhhorod-vysne-nemecke', 48.6208, 22.2967, 'UA', 'SK', now()),
  ('bc_chop_zahony',        'Чоп — Захонь',        'chop-zahony',        48.4159, 22.1994, 'UA', 'HU', now()),
  ('bc_porubne_siret',      'Порубне — Сірет',     'porubne-siret',      48.0086, 25.9014, 'UA', 'RO', now()),
  ('bc_mohyliv_otaci',      'Могилів-Подільський — Отачі', 'mohyliv-otaci', 48.4442, 27.7981, 'UA', 'MD', now())
ON CONFLICT (slug) DO NOTHING;
