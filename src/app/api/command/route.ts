import { z } from 'zod';
import { body,requireUser,responseError } from '@/lib/server';
import { workspace } from '@/lib/workspace';
import { command } from '@/lib/actions';
export const maxDuration=240;
export async function POST(request:Request){try{const user=await requireUser();const v=z.object({caseId:z.uuid(),revision:z.number().int().positive(),action:z.string().max(50),payload:z.unknown()}).strict().parse(await body(request));const result=await command(user,v.caseId,v.revision,v.action,v.payload);return Response.json({...result,workspace:await workspace(user,v.caseId)},{headers:{'Cache-Control':'private, no-store'}});}catch(error){return responseError(error);}}
