import type {Config,Context} from '@netlify/functions';
import {albumStore,getAlbumPhoto} from './_shared/member-albums.mts';
export default async(req:Request,context:Context)=>getAlbumPhoto(req,albumStore(context));
export const config:Config={path:'/api/member-album-photo/:member/:slot/:hash',method:'GET',rateLimit:{windowLimit:180,windowSize:60,aggregateBy:['ip','domain']}};
