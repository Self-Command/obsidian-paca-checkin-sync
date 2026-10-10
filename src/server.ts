import {requestUrl} from 'obsidian';
import {type Server,type Settings,type Checkin,type Source,type Delivery,type DeliveryReport,type DeliveryAction,SyncProblem} from './types';
import {pairingCode} from './pairing';
export class PacaServer implements Server {
 constructor(readonly settings:Settings){}
 private base():string {let url:URL;try{url=new URL(this.settings.address)}catch{throw new SyncProblem('address','请填写有效的 Paca 服务地址。')}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='')throw new SyncProblem('address','请填写不带路径的 HTTPS 服务地址。');if(!/^[a-f0-9]{64}$/.test(pairingCode(this.settings)))throw new SyncProblem('token','请填写有效的配对码。');return url.origin+(this.settings.pairingMode==='task'||this.settings.taskToken?'/task-sync/v1/checkin':'/checkin-api/v1/sync');}
 private async request(path:string,body?:unknown,binary=false):Promise<unknown|ArrayBuffer>{let response;try{response=await requestUrl({url:this.base()+path,method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+pairingCode(this.settings),'X-Sync-Device':this.settings.deviceID,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),throw:false})}catch{throw new SyncProblem(binary?'transfer_unavailable':'unavailable',binary?'照片传输中断，将稍后重试。':'服务暂不可用，将稍后重试。')}if(response.status===410)throw new SyncProblem('expired','照片已超过保存期限。');if(response.status===401||response.status===403)throw new SyncProblem('token','设备授权已失效，请重新配对。');if(response.status===404)throw new SyncProblem('source_missing','任务来源需要核对，可重新关联笔记。');if(response.status===409)throw new SyncProblem('revision','任务已更新，请重新同步后处理。');if(response.status!==200&&response.status!==201)throw new SyncProblem('unavailable','暂时无法连接服务，请稍后重试。');return binary?response.arrayBuffer:response.json;}
 async changes(after:number):Promise<{items:Checkin[];next_cursor:number;has_more:boolean}>{return await this.request('/changes?after='+after) as {items:Checkin[];next_cursor:number;has_more:boolean}}
 async source(task:string):Promise<Source>{return await this.request('/sources/'+encodeURIComponent(task)) as Source}
 async media(id:string):Promise<ArrayBuffer>{return await this.request('/media/'+encodeURIComponent(id),undefined,true) as ArrayBuffer}
 async receipt(item:Checkin,op:string,status:string,base:string,path:string,hash:string):Promise<{id:string}>{return await this.request('/receipts',{cursor:item.cursor,op_id:op,status,base_status:base,path,base_revision:item.revision,details_sha256:hash}) as {id:string}}
 async ack(id:string,status:string,path:string,hash:string):Promise<void>{await this.request('/receipts/'+id+'/ack',{status,path,details_sha256:hash})}
 async conflict(item:Checkin,local:string):Promise<{id:string}>{return await this.request('/conflicts',{instance_id:item.instance_id,base_revision:item.revision,local:{status:local}}) as {id:string}}
 async resolve(id:string,item:Checkin,keep:'server'|'local',status?:string):Promise<void>{await this.request('/conflicts/'+id+'/resolve',{keep,base_revision:item.revision,...(status?{paca_status_id:status}:{})})}
 async info():Promise<{statuses:{id:string;name:string}[];connection_id:string;project_id:string}>{return await this.request('/info') as {statuses:{id:string;name:string}[];connection_id:string;project_id:string}}
 async deliveries(after:number):Promise<{items:Delivery[];next_cursor:number;has_more:boolean}>{return await this.request('/deliveries?after='+after) as {items:Delivery[];next_cursor:number;has_more:boolean}}
 async report(body:DeliveryReport):Promise<Partial<Delivery>>{return await this.request('/deliveries/report',body) as Partial<Delivery>}
 async action(body:DeliveryAction):Promise<unknown>{return this.request('/deliveries/actions',body)}
}
