import { requireUser,responseError } from '@/lib/server';
import { workspace } from '@/lib/workspace';
export const dynamic='force-dynamic';
export async function GET(request:Request){try {const user=await requireUser();return Response.json(await workspace(user,new URL(request.url).searchParams.get('caseId')||undefined),{headers:{'Cache-Control':'private, no-store'}});}catch(error){return responseError(error);}}
