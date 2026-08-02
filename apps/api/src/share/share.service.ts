import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';

const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // без 0/O/1/I/l — легче диктовать/читать вслух
const SLUG_LENGTH = 8;
const MAX_SLUG_COLLISION_RETRIES = 5;

function generateSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return slug;
}

// "Поделиться локацией" — короткая ссылка на точку (координаты + опционально адрес/город),
// которую пользователь уже нашёл через обычный поиск. Публичная (без AuthGate) на уровне API —
// сама точка не более чувствительна, чем то, что человек и так ищет вручную; получатель всё
// равно упрётся в обычный AuthGate на самой странице поиска после редиректа.
@Injectable()
export class ShareService {
  constructor(private readonly prisma: PrismaService) {}

  async create(telegramId: string, dto: CreateShareLinkDto) {
    let slug = generateSlug();
    for (let attempt = 0; attempt < MAX_SLUG_COLLISION_RETRIES; attempt++) {
      const existing = await this.prisma.shareLink.findUnique({ where: { slug } });
      if (!existing) break;
      slug = generateSlug();
    }

    return this.prisma.shareLink.create({
      data: {
        slug,
        lat: dto.lat,
        lng: dto.lng,
        address: dto.address,
        cityId: dto.cityId,
        createdByTelegramId: telegramId,
      },
    });
  }

  async resolve(slug: string) {
    const link = await this.prisma.shareLink.findUnique({ where: { slug } });
    if (!link) throw new NotFoundException(`Share link "${slug}" not found`);

    // +1 к просмотрам — метрика "сколько раз открыли", не проверка доступа (ссылка не
    // одноразовая и не имеет TTL в этой версии — см. doc/README.md).
    await this.prisma.shareLink.update({ where: { slug }, data: { viewCount: { increment: 1 } } });

    return { lat: link.lat, lng: link.lng, address: link.address, cityId: link.cityId };
  }
}
