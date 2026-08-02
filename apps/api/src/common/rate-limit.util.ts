import { HttpException, HttpStatus } from '@nestjs/common';

// Обобщённый вариант rate-limit-проверки из HomeVerificationService.submit() — берёт готовую
// функцию подсчёта (т.к. у каждой модели свой Prisma.count() с разными полями), а не завязан
// на конкретную таблицу. ipAddress === null (нет прокси-инфы, локальная разработка) — не
// лимитируется вовсе, тот же принцип, что и в остальном проекте.
export async function assertIpRateLimit(
  countRecentByIp: () => Promise<number>,
  ipAddress: string | null,
  max: number,
  windowHours: number,
  message?: string,
): Promise<void> {
  if (!ipAddress) return;

  const count = await countRecentByIp();
  if (count >= max) {
    throw new HttpException(
      message ?? `Слишком много запросов с вашего IP (лимит: ${max} за ${windowHours} ч). Попробуйте позже.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function windowStartDate(hoursAgo: number): Date {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
}
