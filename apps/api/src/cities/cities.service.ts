import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Поддержка всех городов Украины (см. doc/README.md) — справочник City используется и для
// выпадающего списка на публичном поиске, и как cityHint для GeocodingService/фильтр камер.
@Injectable()
export class CitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.city.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, lat: true, lng: true, region: true, countryCode: true, countryName: true },
    });
  }

  async findById(id: string) {
    return this.prisma.city.findUnique({ where: { id } });
  }
}
