import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

// Портировано по аналогии с грок-интеграцией из cargo-tracker (config.ts: grokApiKey/
// grokBaseUrl/grokModel) — тот же провайдер (xAI), тот же принцип "нет ключа -> прозрачный
// фоллбэк", только здесь фоллбэк это не детерминированный парсинг, а "отправить на ручное
// ревью" (см. ниже — единственный безопасный дефолт для верификации доступа).
function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

// Читаются заново при каждом вызове (не кэшируются в module-level const) — так же, как и
// остальные env-геттеры в проекте (см. dev-accounts.util.ts::isDevAutoLoginEnabled()). Помимо
// соответствия конвенции, это принципиально: в serverless-среде/тестах важно не примораживать
// значение к моменту первого импорта модуля.
function getApiKey(): string | null {
  return process.env.XAI_API_KEY || process.env.GROK_API_KEY || null;
}
function getBaseUrl(): string {
  return process.env.XAI_BASE_URL || 'https://api.x.ai/v1';
}
// NOTE: сверить актуальное имя vision-модели в документации xAI перед продакшеном — это
// значение может устареть.
function getVisionModel(): string {
  return process.env.GROK_VISION_MODEL || 'grok-4';
}
// Известное упрощение: считаем рукописную дату "свежей", если она датирована не раньше, чем
// это число дней назад — сама проверка "рукописная/не рукописная" и разбор даты полностью
// доверены модели (см. промпт ниже), сервер лишь передаёт порог в промпт и доверяет булеву
// результату handwrittenDateIsRecent, а не парсит дату повторно сам.
export function getMaxReceiptAgeDays(): number {
  return bool('HOME_VERIFICATION_STRICT_DATE', true) ? 3 : 14;
}
// Калибровка: минимальная уверенность совпадения адреса для авто-одобрения. Начали с 0.7,
// вынесено в env специально чтобы подстраивать по факту первых реальных заявок (см.
// GET /admin/home-verifications/stats — помогает подобрать значение по распределению
// confidence среди уже вручную одобренных/отклонённых заявок), без правки кода/редеплоя.
export function getMinConfidence(): number {
  const v = parseFloat(process.env.HOME_VERIFICATION_MIN_CONFIDENCE ?? '');
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
}

const REQUEST_TIMEOUT_MS = 30000;

export interface ReceiptVerificationResult {
  configured: boolean; // AI-провайдер вообще настроен (есть ключ)?
  extractedAddress: string | null;
  addressMatchConfidence: number | null;
  handwrittenDateText: string | null;
  handwrittenDateIsRecent: boolean | null;
  looksGenuine: boolean | null;
  notes: string;
  rawResponse: unknown;
  // Итоговое решение — единственное поле, которое дальше использует HomeVerificationService.
  autoApprove: boolean;
}

interface ParsedAiResponse {
  printedAddress: string | null;
  addressMatchesClaim: boolean;
  addressMatchConfidence: number;
  handwrittenDateText: string | null;
  handwrittenDateIsRecent: boolean;
  looksLikeGenuineReceipt: boolean;
  notes: string;
}

