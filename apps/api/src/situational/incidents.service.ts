import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';

// Инциденты старше этого без ручного резолва больше не считаются "активными" на карте, даже
// если админ забыл их закрыть — иначе устаревшее ДТП годовой давности продолжало бы висеть на
// карте вечно. Не удаляет запись, только исключает из listActive().
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 часа

@Injectable()
export class RoadIncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateIncidentDto, reportedByTelegramId?: string) {
    return this.prisma.roadIncident.create({
      data: {
        type: dto.type,
        severity: dto.severity ?? 'MEDIUM',
        lat: dto.lat,
        lng: dto.lng,
        title: dto.title,
        description: dto.description,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        reportedByTelegramId,
      },
    });
  }

  async update(id: string, dto: UpdateIncidentDto) {
    const existing = await this.prisma.roadIncident.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Incident ${id} not found`);

    const becomingResolved = dto.status === 'RESOLVED' && existing.status !== 'RESOLVED';
    const becomingActive = dto.status === 'ACTIVE' && existing.status === 'RESOLVED';

    return this.prisma.roadIncident.update({
      where: { id },
      data: {
        type: dto.type,
        severity: dto.severity,
        lat: dto.lat,
        lng: dto.lng,
        title: dto.title,
        description: dto.description,
        expiresAt: dto.expiresAt !== undefined ? (dto.expiresAt ? new Date(dto.expiresAt) : null) : undefined,
        status: dto.status,
        resolvedAt: becomingResolved ? new Date() : becomingActive ? null : undefined,
      },
    });
  }

  async resolve(id: string) {
    return this.update(id, { status: 'RESOLVED' });
  }

  async remove(id: string) {
    await this.prisma.roadIncident.delete({ where: { id } });
    return { id, deleted: true };
  }

  // Для карты: активные и не "протухшие" по expiresAt/24ч-давности. Считается на лету
  // (не отдельным cron'ом) — простая фильтрация в SQL достаточно дешева при ожидаемых объёмах.
  async listActive() {
    const staleThreshold = new Date(Date.now() - STALE_AFTER_MS);

    return this.prisma.roadIncident.findMany({
      where: {
        status: 'ACTIVE',
        reportedAt: { gt: staleThreshold },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { reportedAt: 'desc' },
    });
  }

  async listAll(take = 100) {
    return this.prisma.roadIncident.findMany({
      orderBy: { reportedAt: 'desc' },
      take,
    });
  }
}
