import {V7_IDS,parsePresentation,record,type PresentationSection} from './presentationV7';
export type AnalysisStatus='IDLE'|'QUEUED'|'RUNNING'|'SECTION_COMPLETED'|'SECTION_UNASSESSED'|'FAILED'|'CANCELLED'|'COMPLETE';
export type AnalysisEvent={job_id:string;type:Exclude<AnalysisStatus,'IDLE'>;section?:unknown;report?:unknown;message?:string};
export type AnalysisState={jobId:string|null;status:AnalysisStatus;sections:Record<string,PresentationSection>;report:unknown|null;message:string};
export const INITIAL_ANALYSIS:AnalysisState={jobId:null,status:'IDLE',sections:{},report:null,message:''};
export function applyAnalysisEvent(state:AnalysisState,event:AnalysisEvent):AnalysisState{
 if(!event.job_id||!['QUEUED','RUNNING','SECTION_COMPLETED','SECTION_UNASSESSED','FAILED','CANCELLED','COMPLETE'].includes(event.type))throw Error('Invalid analysis event');
 if(state.jobId&&event.job_id!==state.jobId&&event.type!=='QUEUED')throw Error('Event belongs to a different job');
 const current=event.type==='QUEUED'?{...INITIAL_ANALYSIS,jobId:event.job_id}:state;
 if(['FAILED','CANCELLED','COMPLETE'].includes(current.status))throw Error('Job already finished');
 let sections=current.sections;let report=current.report;
 if(event.type==='SECTION_COMPLETED'||event.type==='SECTION_UNASSESSED'){
 const raw=record(event.section);if(!V7_IDS.includes(raw.section_id as typeof V7_IDS[number]))throw Error('Unknown section');
 const skeleton=V7_IDS.map(section_id=>raw.section_id===section_id?raw:{section_id,score_0_10:null,evidence_status:'NOT_YET_ASSESSED',timestamps:[]});
 const parsed=parsePresentation({schema_version:'7.0.0-presentation',assessment_sections:skeleton,overall_score_0_10:null,overall_score_status:'NOT_YET_ASSESSED'});
 const section=parsed.assessment_sections.find(s=>s.section_id===raw.section_id)!;if(event.type==='SECTION_UNASSESSED'&&section.score_0_10!==null)throw Error('Unassessed section carries a score');sections={...sections,[section.section_id]:section};
 }
 if(event.type==='COMPLETE'){parsePresentation(event.report);report=event.report;}
 return{jobId:event.job_id,status:event.type,sections,report,message:event.message||''};
}
export function progressPresentation(state:AnalysisState):unknown|null{if(state.report)return state.report;if(!Object.keys(state.sections).length)return null;return{schema_version:'7.0.0-presentation',experimental_phase9:Object.values(state.sections).some(section=>section.method_version==='phase9_experimental_proxy'),assessment_sections:V7_IDS.map(section_id=>state.sections[section_id]||{section_id,score_0_10:null,evidence_status:'NOT_YET_ASSESSED',timestamps:[]}),overall_score_0_10:null,overall_score_status:'NOT_YET_ASSESSED'};}
