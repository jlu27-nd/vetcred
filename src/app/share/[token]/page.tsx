import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadShare } from '@/lib/publication';
import { PortfolioView,PrintButton } from '@/components/portfolio-view';
export const dynamic='force-dynamic';
export const metadata={title:'Portfolio | VetCred',robots:{index:false,follow:false}};
export default async function SharePage({params}:{params:Promise<{token:string}>}){const {token}=await params;const data=await loadShare(token);if(!data)notFound();return <main className="shared-page"><header className="share-header"><Link href="/">VetCred</Link><span>Shared with the veteran’s approval</span><PrintButton/></header><PortfolioView snapshot={data.snapshot} mediaUrl={id=>`/api/share/${token}/media/${id}`}/></main>;}
