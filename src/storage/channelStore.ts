import { paths, readJsonFile, writeJsonAtomically } from '../config';

export type ResourceType = 'events' | 'acl' | 'calendarList' | 'settings';

export type StoredChannel = {
  channelId: string;
  resourceId: string;
  resourceUri: string;
  resourceType: ResourceType;
  calendarId: string;
  address: string;
  token?: string;
  expiration?: number;
  createdAt: number;
};

const readChannels = (): StoredChannel[] => readJsonFile<StoredChannel[]>(paths.channelsFile, []);

const writeChannels = (channels: StoredChannel[]): void => {
  writeJsonAtomically(paths.channelsFile, channels);
};

export const listChannels = (): StoredChannel[] => readChannels();

export const upsertChannel = (channel: StoredChannel): void => {
  const channels = readChannels().filter((existing) => existing.channelId !== channel.channelId);
  channels.push(channel);
  writeChannels(channels);
};

export const removeChannel = (channelId: string): void => {
  const channels = readChannels().filter((channel) => channel.channelId !== channelId);
  writeChannels(channels);
};

export const getChannel = (channelId: string): StoredChannel | undefined => {
  return readChannels().find((channel) => channel.channelId === channelId);
};
