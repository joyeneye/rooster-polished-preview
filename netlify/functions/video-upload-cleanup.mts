import type {Config,Context} from '@netlify/functions';
import {videoTransferStore,cleanVideoTransfers} from './_shared/video-transfers.mts';
export default async (_req:Request,context:Context)=>{ await cleanVideoTransfers(videoTransferStore(context)); };
export const config:Config={schedule:'23 * * * *'};
