import type {Config,Context} from '@netlify/functions';
import {audioTransferStore,cleanAudioTransfers} from './_shared/audio-transfers.mts';
export default async (_req:Request,context:Context)=>{ await cleanAudioTransfers(audioTransferStore(context)); };
export const config:Config={schedule:'17 * * * *'};
