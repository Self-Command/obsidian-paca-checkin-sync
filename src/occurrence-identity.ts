import {SyncProblem,type Task} from './types';

export function normalizedParent(value:unknown):string {
 if(typeof value!=='string')return '';
 let path=value.trim();
 if(path.startsWith('[[')&&path.endsWith(']]'))path=path.slice(2,-2).split('|')[0];
 const markdown=/^\[[^\]]*\]\((.*?)\)$/.exec(path);
 if(markdown){try{path=decodeURIComponent(markdown[1].replace(/^<|>$/g,''))}catch{return ''}}
 return path.replace(/\\/g,'/').replace(/\.md$/,'');
}

export function verifyOccurrence(task:Task,parentPath:string,date:string,id:string,existingMarker:unknown,body:string,parentID?:string):void {
 const bodyMarkers=[...body.matchAll(/<!-- paca-sync-id:([a-f0-9-]{36}) -->/gi)].map(m=>m[1]);
 if(task.occurrence_date!==date||normalizedParent(task.recurrence_parent)!==normalizedParent(parentPath)||
    (typeof existingMarker==='string'&&existingMarker!==id&&existingMarker!==parentID)||bodyMarkers.some(marker=>marker!==id&&marker!==parentID)) {
  throw new SyncProblem('association','返回的周期笔记与本期任务不一致，已停止写入。请核对母任务、周期日期和同步标记。');
 }
}
