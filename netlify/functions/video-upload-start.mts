import type {Config,Context} from '@netlify/functions';
import {videoTransferStore,startVideoUpload} from './_shared/video-transfers.mts';
export default (req:Request,context:Context)=>startVideoUpload(req,videoTransferStore(context));
export const config:Config={path:'/api/video-uploads/start',method:'POST',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
