'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Check, LoaderCircle, ShieldCheck } from 'lucide-react';

export function Brand({ light = false }: { light?: boolean }) {
  return <span className={`brand ${light ? 'brand-light' : ''}`}><span className="brand-mark"><ShieldCheck size={23} strokeWidth={1.8}/></span><span>Vet<span className="brand-accent">Cred</span></span></span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function Button({ children, busy, variant = 'primary', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary'|'secondary'|'ghost'|'danger' }) {
  return <button {...props} disabled={props.disabled || busy} className={`button button-${variant} ${className}`}>{busy && <LoaderCircle size={17} className="spin"/>}{children}</button>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p></div>;
}

export function PageHeading({ eyebrow, title, description, children }: { eyebrow?:string;title:string;description:string;children?:ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{children && <div className="heading-action">{children}</div>}</div>;
}

export function StatusBadge({ state }: { state: string }) {
  const labels: Record<string,string> = { draft:'Draft', ready_for_review:'Ready for review', changes_requested:'Changes requested', approved_for_sharing:'Approved for sharing', self_reported:'Self-reported', supporting_document_attached:'Supporting document attached', missing_source:'Source needed', counselor_reviewed:'Counselor-reviewed', pending:'Needs review', accepted:'Accepted', rejected:'Rejected', ready:'Ready', failed:'Needs attention', running:'Processing', queued:'Queued', succeeded:'Complete' };
  return <span className={`badge badge-${state}`}>{state === 'approved_for_sharing' && <Check size={12}/>} {labels[state] ?? state.replaceAll('_',' ')}</span>;
}

export function ActionLink({ children, onClick }: { children:ReactNode;onClick:()=>void }) { return <button className="text-button" onClick={onClick}>{children}<ArrowRight size={16}/></button>; }

export function SourceList({ ids, sources }: { ids: string[]; sources: {id:string;locator:string;text:string;assetId:string|null}[] }) {
  if (!ids.length) return <p className="field-hint">No source connected. Add your own context or a supporting document.</p>;
  return <div className="source-list">{ids.map(id => { const source = sources.find(s => s.id === id); return source ? <details key={id}><summary>{source.locator}</summary><blockquote>{source.text}</blockquote>{source.assetId && <a href={`/api/assets/${source.assetId}?download=1`} target="_blank" rel="noreferrer">Open private source</a>}<small>Source ID: {id}</small></details> : <p key={id} className="notice notice-error">Source unavailable. Review this statement before sharing.</p>; })}</div>;
}
