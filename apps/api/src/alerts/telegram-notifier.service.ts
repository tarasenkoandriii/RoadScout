import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

// Доставка алертів — через Telegram Bot API sendMessage напряму (не через Login Widget,
// той для аутентифікації, а не проактивних повідомлень). Той самий TELEGRAM_BOT_TOKEN, що вже
// налаштований для входу — окремого токена не потрібно, у бота вже є право писати
// користувачу, ЯКЩО він хоч раз тицьнув /start цьому боту (обмеження самого Telegram API,
// а не цього коду — sendMessage поверне 403, якщо користувач з ботом жодного разу не
// взаємодіяв).
@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  isConfigured(): boolean {
    return !!process.env.TELEGRAM_BOT_TOKEN;
  }

  // Не кидає виключення при невдачі (403 — юзер не писав боту, мережева помилка тощо) — це
  // фонова розсилка алертів, одне не доставлене повідомлення не повинно ронити весь тік крону
  // для решти підписок. Повертає true/false, щоб виклик міг залогувати підсумок.
  async send(telegramId: string, text: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set — cannot send alert notifications.');
      return false;
    }

    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: telegramId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      return true;
    } catch (err) {
      this.logger.warn(`Failed to send Telegram alert to ${telegramId}: ${(err as Error).message}`);
      return false;
    }
  }
}
