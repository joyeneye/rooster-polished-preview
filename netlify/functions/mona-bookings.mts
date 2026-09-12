import type { Config } from '@netlify/functions';
import { getMonaBookings } from './_shared/mona-booking-summary.mts';

export default (req: Request): Promise<Response> => getMonaBookings(req);

export const config: Config = {
  path: '/api/mona/bookings',
  method: 'GET',
  rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
