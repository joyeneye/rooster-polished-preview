import type {Config,Context} from '@netlify/functions';
import {audioTransferStore,startAudioUpload} from './_shared/audio-transfers.mts';
export default (req:Request,context:Context)=>startAudioUpload(req,audioTransferStore(context));
export const config:Config={path:'/api/audio-uploads/start',method:'POST',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
