import type { Config, Context } from '@netlify/functions';
import { manageFeaturedSongs, songStores, songsFailure } from './_shared/member-songs.mts';

export default async (req:Request, context:Context):Promise<Response> => {
  try { return await manageFeaturedSongs(req,songStores(context)); }
  catch (error) { return songsFailure(error); }
};
export const config:Config = {path:'/api/profile-music-features',method:['GET','POST','DELETE'],rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain']}};
