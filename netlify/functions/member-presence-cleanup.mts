import type {Context,Config} from '@netlify/functions';
import {cleanupPresence,presenceStore} from './_shared/member-presence.mts';
export default async (_req:Request,ctx:Context)=>{await cleanupPresence(presenceStore(ctx));};
export const config:Config={schedule:'37 * * * *'};