function buildPrompt(claimedAddress: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Ты проверяешь квитанцию об оплате жилья (коммунальные услуги/аренда) для верификации адреса проживания пользователя веб-сервиса поиска камер видеонаблюдения в Украине. Пользователь утверждает, что проживает по адресу ниже, и должен от руки написать сегодняшнюю дату прямо на квитанции (или на листе рядом с ней в кадре) — это защита от повторного использования старого скриншота/фото.

Проанализируй приложенное изображение и ответь СТРОГО в формате JSON, без markdown-разметки, без пояснений вне JSON, точно по такой схеме:
{
  "printedAddress": string | null,        // адрес, напечатанный/типографски указанный на квитанции, как есть
  "addressMatchesClaim": boolean,          // относится ли напечатанный адрес к тому же реальному адресу, что указан пользователем (допускаются различия в формате/порядке слов/сокращениях/транслитерации)
  "addressMatchConfidence": number,        // 0.0-1.0
  "handwrittenDateText": string | null,    // рукописная (НЕ напечатанная/не типографская) дата на изображении, дословно, если есть
  "handwrittenDateIsRecent": boolean,      // true, только если handwrittenDateText - это ЯВНО РУКОПИСНАЯ (не напечатанная) дата, и она датирована не раньше чем ${getMaxReceiptAgeDays()} дней до сегодня (сегодня: ${today})
  "looksLikeGenuineReceipt": boolean,      // false, если изображение не похоже на настоящую квитанцию об оплате жилья, похоже на скриншот скриншота, на AI-сгенерированное изображение, или есть явные признаки подделки/редактирования
  "notes": string                          // короткое пояснение решения, на русском
}

Адрес, заявленный пользователем: ${claimedAddress}
Сегодняшняя дата: ${today}`;
}

@Injectable()
export class ReceiptVerificationService {
  private readonly logger = new Logger(ReceiptVerificationService.name);

  isConfigured(): boolean {
    return !!getApiKey();
  }

  // Единственная безопасная точка отказа: если AI-провайдер не настроен, или запрос упал, или
  // ответ не удалось распарсить — НИКОГДА не возвращаем autoApprove:true. В худшем случае
  // заявка просто уходит на ручное ревью админом, а не одобряется/отклоняется вслепую.
  async verify(claimedAddress: string, imageDataUrl: string): Promise<ReceiptVerificationResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return this.needsReview('AI-провайдер не настроен (нет XAI_API_KEY/GROK_API_KEY) — требуется ручная проверка администратором.');
    }

    let parsed: ParsedAiResponse;
    let rawResponse: unknown;
    try {
      const res = await axios.post(
        `${getBaseUrl()}/chat/completions`,
        {
          model: getVisionModel(),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: buildPrompt(claimedAddress) },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
          temperature: 0,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        },
      );

      rawResponse = res.data;
      const text: string = res.data?.choices?.[0]?.message?.content ?? '';
      parsed = this.parseAiJson(text);
    } catch (err) {
      this.logger.warn(`Receipt verification AI call failed: ${(err as Error).message}`);
      return this.needsReview(`Ошибка обращения к AI (${(err as Error).message}) — требуется ручная проверка.`);
    }

    const autoApprove =
      parsed.addressMatchesClaim &&
      parsed.addressMatchConfidence >= getMinConfidence() &&
      !!parsed.handwrittenDateText &&
      parsed.handwrittenDateIsRecent &&
      parsed.looksLikeGenuineReceipt;

    return {
      configured: true,
      extractedAddress: parsed.printedAddress,
      addressMatchConfidence: parsed.addressMatchConfidence,
      handwrittenDateText: parsed.handwrittenDateText,
      handwrittenDateIsRecent: parsed.handwrittenDateIsRecent,
      looksGenuine: parsed.looksLikeGenuineReceipt,
      notes: parsed.notes,
      rawResponse,
      autoApprove,
    };
  }

  private needsReview(notes: string): ReceiptVerificationResult {
    return {
      configured: this.isConfigured(),
      extractedAddress: null,
      addressMatchConfidence: null,
      handwrittenDateText: null,
      handwrittenDateIsRecent: null,
      looksGenuine: null,
      notes,
      rawResponse: null,
      autoApprove: false,
    };
  }

  // Модель иногда оборачивает JSON в ```json ... ``` несмотря на просьбу не делать этого —
  // защитно снимаем код-блок перед парсингом. Любая невалидность формы -> считаем как "не
  // прошло" (autoApprove останется false выше — здесь просто заполняем безопасные дефолты).
  private parseAiJson(text: string): ParsedAiResponse {
    const cleaned = text.replace(/```json|```/g, '').trim();
    let obj: any;
    try {
      obj = JSON.parse(cleaned);
    } catch {
      obj = {};
    }

    return {
      printedAddress: typeof obj.printedAddress === 'string' ? obj.printedAddress : null,
      addressMatchesClaim: obj.addressMatchesClaim === true,
      addressMatchConfidence: typeof obj.addressMatchConfidence === 'number' ? obj.addressMatchConfidence : 0,
      handwrittenDateText: typeof obj.handwrittenDateText === 'string' ? obj.handwrittenDateText : null,
      handwrittenDateIsRecent: obj.handwrittenDateIsRecent === true,
      looksLikeGenuineReceipt: obj.looksLikeGenuineReceipt === true,
      notes: typeof obj.notes === 'string' ? obj.notes : 'Модель не вернула пояснение.',
    };
  }
}
