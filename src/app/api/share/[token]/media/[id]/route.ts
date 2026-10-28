import { loadShare } from '@/lib/publication';
import { SHARE_BUCKET,storageAdmin } from '@/lib/server';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{token:string;id:string}>}){const {token,id}=await params;const share=await loadShare(token);if(!share||!share.snapshot.photos.some(p=>p.id===id)||!share.media[id])return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});const {data,error}=await storageAdmin().storage.from(SHARE_BUCKET).download(share.media[id]);if(error||!data)return new Response('Not found',{status:404});return new Response(data,{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
