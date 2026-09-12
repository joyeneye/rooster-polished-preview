import type {Config,Context} from '@netlify/functions';
import {albumStore,updateAlbumCaption} from './_shared/member-albums.mts';
export default async(req:Request,context:Context)=>updateAlbumCaption(req,albumStore(context));
export const config:Config={path:'/api/member-album/caption',method:'POST',rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain']}};
