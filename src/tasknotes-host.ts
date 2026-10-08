import {verifyOccurrence} from './occurrence-identity';
import {sharedTaskTags,localTaskTags} from './task-tags';
import {TFile,getFrontMatterInfo,type App,type EventRef} from 'obsidian';
import {SyncProblem,type Task} from './types';
import {sharedBody,replaceSharedBody} from './task-sync-engine';
import {taskFields,type SyncedTask,type TaskSnapshot,type TaskSyncHost,type TaskLink} from './task-sync-types';

interface MutationContext {source:string;correlationId:string}
export interface TaskEvent {event:string;before?:Task;after?:Task;deletedTask?:Task;task?:Task;changes:Record<string,{before:unknown;after:unknown}>;context?:{source?:string};source?:string}
export interface TaskNotesApi {
 apiVersion:string|number;
 recurring:{materializeOccurrence(path:string,date:string,context?:MutationContext):Promise<Task>};
 tasks:{get(path:string):Promise<Task|null>;list():Promise<Task[]>;create(data:Record<string,unknown>,context?:MutationContext):Promise<Task>;update(path:string,patch:Record<string,unknown>,context?:MutationContext):Promise<Task>;delete(path:string,context?:MutationContext):Promise<void>;archive(path:string,value:boolean,context?:MutationContext):Promise<Task>;setStatus(path:string,status:string,context?:MutationContext):Promise<Task>};
 events:{on(name:string,callback:(event:TaskEvent)=>void):EventRef;off(ref:EventRef):void};
 catalog:{statuses():{value:string;label:string}[]};
 settings:{snapshot():{tasksFolder:string;taskTag?:string;taskIdentificationMethod?:string;fieldMapping?:{archiveTag?:string}}};
}
export function tasknotes(app:App):TaskNotesApi {
 const registry=(app as App&{plugins:{plugins:Record<string,{api?:TaskNotesApi}>}}).plugins;
 const runtime=registry.plugins.tasknotes?.api;
 if(!runtime?.tasks?.update||!runtime.events)throw new SyncProblem('tasknotes','请启用官方 TaskNotes 插件后再同步。');
 return runtime;
}
export const mutationContext=():MutationContext=>({source:'paca-task-sync',correlationId:crypto.randomUUID()});
export function taskHost(app:App,save:()=>Promise<void>,bound:(id:string,link:TaskLink)=>void,links:()=>Record<string,TaskLink>=()=>({})):TaskSyncHost {
 const file=(path:string):TFile=>{const found=app.vault.getAbstractFileByPath(path);if(!(found instanceof TFile))throw new SyncProblem('missing','对应任务笔记未找到，请重新关联。');return found};
 const body=async(path:string):Promise<string>=>{const text=await app.vault.read(file(path));return text.slice(getFrontMatterInfo(text).contentStart)};
 const resolveParent=(reference:unknown):unknown=>{if(typeof reference!=='string'||!reference)return reference;if(/^[a-f0-9-]{36}$/i.test(reference))return reference;let path=reference;if(path.startsWith('[[')&&path.endsWith(']]'))path=path.slice(2,-2).split('|')[0];const match=/^\[[^\]]*\]\((.*?)\)$/.exec(path);if(match)path=decodeURIComponent(match[1].replace(/^<|>$/g,''));if(!path.endsWith('.md'))path+='.md';const found=Object.entries(links()).find(([,link])=>link.path===path);if(!found)throw new SyncProblem('association','请先同步循环母任务，再关联本期任务。');return found[0]};
 const localSnapshot=(snapshot:TaskSnapshot):TaskSnapshot=>{if(typeof snapshot.recurrence_parent!=='string'||!snapshot.recurrence_parent)return snapshot;const parent=links()[snapshot.recurrence_parent];if(!parent?.path)throw new SyncProblem('association','请先同步循环母任务，再创建本期任务。');return{...snapshot,recurrence_parent:'[['+parent.path.replace(/\.md$/,'')+']]'}};
 const patchFields=(snapshot:TaskSnapshot,current?:Task):Record<string,unknown>=>{const patch:Record<string,unknown>={};for(const key of taskFields)if(key in snapshot&&key!=='details'&&key!=='archived')patch[key]=snapshot[key]??undefined;if('tags' in snapshot)patch.tags=localTaskTags(snapshot.tags,'archived' in snapshot?Boolean(snapshot.archived):Boolean(current?.archived),tasknotes(app).settings.snapshot());return patch};
 return {
  task:path=>tasknotes(app).tasks.get(path),
  find:async id=>{const candidates=[];for(const task of await tasknotes(app).tasks.list()){const f=app.vault.getAbstractFileByPath(task.path);if(!(f instanceof TFile))continue;if(app.metadataCache.getFileCache(f)?.frontmatter?.paca_sync_id===id||(await body(task.path)).includes('<!-- paca-sync-id:'+id+' -->'))candidates.push(task)}if(candidates.length>1)throw new SyncProblem('association','同一个同步标记出现在多个笔记中，请先核对关联。');return candidates[0]??null},
  create:async(serverSnapshot,id)=>{const snapshot=localSnapshot(serverSnapshot);let created:Task;if(typeof serverSnapshot.recurrence_parent==='string'&&typeof serverSnapshot.occurrence_date==='string'){const parent=links()[serverSnapshot.recurrence_parent];created=await tasknotes(app).recurring.materializeOccurrence(parent.path,serverSnapshot.occurrence_date,mutationContext());verifyOccurrence(created,parent.path,serverSnapshot.occurrence_date,id,app.metadataCache.getFileCache(file(created.path))?.frontmatter?.paca_sync_id,await body(created.path),serverSnapshot.recurrence_parent);await app.fileManager.processFrontMatter(file(created.path),frontmatter=>{frontmatter.paca_sync_id=id});created=await tasknotes(app).tasks.update(created.path,{...patchFields(snapshot),details:replaceSharedBody(await body(created.path),String(snapshot.details??''),id)},mutationContext())}else created=await tasknotes(app).tasks.create({...patchFields(snapshot),details:replaceSharedBody('',String(snapshot.details??''),id),customFrontmatter:{paca_sync_id:id}},mutationContext());const clearDefaults:Record<string,unknown>={};for(const field of ['scheduled','due'] as const)if(field in snapshot&&snapshot[field]===null&&created[field])clearDefaults[field]=undefined;if(Object.keys(clearDefaults).length)created=await tasknotes(app).tasks.update(created.path,clearDefaults,mutationContext());if(snapshot.archived===true)return tasknotes(app).tasks.archive(created.path,true,mutationContext());return created},
  update:async(path,serverSnapshot,id)=>{const snapshot=localSnapshot(serverSnapshot);const current=await tasknotes(app).tasks.get(path);const patch=patchFields(snapshot,current??undefined);if('details' in snapshot)patch.details=replaceSharedBody(await body(path),String(snapshot.details??''),id);let result=Object.keys(patch).length?await tasknotes(app).tasks.update(path,patch,mutationContext()):await tasknotes(app).tasks.get(path);if(!result)throw new SyncProblem('missing','对应任务笔记未找到。');if('archived' in snapshot)result=await tasknotes(app).tasks.archive(result.path,Boolean(snapshot.archived),mutationContext());return result},
  delete:path=>tasknotes(app).tasks.delete(path,mutationContext()),
  snapshot:async(task:SyncedTask)=>{const snapshot:TaskSnapshot={};for(const key of taskFields)snapshot[key]=task[key]??null;snapshot.tags=sharedTaskTags(task.tags,tasknotes(app).settings.snapshot());snapshot.archived=Boolean(task.archived);snapshot.details=sharedBody(await body(task.path));snapshot.recurrence_parent=resolveParent(snapshot.recurrence_parent);return snapshot},
  save,bound,
 };
}
