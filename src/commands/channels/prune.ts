import { google } from 'googleapis';
import { getAuthorizedClient } from '../../auth/googleAuth';
import { listChannels, removeChannel } from '../../storage/channelStore';

type PruneOptions = {
  dryRun?: boolean;
};

const isExpired = (expiration?: number): boolean => {
  if (!expiration) {
    return false;
  }
  return Date.now() >= expiration;
};

export const pruneChannelsCommand = async (options: PruneOptions): Promise<void> => {
  const channels = listChannels();
  const expired = channels.filter((channel) => isExpired(channel.expiration));

  if (expired.length === 0) {
    console.log('No expired channels to prune.');
    return;
  }

  console.log(`Found ${expired.length} expired channel(s).`);
  expired.forEach((channel) => {
    const expiration = channel.expiration ? new Date(channel.expiration).toISOString() : 'unknown';
    console.log(`- ${channel.channelId} (expired at ${expiration})`);
  });

  if (options.dryRun) {
    console.log('Dry run enabled; no API calls were made.');
    return;
  }

  const authClient = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth: authClient });

  for (const channel of expired) {
    try {
      await calendar.channels.stop({
        requestBody: {
          id: channel.channelId,
          resourceId: channel.resourceId,
        },
      });
      removeChannel(channel.channelId);
      console.log(`Stopped and removed channel ${channel.channelId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to stop channel ${channel.channelId}: ${message}`);
    }
  }
};
