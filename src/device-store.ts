import {SyncProblem,type State} from './types';
import type {TaskSyncState} from './task-sync-types';
interface Adapter {exists(path:string):Promise<boolean>;read(path:string):Promise<string>;write(path:string,value:string):Promise<void>}
interface Payload {state:State;tasks:TaskSyncState}
interface Envelope {generation:number;hash:string;payload:Payload}
const hash=async(value:unknown):Promise<string>=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(v=>v.toString(16).padStart(2,'0')).join('');
// Two source-verified slots preserve the last complete state if a write is interrupted.
// Each physical client owns its filenames, even when plugin settings are synced by Obsidian.
export class DeviceStore {
 private generation=0;private writing:Promise<void>=Promise.resolve();
 constructor(private adapter:Adapter,private base:string,private device:string){}
 private path(slot:number):string{return `${this.base}/device-${this.device}-${slot}.json`}
 async load():Promise<Payload|null>{let selected:Envelope|null=null;let found=false;for(const slot of [0,1]){if(!await this.adapter.exists(this.path(slot)))continue;found=true;try{const value=JSON.parse(await this.adapter.read(this.path(slot))) as Envelope;if(!Number.isSafeInteger(value.generation)||value.generation<1||!value.payload||await hash(value.payload)!==value.hash)continue;if(!selected||value.generation>selected.generation)selected=value}catch{/* The other verified slot remains usable. */}}if(found&&!selected)throw new SyncProblem('storage','同步记录无法读取，请保留设备记录文件后恢复备份。');if(selected)this.generation=selected.generation;return selected?.payload??null}
 save(payload:Payload):Promise<void>{const snapshot=structuredClone(payload);const next=this.writing.catch(()=>{}).then(async()=>{const generation=this.generation+1;const value:Envelope={generation,hash:await hash(snapshot),payload:snapshot};await this.adapter.write(this.path(generation%2),JSON.stringify(value));this.generation=generation});this.writing=next;return next}
}
