import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { handleBotEvent, type BotEvent } from './bot';
import { sendTelegram } from './notifications';

interface Queued { event: BotEvent; tries: number }

// One durable inbox per chat: accept webhooks quickly; serialize AI/review turns
// through alarms, survive restarts, and deduplicate Telegram retries.
export class TelegramAgent extends DurableObject<Env> {
  async fetch(request: Request) {
    const event = await request.json() as BotEvent;
    await this.ctx.storage.transaction(async storage => {
      if (await storage.get(`seen:${event.id}`)) return;
      const sequence = (await storage.get<number>('sequence') ?? 0) + 1;
      await storage.put('sequence', sequence);
      await storage.put(`queue:${String(sequence).padStart(12, '0')}`, { event, tries: 0 } satisfies Queued);
      await storage.put(`seen:${event.id}`, sequence);
      const previous = await storage.get<string[]>('recent') ?? [];
      previous.push(event.id);
      if (previous.length > 200) await storage.delete(`seen:${previous.shift()}`);
      await storage.put('recent', previous);
    });
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now());
    return new Response('OK');
  }

  async alarm() {
    const queue = await this.ctx.storage.list<Queued>({ prefix: 'queue:', limit: 1 });
    const item = queue.entries().next().value as [string, Queued] | undefined;
    if (!item) return;
    const [key, job] = item;
    try {
      let reply = await this.ctx.storage.get<string>(`outbox:${key}`);
      if (reply === undefined) {
        reply = await handleBotEvent(this.env, job.event);
        await this.ctx.storage.put(`outbox:${key}`, reply);
      }
      if (reply) await sendTelegram(this.env, job.event.chatId, reply);
      await this.ctx.storage.delete([key, `outbox:${key}`]);
    } catch {
      job.tries++;
      if (job.tries < 4) {
        await this.ctx.storage.put(key, job);
        await this.ctx.storage.setAlarm(Date.now() + 5000 * 2 ** job.tries);
        return;
      }
      await this.ctx.storage.delete([key, `outbox:${key}`]);
      if (job.event.kind === 'scheduled' && job.event.workspaceId) await this.env.DB.prepare('UPDATE workspaces SET last_sent_at=0 WHERE id=?').bind(job.event.workspaceId).run();
      try { await sendTelegram(this.env, job.event.chatId, 'Stick is temporarily unavailable. Please try your message again shortly. Your saved insights have not been deleted.'); } catch { /* Safe error message delivery is best-effort. */ }
      console.error('Stick Telegram delivery/AI turn failed after retries.');
    }
    if ((await this.ctx.storage.list({ prefix: 'queue:', limit: 1 })).size) await this.ctx.storage.setAlarm(Date.now());
  }
}
