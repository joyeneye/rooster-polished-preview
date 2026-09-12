import type {Config,Context} from '@netlify/functions';
import {albumStore,uploadAlbumPhoto} from './_shared/member-albums.mts';
export default async(req:Request,context:Context)=>uploadAlbumPhoto(req,albumStore(context));
export const config:Config={path:'/api/member-album/upload',method:'POST',rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain']}};
