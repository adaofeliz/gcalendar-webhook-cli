import { google } from 'googleapis';
import { getAuthorizedClient } from '../../auth/googleAuth';
import { getChannel, removeChannel } from '../../storage/channelStore';

export const stopChannelCommand = async (channelId: string): Promise<void> => {
  const channel = getChannel(channelId);
  if (!channel) {
    console.error(`Channel '${channelId}' not found in local store.`);
    process.exitCode = 1;
    return;
  }

  const authClient = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth: authClient });

  await calendar.channels.stop({
    requestBody: {
      id: channel.channelId,
      resourceId: channel.resourceId,
    },
  });

  removeChannel(channel.channelId);
  console.log(`Channel '${channel.channelId}' stopped and removed from store.`);
};
