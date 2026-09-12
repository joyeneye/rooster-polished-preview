import type {Config,Context} from '@netlify/functions';
import {albumStore,getAlbum} from './_shared/member-albums.mts';
export default async(req:Request,context:Context)=>getAlbum(req,albumStore(context));
export const config:Config={path:'/api/member-album',method:'GET',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
