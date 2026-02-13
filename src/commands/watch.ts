import { calendar_v3, google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { getAuthorizedClient } from '../auth/googleAuth';
import { ResourceType, upsertChannel } from '../storage/channelStore';

type WatchOptions = {
  calendarId?: string;
  address: string;
  token?: string;
  ttlHours?: number;
  resource?: string;
};

const SUPPORTED_RESOURCES: ResourceType[] = ['events', 'acl', 'calendarList', 'settings'];

const assertHttpsAddress = (address: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch (error) {
    throw new Error(`Invalid webhook address: ${(error as Error).message}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook address must use HTTPS.');
  }
};

const coerceResourceType = (resource?: string): ResourceType => {
  const value = resource?.toLowerCase() ?? 'events';
  if (SUPPORTED_RESOURCES.includes(value as ResourceType)) {
    return value as ResourceType;
  }
  throw new Error(`Unsupported resource type '${resource}'. Supported types: ${SUPPORTED_RESOURCES.join(', ')}`);
};

const parseExpiration = (value?: string | number | null): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric;
};

const buildWatchRequest = (
  resource: ResourceType,
  calendarId: string | undefined,
  address: string,
  token: string | undefined,
  ttlHours: number | undefined,
): calendar_v3.Schema$Channel => {
  if ((resource === 'events' || resource === 'acl') && (!calendarId || calendarId.trim().length === 0)) {
    throw new Error(`Resource type '${resource}' requires a calendar ID.`);
  }

  if (token && token.length > 256) {
    throw new Error('Token must be 256 characters or fewer.');
  }

  const body: calendar_v3.Schema$Channel = {
    id: uuidv4(),
    type: 'web_hook',
    address,
  };

  if (token) {
    body.token = token;
  }

  if (ttlHours !== undefined) {
    if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
      throw new Error('ttl-hours must be a positive number.');
    }
    const expiration = Date.now() + Math.floor(ttlHours * 3600 * 1000);
    body.expiration = String(expiration);
  }

  return body;
};

const callWatchEndpoint = async (
  resource: ResourceType,
  calendarId: string | undefined,
  requestBody: calendar_v3.Schema$Channel,
  calendar: calendar_v3.Calendar,
): Promise<calendar_v3.Schema$Channel> => {
  switch (resource) {
    case 'events': {
      if (!calendarId) {
        throw new Error('calendarId is required for events watch.');
      }
      const response = await calendar.events.watch({ calendarId, requestBody });
      return response.data;
    }
    case 'acl': {
      if (!calendarId) {
        throw new Error('calendarId is required for ACL watch.');
      }
      const response = await calendar.acl.watch({ calendarId, requestBody });
      return response.data;
    }
    case 'calendarList': {
      const response = await calendar.calendarList.watch({ requestBody });
      return response.data;
    }
    case 'settings': {
      const response = await calendar.settings.watch({ requestBody });
      return response.data;
    }
    default:
      throw new Error(`Unsupported resource type: ${resource}`);
  }
};

export const watchCommand = async (options: WatchOptions): Promise<void> => {
  const address = options.address;
  assertHttpsAddress(address);
  const resource = coerceResourceType(options.resource);
  const calendarId = options.calendarId;

  const requestBody = buildWatchRequest(resource, calendarId, address, options.token, options.ttlHours);

  const authClient = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth: authClient });

  const channel = await callWatchEndpoint(resource, calendarId, requestBody, calendar);

  if (!channel.id || !channel.resourceId || !channel.resourceUri) {
    throw new Error('Watch response did not include required channel identifiers.');
  }

  const expirationMs = parseExpiration(channel.expiration ?? requestBody.expiration ?? undefined);

  upsertChannel({
    channelId: channel.id,
    resourceId: channel.resourceId,
    resourceUri: channel.resourceUri,
    expiration: expirationMs,
    token: channel.token ?? requestBody.token ?? undefined,
    calendarId: calendarId ?? 'n/a',
    address,
    resourceType: resource,
    createdAt: Date.now(),
  });

  console.log('Watch channel created successfully.');
  console.log(`Channel ID: ${channel.id}`);
  console.log(`Resource ID: ${channel.resourceId}`);
  console.log(`Resource URI: ${channel.resourceUri}`);
  if (expirationMs) {
    const expiresAt = new Date(expirationMs);
    console.log(`Expiration: ${expiresAt.toISOString()}`);
  } else {
    console.log('Expiration: not provided (check API defaults).');
  }
  console.log('Run `gcalendar-webhook-cli channels list` to review stored channels.');
};
