import type {Config,Context} from '@netlify/functions';
import {videoTransferStore,putVideoPart} from './_shared/video-transfers.mts';
export default (req:Request,context:Context)=>putVideoPart(req,videoTransferStore(context));
export const config:Config={path:'/api/video-uploads/part',method:'POST',rateLimit:{windowLimit:180,windowSize:60,aggregateBy:['ip','domain']}};
