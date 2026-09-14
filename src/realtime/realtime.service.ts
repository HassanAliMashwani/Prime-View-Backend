import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private supabase: SupabaseClient | null = null;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://nnuyccntmxhrkbbsnmwn.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        });
        this.logger.log(`Initialized Supabase Realtime client for ${supabaseUrl}`);
      } catch (err) {
        this.logger.warn(`Failed to initialize Supabase client: ${err.message}`);
      }
    } else {
      this.logger.warn(
        'Supabase URL or Key not set. Realtime events will be logged and dispatched in-memory.',
      );
    }
  }

  async broadcast(channelName: string, event: string, payload: any): Promise<void> {
    this.logger.log(`[REALTIME BROADCAST] Channel: ${channelName}, Event: ${event}, Payload: ${JSON.stringify(payload)}`);

    if (this.supabase) {
      try {
        const channel = this.supabase.channel(channelName);
        await channel.send({
          type: 'broadcast',
          event,
          payload,
        });
      } catch (err) {
        this.logger.error(`Error sending Supabase Realtime broadcast on ${channelName}: ${err.message}`);
      }
    }
  }
}
