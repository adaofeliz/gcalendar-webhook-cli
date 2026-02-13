import { listChannels as loadChannels } from '../../storage/channelStore';

const formatExpiration = (timestamp?: number): string => {
  if (!timestamp) {
    return 'unknown';
  }

  const date = new Date(Number(timestamp));
  const diffMs = timestamp - Date.now();
  const diffHours = diffMs / (1000 * 60 * 60);
  const status = diffMs <= 0 ? 'expired' : diffHours < 24 ? 'expiring' : 'active';
  return `${date.toISOString()} (${status}, ${diffHours.toFixed(1)}h)`;
};

export const listChannelsCommand = async (): Promise<void> => {
  const channels = loadChannels();

  if (channels.length === 0) {
    console.log('No stored channels.');
    return;
  }

  const rows = channels
    .sort((a, b) => (a.expiration ?? Infinity) - (b.expiration ?? Infinity))
    .map((channel) => ({
      channelId: channel.channelId,
      calendarId: channel.calendarId,
      resourceType: channel.resourceType,
      expiration: formatExpiration(channel.expiration),
      address: channel.address,
    }));

  console.table(rows);
};
