import { Injectable, Logger } from '@nestjs/common';

// Object storage для фото квитанций — Vercel Blob (публичный доступ по прямой ссылке).
// "Публичный" здесь означает "доступен без авторизации по прямой ссылке", а не
// "проиндексирован/показан где-то в списке": путь содержит случайный суффикс
// (`addRandomSuffix: true`), сама ссылка нигде не публикуется, кроме ответов
// AdminGuard-эндпоинтов (см. HomeVerificationController) — но всё равно НЕ считать это тем же
// уровнем защиты, что и подписанная/временная ссылка приватного бакета. Если понадобится более
// строгая защита (квитанции — потенциально чувствительные документы с ФИО/адресом), следующий
// шаг — приватный бакет + временные подписанные URL вместо публичного Blob.
@Injectable()
export class ReceiptStorageService {
  private readonly logger = new Logger(ReceiptStorageService.name);

  isConfigured(): boolean {
    return !!process.env.BLOB_READ_WRITE_TOKEN;
  }

  // Возвращает URL, по которому фото доступно (Vercel Blob) — либо, если объектное хранилище
  // не настроено, data:-URL с тем же содержимым как раньше (известное упрощение для локальной
  // разработки/окружений без привязки к Vercel Blob — см. .env.example). Вызывающий код
  // (HomeVerificationService) работает одинаково в обоих случаях: получает строку-URI.
  async store(buffer: Buffer, mimeType: string, telegramId: string): Promise<string> {
    if (!this.isConfigured()) {
      this.logger.warn(
        'BLOB_READ_WRITE_TOKEN не задан — фото квитанции сохраняется как data:-URL в БД вместо object storage.',
      );
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    try {
      const { put } = await import('@vercel/blob');
      const extension = mimeType.split('/')[1] ?? 'jpg';
      // telegramId в пути — только для удобства навигации по бакету вручную, не для контроля
      // доступа (доступ регулируется тем, что ссылка не публикуется, а не путём).
      const pathname = `home-verification-receipts/${telegramId}/${Date.now()}.${extension}`;

      const blob = await put(pathname, buffer, {
        access: 'public',
        contentType: mimeType,
        addRandomSuffix: true,
      });

      return blob.url;
    } catch (err) {
      // Object storage сломался (сеть/квота/неверный токен) — не должно ронять всю заявку на
      // верификацию. Откатываемся на data:-URL, как и при отсутствии конфигурации, с явным
      // логом, чтобы это не осталось незамеченным.
      this.logger.warn(`Vercel Blob upload failed, falling back to data:-URL: ${(err as Error).message}`);
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
  }
}
