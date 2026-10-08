import {requestUrl} from 'obsidian';
import {SyncProblem,type Settings} from './types';
import type {TaskSyncServer,TaskChange,TaskConflict,TaskOperation,TaskSnapshot} from './task-sync-types';

export function serviceOrigin(address:string):string {
 let url:URL;try{url=new URL(address)}catch{throw new SyncProblem('address','请填写有效的 Paca 服务地址。')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='')throw new SyncProblem('address','请填写不带路径的 HTTPS 服务地址。');
 return url.origin;
}
export class TaskServer implements TaskSyncServer {
 constructor(readonly settings:Settings){}
 private async request(path:string,body?:unknown):Promise<unknown>{
  if(!/^[a-f0-9]{64}$/.test(this.settings.taskToken))throw new SyncProblem('token','请填写任务同步配对码，或迁移原打卡配对码。');
  const response=await requestUrl({url:serviceOrigin(this.settings.address)+'/task-sync/v1'+path,method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+this.settings.taskToken,'X-Sync-Device':this.settings.deviceID,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),throw:false});
  if(response.status===401||response.status===403)throw new SyncProblem('token','任务同步授权已失效，请重新配对。');
  if(response.status===404)throw new SyncProblem('missing','关联任务尚未找到。');
  if(response.status===409)throw new SyncProblem('revision','任务已发生变化，请重新同步后核对。');
  if(response.status<200||response.status>=300)throw new SyncProblem('unavailable','任务同步服务暂时无法连接，请稍后重试。');
  return response.json;
 }
 async migrate():Promise<string>{
  const response=await requestUrl({url:serviceOrigin(this.settings.address)+'/task-sync/v1/pair',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:this.settings.token,device_id:this.settings.deviceID}),throw:false});
  if(response.status!==201)throw new SyncProblem('token','原配对码暂时无法迁移，请检查配置后重试。');
  return (response.json as {token:string}).token;
 }
 async info():Promise<{mode:string}>{return await this.request('/info') as {mode:string}}
 async changes(cursor:number):Promise<{items:TaskChange[];next_cursor:number;has_more:boolean;mode:string}>{return await this.request('/changes?after='+cursor) as {items:TaskChange[];next_cursor:number;has_more:boolean;mode:string}}
 async binding(id:string,action:'claim'|'confirm',path?:string,created?:string):Promise<{state:string;path?:string;note_created?:string}>{return await this.request('/bindings',{sync_id:id,action,...(path?{path,note_created:created}:{})}) as {state:string;path?:string;note_created?:string}}
 async submit(operation:TaskOperation):Promise<{state:string}>{return await this.request('/operations',operation) as {state:string}}
 async operation(id:string):Promise<{state:string;error?:string;result?:{sync_id?:string}}>{return await this.request('/operations/'+encodeURIComponent(id)) as {state:string;error?:string;result?:{sync_id?:string}}}
 async receipt(item:TaskChange,op:string,fields:string[]):Promise<{id:string}>{return await this.request('/receipts',{sync_id:item.sync_id,revision:item.revision,op_id:op,expected:item.snapshot,fields}) as {id:string}}
 async ack(id:string,snapshot:TaskSnapshot,path:string,created:string):Promise<void>{await this.request('/receipts/'+encodeURIComponent(id)+'/ack',{snapshot,path,note_created:created})}
 async lookup(path:string,created:string):Promise<{sync_id:string;revision:number;snapshot:TaskSnapshot}>{return await this.request('/lookup?path='+encodeURIComponent(path)+'&note_created='+encodeURIComponent(created)) as {sync_id:string;revision:number;snapshot:TaskSnapshot}}
 async conflicts():Promise<{items:TaskConflict[]}>{return await this.request('/conflicts') as {items:TaskConflict[]}}
 async resolve(id:string,keep:'local'|'server',revision:number):Promise<void>{await this.request('/conflicts/'+encodeURIComponent(id)+'/resolve',{keep,revision})}
}
