import type { Workspace } from '@/lib/types';
export type Command = (action:string,payload:unknown)=>Promise<{workspace:Workspace;shareUrl?:string}|undefined>;
export type PanelProps = {workspace:Workspace;command:Command;refresh:()=>Promise<void>;busy:boolean};
