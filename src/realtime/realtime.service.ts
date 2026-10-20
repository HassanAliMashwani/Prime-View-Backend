import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);
  private supabase: SupabaseClient | null = null;
  private readonly channels = new Map<string, RealtimeChannel>();
  private readonly channelStatus = new Map<string, string>();

  private readonly blockChannels = [
    'block:abbott',
    'block:commercial',
    'block:elite',
    'block:npf-phase-1',
    'block:overseas',
    'block:royal',
  ];

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://nnuyccntmxhrkbbsnmwn.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false },
        });
        this.logger.log(`Initialized Supabase Realtime client for ${supabaseUrl}`);
      } catch (err: any) {
        this.logger.warn(`Failed to initialize Supabase client: ${err.message}`);
      }
    } else {
      this.logger.warn(
        'Supabase URL or Key not set. Realtime events will be logged and dispatched in-memory.',
      );
    }
  }

  async onModuleInit() {
    if (!this.supabase) return;

    // On startup, subscribe to these channels and mark each one ready only when its status is SUBSCRIBED
    for (const b of this.blockChannels) {
      this.subscribeChannel(b);
    }
    this.subscribeChannel('plots');
  }

  private subscribeChannel(channelName: string): RealtimeChannel | null {
    if (!this.supabase) return null;

    if (this.channels.has(channelName)) {
      const oldChannel = this.channels.get(channelName);
      if (oldChannel) {
        try {
          this.supabase.removeChannel(oldChannel);
        } catch {}
      }
      this.channels.delete(channelName);
    }

    this.channelStatus.set(channelName, 'CONNECTING');

    try {
      const channel = this.supabase.channel(channelName);
      this.channels.set(channelName, channel);

      channel.subscribe((status: string) => {
        this.logger.log(`Supabase channel ${channelName} status: ${status}`);
        this.channelStatus.set(channelName, status);

        if (status === 'SUBSCRIBED') {
          this.logger.log(`Supabase channel ready: ${channelName}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
          this.logger.warn(
            `Supabase channel ${channelName} not ready (${status}). Scheduling re-subscription...`,
          );
          // On CHANNEL_ERROR, CLOSED, or TIMED_OUT, mark that channel not ready and subscribe again
          this.channelStatus.set(channelName, status);
          setTimeout(() => {
            const current = this.channelStatus.get(channelName);
            if (current !== 'SUBSCRIBED') {
              this.subscribeChannel(channelName);
            }
          }, 1000);
        }
      });

      return channel;
    } catch (err: any) {
      this.logger.error(`Failed to subscribe channel ${channelName}: ${err.message}`);
      this.channelStatus.set(channelName, 'CHANNEL_ERROR');
      return null;
    }
  }

  private async waitForSubscribed(channelName: string, maxWaitMs = 2000): Promise<boolean> {
    if (this.channelStatus.get(channelName) === 'SUBSCRIBED') {
      return true;
    }

    if (!this.channels.has(channelName) || this.channelStatus.get(channelName) !== 'CONNECTING') {
      this.subscribeChannel(channelName);
    }

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (this.channelStatus.get(channelName) === 'SUBSCRIBED') {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return this.channelStatus.get(channelName) === 'SUBSCRIBED';
  }

  async broadcast(channelName: string, event: string, payload: any): Promise<void> {
    this.logger.log(
      `[REALTIME BROADCAST] Channel: ${channelName}, Event: ${event}, Payload: ${JSON.stringify(payload)}`,
    );

    if (!this.supabase) {
      return;
    }

    try {
      // For a block channel that is not SUBSCRIBED, subscribe and wait up to 2 seconds for SUBSCRIBED, then send.
      const isReady = await this.waitForSubscribed(channelName, 2000);

      // Send only after that status is SUBSCRIBED.
      if (!isReady) {
        this.logger.warn(
          `Broadcast on ${channelName} failed: channel is not SUBSCRIBED (status: ${this.channelStatus.get(channelName)}). The lock row is already saved.`,
        );
        return;
      }

      const channel = this.channels.get(channelName);
      if (channel) {
        await channel.send({
          type: 'broadcast',
          event,
          payload,
        });
      }
    } catch (err: any) {
      this.logger.error(`Error sending Supabase Realtime broadcast on ${channelName}: ${err.message}`);
    }
  }
}
