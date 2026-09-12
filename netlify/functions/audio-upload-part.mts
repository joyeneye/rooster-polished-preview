import type {Config,Context} from '@netlify/functions';
import {audioTransferStore,putAudioPart} from './_shared/audio-transfers.mts';
export default (req:Request,context:Context)=>putAudioPart(req,audioTransferStore(context));
export const config:Config={path:'/api/audio-uploads/part',method:'POST',rateLimit:{windowLimit:180,windowSize:60,aggregateBy:['ip','domain']}};
