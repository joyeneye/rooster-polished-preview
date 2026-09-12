import type {Config,Context} from '@netlify/functions';
import {albumStore,deleteAlbumPhoto} from './_shared/member-albums.mts';
export default async(req:Request,context:Context)=>deleteAlbumPhoto(req,albumStore(context));
export const config:Config={path:'/api/member-album/delete',method:'POST',rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain']}};
