import type { Config } from '@netlify/functions';
import { handleProfileBookings } from './_shared/profile-bookings.mts';

export default async (req: Request): Promise<Response> => handleProfileBookings(req);
export const config: Config = {
  path: '/api/profile-bookings', method: 'GET',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
