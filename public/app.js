const API='/api';
const roundNames={1:'Science',2:'Sports',3:'General Knowledge',4:'History',5:'Current Affairs',6:'Music'};
const state={questionBankLoaded:false,timerPersisted:false,drawAudience:false,manualTeamOverride:null,answerRevealPending:false,pendingScores:{},realtimeChannel:null,realtimeRefreshTimer:null,presentationKey:null,page:new URLSearchParams(location.search).get('view')==='admin'?'admin':'home',data:{teams:[],settings:{active_round:1,timer_seconds:30,theme:'midnight',show_paddles:true},current_question:null,draws:[],scores:[],events:[],pounces:[]},loading:true,admin:false,answerVisible:false,tag:'',busy:false,timer:null,timeLeft:30,timerRunning:false,selectedPaddle:null,showMore:false,presentation:false,showPaddles:true,notice:'',statsRange:'all',adminSession:null,checkingAdmin:false,pageEntering:true,presentationEntering:false,homeQuestionChanged:false,drawPhase:'idle',drawMethod:'random',revealTag:'',remoteSnapshot:null,scoreEffect:null,pounceEffectTeamId:null,answerEffect:false};
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const n=v=>Number(v||0);const rounds=[1,2,3,4,5,6];const themes=[['midnight','Midnight Gold'],['cobalt','Cobalt & Sun'],['evergreen','Evergreen'],['burgundy','Burgundy'],['violet','Violet'],['blush','Soft Blush'],['paper','Light Paper'],['apple','Apple Silver'],['airbnb','Airbnb Coral'],['ocean','Deep Ocean'],['terracotta','Terracotta'],['olive','Olive Grove'],['sandstone','Sandstone'],['rose','Rose Quartz'],['lavender','Lavender'],['mountain','Alpine Night']];
function notify(message,error=false){const el=$('#toast');el.textContent=message;el.hidden=false;el.style.borderColor=error?'var(--bad)':'var(--line)';clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>el.hidden=true,3200)}
function readSavedTheme(){try{const v=localStorage.getItem('egs-quizit-theme');return themes.some(([id])=>id===v)?v:null}catch(e){return null}}
function applyTheme(theme,persist=false){const v=themes.some(([id])=>id===theme)?theme:'midnight';document.documentElement.className='theme-'+v;state.selectedTheme=v;const p=$('#themeGlobal');if(p)p.value=v;if(persist){try{localStorage.setItem('egs-quizit-theme',v)}catch(e){}}}
function populatePublicThemePicker(){const p=$('#themeGlobal');if(!p)return;p.innerHTML=themes.map(([id,label])=>'<option value="'+id+'">'+label+'</option>').join('');p.value=state.selectedTheme||'midnight'}
const sb = window.quizitSupabase;
function sbError(result){if(result&&result.error)throw new Error(result.error.message||String(result.error));return result?result.data:undefined}
let adminAuthCache={user:null,expiresAt:0};
function clearAdminAuthCache(){adminAuthCache={user:null,expiresAt:0}}
async function getAdminSession(){
  try{
    const authResult=await sb.auth.getUser();
    const user=authResult.data&&authResult.data.user;
    if(!user){clearAdminAuthCache();return {signedIn:false,isAdmin:false,email:null}}
    const r=await sb.rpc('quizit_is_admin');
    if(r.error){clearAdminAuthCache();return {signedIn:true,isAdmin:false,email:user.email||null,error:r.error.message}}
    const isAdmin=r.data===true;
    if(isAdmin)adminAuthCache={user:{id:user.id,email:user.email||null},expiresAt:Date.now()+60000};else clearAdminAuthCache();
    return {signedIn:true,isAdmin,email:user.email||null};
  }catch(e){clearAdminAuthCache();return {signedIn:false,isAdmin:false,email:null,error:e.message}}
}
async function requireAdmin(){
  if(adminAuthCache.user&&adminAuthCache.expiresAt>Date.now())return adminAuthCache.user;
  const r=await sb.auth.getUser();const user=r.data&&r.data.user;
  if(r.error||!user){clearAdminAuthCache();throw new Error('Sign in with your admin email and password first.')}
  const a=await sb.rpc('quizit_is_admin');
  if(a.error){clearAdminAuthCache();throw new Error(a.error.message||'Could not check administrator access.')}
  if(a.data!==true){clearAdminAuthCache();throw new Error('This login ID is not approved for admin access.')}
  adminAuthCache={user:{id:user.id,email:user.email||null},expiresAt:Date.now()+60000};
  return adminAuthCache.user;
}
async function getSupabaseState(){
  const [settingResult,qResult]=await Promise.all([
    sb.from('quizit_settings').select('*').eq('id',1).single(),
    sb.rpc('quizit_public_live_question')
  ]);
  const settings=sbError(settingResult);
  const liveRows=sbError(qResult)||[];
  const question=Array.isArray(liveRows)?(liveRows[0]||null):liveRows;
  const results=await Promise.all([
    sb.from('quizit_teams').select('*').eq('active',true).order('sort_order').order('slot'),
    sb.from('quizit_draws').select('id,question_id,tag,round,team_id,method,drawn_at,active').order('drawn_at',{ascending:false}).limit(100),
    sb.from('quizit_score_events').select('id,question_id,team_id,points,event_type,reason,created_at,corrected_event_id,round').order('created_at',{ascending:false}).limit(500)
  ]);
  const teams=sbError(results[0])||[],draws=sbError(results[1])||[],scores=sbError(results[2])||[];
  let pounces=[];
  if(question?.id){
    const p=await sb.from('quizit_pounces').select('id,question_id,team_id,created_at').eq('question_id',question.id);
    pounces=sbError(p)||[];
  }
  let audit=[];
  if((state.page==='stats'||state.page==='admin')&&state.adminSession?.isAdmin){
    const ar=await sb.from('quizit_audit_log').select('id,action,details,operator,created_at').order('created_at',{ascending:false}).limit(200);
    if(!ar.error)audit=ar.data||[];
  }
  return {settings,teams,current_question:question,draws,scores,pounces,questions:[],audit};
}
async function fetchAllPages(makeQuery,maxRows=6500,pageSize=1000){
  const starts=[];
  for(let start=0;start<maxRows;start+=pageSize)starts.push(start);
  const results=await Promise.all(starts.map(start=>makeQuery().range(start,Math.min(start+pageSize-1,maxRows-1))));
  const rows=[];
  for(const result of results){const batch=sbError(result)||[];rows.push(...batch);if(batch.length<pageSize)break;}
  return rows.slice(0,maxRows);
}
async function getQuestionBank(){
  await requireAdmin();
  const [questions,answers]=await Promise.all([
    fetchAllPages(()=>sb.from('quizit_questions').select('*').neq('status','archived').order('round').order('tag')),
    fetchAllPages(()=>sb.from('quizit_question_answers').select('question_id,answer_text').order('question_id'))
  ]);
  const lookup=new Map(answers.map(x=>[x.question_id,x.answer_text]));
  return {questions:questions.map(x=>({...x,answer_text:lookup.get(x.id)||''}))};
}
async function auditEvent(action,details,user){
  const r=await sb.from('quizit_audit_log').insert({action,details:details||{},operator:user&&user.email||null});
  if(r.error)console.warn('Audit write failed',r.error.message);
}
async function executeAdminAction(b){
  const user=await requireAdmin(), action=String(b.action||'');
  const operator=user.email||'admin';
  let r,teamRows,settingResult,settings;
  switch(action){
    case 'set-round':
      if(!Number.isInteger(Number(b.round))||Number(b.round)<1||Number(b.round)>6)throw new Error('Round must be between 1 and 6.');
      const firstTeamResult=await sb.from('quizit_teams').select('id').eq('active',true).order('sort_order').order('slot').limit(1).maybeSingle();
      const firstActiveTeam=sbError(firstTeamResult);if(!firstActiveTeam)throw new Error('No active team is available.');
      r=await sb.from('quizit_settings').update({active_round:Number(b.round),active_team_id:firstActiveTeam.id,current_question_id:null,answer_revealed:false,timer_seconds:10,timer_started_at:null,updated_at:new Date().toISOString()}).eq('id',1);
      sbError(r);await auditEvent(action,{round:Number(b.round),active_team_id:firstActiveTeam.id},user);return {ok:true};
    case 'draw':{
      const method=b.method==='chit'?'chit':'random';
      r=await sb.rpc('quizit_admin_draw',{p_round:Number(b.round),p_method:method,p_tag:b.tag||null,p_team_id:b.team_id||null,p_operator:operator,p_audience:b.audience===true});
      const picked=sbError(r);
      if(picked&&picked.id){
        const ar=await sb.from('quizit_question_answers').select('answer_text').eq('question_id',picked.id).maybeSingle();
        picked.answer_text=ar.error?'':ar.data?.answer_text||'';
      }
      return {ok:true,question:picked};
    }
    case 'reveal-answer':{
      const questionId=String(b.question_id||'');if(!questionId)throw new Error('No current question.');
      const [answerResult,settingUpdate]=await Promise.all([
        sb.from('quizit_question_answers').select('answer_text').eq('question_id',questionId).maybeSingle(),
        sb.from('quizit_settings').update({answer_revealed:true,updated_at:new Date().toISOString()}).eq('id',1).eq('current_question_id',questionId)
      ]);
      const answer=sbError(answerResult);sbError(settingUpdate);if(!answer)throw new Error('No answer key is available for this question.');
      void auditEvent(action,{question_id:questionId},user);return {answer_text:answer.answer_text||''};
    }
    case 'hide-answer':{
      r=await sb.from('quizit_settings').update({answer_revealed:false,updated_at:new Date().toISOString()}).eq('id',1);sbError(r);
      await auditEvent(action,{hidden:true},user);return {ok:true};
    }
    case 'next-team':{
      const tr=await sb.from('quizit_teams').select('id,slot,sort_order').eq('active',true).order('sort_order').order('slot');
      teamRows=sbError(tr)||[];if(!teamRows.length)throw new Error('No active teams.');
      settingResult=await sb.from('quizit_settings').select('active_team_id').eq('id',1).single();settings=sbError(settingResult);
      const i=teamRows.findIndex(t=>t.id===settings.active_team_id);
      const next=teamRows[(i+1+teamRows.length)%teamRows.length];
      r=await sb.from('quizit_settings').update({active_team_id:next.id,updated_at:new Date().toISOString()}).eq('id',1);sbError(r);
      await auditEvent(action,{team_id:next.id},user);return {ok:true,team_id:next.id};
    }
    case 'score':{
      r=await sb.rpc('quizit_admin_score',{p_team_id:b.team_id,p_points:Number(b.points),p_event_type:String(b.event_type||''),p_reason:b.reason||null,p_operator:operator});
      const scored=sbError(r);return {ok:true,score:scored};
    }
    case 'pounce':{
      if(!b.team_id)throw new Error('Choose a team before registering a pounce.');
      r=await sb.rpc('quizit_admin_pounce',{p_team_id:b.team_id,p_operator:operator});
      return {ok:true,pounce:sbError(r)};
    }
    case 'add-team':{
      const tr=await sb.from('quizit_teams').select('id,slot,active').order('slot');teamRows=sbError(tr)||[];
      const slot=teamRows.find(x=>!x.active);
      if(!slot)throw new Error('This arena has six team slots. Edit an existing team to change its details.');
      r=await sb.from('quizit_teams').update({name:String(b.name||'').trim(),school_name:String(b.school_name||''),logo_url:b.logo_url||null,active:true,updated_at:new Date().toISOString()}).eq('id',slot.id);
      sbError(r);await auditEvent(action,{team_id:slot.id,name:b.name},user);return {ok:true,id:slot.id};
    }
    case 'update-team':
      if(!String(b.name||'').trim())throw new Error('Team name is required.');
      r=await sb.from('quizit_teams').update({name:String(b.name).trim(),school_name:String(b.school_name||''),logo_url:b.logo_url||null,updated_at:new Date().toISOString()}).eq('id',b.id);
      sbError(r);await auditEvent(action,{team_id:b.id,name:b.name,school_name:b.school_name},user);return {ok:true};
    case 'add-question':{
      if(!String(b.tag||'').trim()||!String(b.question_text||'').trim()||!String(b.answer_text||'').trim()||!Number.isInteger(Number(b.round))||Number(b.round)<1||Number(b.round)>6)throw new Error('Tag, question, answer and round 1–6 are required.');
      const questionText=cleanOpenQuestion(b.question_text);if(!questionText)throw new Error('Enter a standalone, open-ended question without answer options.');
      const audienceOnly=b.audience_only===true;if(audienceOnly&&b.set_tag)throw new Error('Audience-only questions must be standalone, not part of a team media pair.');const parsedSet=audienceOnly?{set_tag:null,set_order:null}:parseQuestionSet(b.tag,b.set_tag,b.set_order,Number(b.round));
      if(parsedSet.set_tag&&!b.media_url)throw new Error('Paired media questions need an image, audio or video URL. Use Add media pair to create both questions together.');
      const payload={tag:String(b.tag).trim(),round:Number(b.round),question_text:questionText,source_url:b.source_url||null,media_url:b.media_url||null,set_tag:parsedSet.set_tag,set_order:parsedSet.set_order,audience_only:audienceOnly,status:b.status||'available'};
      r=await sb.from('quizit_questions').insert(payload).select('id').single();const row=sbError(r);
      r=await sb.from('quizit_question_answers').upsert({question_id:row.id,answer_text:String(b.answer_text).trim(),updated_at:new Date().toISOString()});sbError(r);
      await auditEvent(action,{question_id:row.id,tag:payload.tag,round:payload.round},user);return {ok:true,id:row.id};
    }
    case 'add-media-pair':{
      const mediaRound=Number(b.round),setTag=String(b.set_tag||'').trim(),mediaUrl=String(b.media_url||'').trim();
      if(![3,6].includes(mediaRound)||!setTag||!(mediaUrl.startsWith('https://')||mediaUrl.startsWith('http://')))throw new Error('Choose Round 3 or 6, a unique set tag, and a valid media URL.');
      const qa=cleanOpenQuestion(b.question_a),qb=cleanOpenQuestion(b.question_b);
      if(!qa||!qb||!String(b.answer_a||'').trim()||!String(b.answer_b||'').trim())throw new Error('Both open-ended questions and both answer keys are required.');
      r=await sb.rpc('quizit_admin_add_media_pair',{p_round:mediaRound,p_set_tag:setTag,p_media_url:mediaUrl,p_question_a:qa,p_answer_a:String(b.answer_a).trim(),p_question_b:qb,p_answer_b:String(b.answer_b).trim(),p_source_url:b.source_url||null,p_operator:operator});
      return {ok:true,...sbError(r)};
    }
    case 'update-question':{
      if(!b.id||!String(b.tag||'').trim()||!String(b.question_text||'').trim()||!String(b.answer_text||'').trim()||!Number.isInteger(Number(b.round))||Number(b.round)<1||Number(b.round)>6)throw new Error('Tag, question, answer and round 1–6 are required.');
      const questionText=cleanOpenQuestion(b.question_text);if(!questionText)throw new Error('Enter a standalone, open-ended question without answer options.');
      const audienceOnly=b.audience_only===true;if(audienceOnly&&b.set_tag)throw new Error('Audience-only questions must be standalone, not part of a team media pair.');const parsedSet=audienceOnly?{set_tag:null,set_order:null}:parseQuestionSet(b.tag,b.set_tag,b.set_order,Number(b.round));
      if(parsedSet.set_tag&&!b.media_url)throw new Error('Paired media questions need an image, audio or video URL. Use Add media pair to create both questions together.');
      const payload={tag:String(b.tag).trim(),round:Number(b.round),question_text:questionText,source_url:b.source_url||null,media_url:b.media_url||null,set_tag:parsedSet.set_tag,set_order:parsedSet.set_order,audience_only:audienceOnly,status:b.status||'available',updated_at:new Date().toISOString()};
      r=await sb.from('quizit_questions').update(payload).eq('id',b.id);sbError(r);
      r=await sb.from('quizit_question_answers').upsert({question_id:b.id,answer_text:String(b.answer_text).trim(),updated_at:new Date().toISOString()});sbError(r);
      await auditEvent(action,{question_id:b.id,tag:payload.tag,round:payload.round},user);return {ok:true};
    }
    case 'import-questions':{
      if(!Array.isArray(b.questions)||b.questions.length>500)throw new Error('Import must contain up to 500 questions per batch.');
      const valid=b.questions.filter(q=>String(q.tag||'').trim()&&cleanOpenQuestion(q.question_text)&&String(q.answer_text||'').trim()&&Number.isInteger(Number(q.round))&&Number(q.round)>=1&&Number(q.round)<=6);
      const unique=[...new Map(valid.map(q=>[String(q.tag).trim(),q])).values()];
      if(!unique.length)return {ok:true,imported:0};
      const tags=unique.map(q=>String(q.tag).trim());
      const existingR=await sb.from('quizit_questions').select('tag').in('tag',tags);const existing=sbError(existingR)||[];
      const existingTags=new Set(existing.map(x=>x.tag));
      const missing=unique.filter(q=>!existingTags.has(String(q.tag).trim()));
      if(!missing.length)return {ok:true,imported:0};
      const rows=missing.map(q=>{const audienceOnly=truthyFlag(q.audience_only);const parsedSet=audienceOnly?{set_tag:null,set_order:null}:parseQuestionSet(q.tag,q.set_tag,q.set_order,Number(q.round));return {tag:String(q.tag).trim(),round:Number(q.round),question_text:cleanOpenQuestion(q.question_text),source_url:q.source_url||null,media_url:q.media_url||null,set_tag:parsedSet.set_tag,set_order:parsedSet.set_order,audience_only:audienceOnly,status:'available'}});
      const insertedR=await sb.from('quizit_questions').insert(rows).select('id,tag');const inserted=sbError(insertedR)||[];
      const answers=inserted.map(row=>{const q=missing.find(x=>String(x.tag).trim()===row.tag);return {question_id:row.id,answer_text:String(q.answer_text).trim()};});
      if(answers.length){r=await sb.from('quizit_question_answers').insert(answers);sbError(r)}
      await auditEvent(action,{imported:inserted.length},user);return {ok:true,imported:inserted.length};
    }
    case 'save-settings':{
      const payload={updated_at:new Date().toISOString()};
      ['correct_points','wrong_points','pounce_correct','pounce_wrong','theme','show_paddles','round3_media_url','final_round_media_url'].forEach(k=>{if(b[k]!==undefined)payload[k]=b[k]});
      payload.correct_points=10;payload.wrong_points=0;payload.pounce_correct=10;payload.pounce_wrong=-5;payload.timer_seconds=10;payload.timer_started_at=null;
      r=await sb.from('quizit_settings').update(payload).eq('id',1);sbError(r);
      await auditEvent(action,b,user);return {ok:true};
    }
    case 'remove-question':{
      if(!b.id)throw new Error('Select a question to remove.');
      const qResult=await sb.from('quizit_questions').select('id,tag,round,set_tag').eq('id',b.id).maybeSingle();const q=sbError(qResult);if(!q)throw new Error('Question not found.');
      let targetIds=[b.id];
      if(Number(q.round)===6&&q.set_tag){
        const pairResult=await sb.from('quizit_questions').select('id').eq('round',6).eq('set_tag',q.set_tag);
        targetIds=(sbError(pairResult)||[]).map(x=>x.id);
        if(!targetIds.includes(b.id))targetIds.push(b.id);
      }
      const [drawRefs,scoreRefs,pounceRefs,currentRef]=await Promise.all([
        sb.from('quizit_draws').select('id',{count:'exact',head:true}).in('question_id',targetIds),
        sb.from('quizit_score_events').select('id',{count:'exact',head:true}).in('question_id',targetIds),
        sb.from('quizit_pounces').select('id',{count:'exact',head:true}).in('question_id',targetIds),
        sb.from('quizit_settings').select('current_question_id').eq('id',1).single()
      ]);
      [drawRefs,scoreRefs,pounceRefs].forEach(sbError);const current=sbError(currentRef);
      const currentIsTarget=targetIds.includes(current.current_question_id);
      const referenced=!!(drawRefs.count||scoreRefs.count||pounceRefs.count||currentIsTarget);
      if(referenced){
        r=await sb.from('quizit_questions').update({status:'archived',updated_at:new Date().toISOString()}).in('id',targetIds);sbError(r);
        if(currentIsTarget){r=await sb.from('quizit_settings').update({current_question_id:null,answer_revealed:false,timer_started_at:null,updated_at:new Date().toISOString()}).eq('id',1);sbError(r)}
      }else{
        r=await sb.from('quizit_question_answers').delete().in('question_id',targetIds);sbError(r);
        r=await sb.from('quizit_questions').delete().in('id',targetIds);sbError(r);
      }
      await auditEvent('remove-question',{question_id:b.id,tag:q.tag,round:q.round,set_tag:q.set_tag,questions_affected:targetIds.length,archived_for_history:referenced},user);
      return {ok:true,archived:referenced,tag:q.tag,questions_affected:targetIds.length};
    }
    case 'reset-draws':{
      r=await sb.from('quizit_questions').update({status:'reset',drawn_at:null,draw_method:null,owner_team_id:null,is_audience:false,updated_at:new Date().toISOString()}).eq('status','drawn');sbError(r);
      r=await sb.from('quizit_draws').update({active:false,reset_at:new Date().toISOString()}).eq('active',true);sbError(r);
      r=await sb.from('quizit_settings').update({current_question_id:null,updated_at:new Date().toISOString()}).eq('id',1);sbError(r);
      await auditEvent(action,{preserved_history:true},user);return {ok:true};
    }
    case 'reset-scores':{
      const c=await sb.from('quizit_score_events').select('id',{count:'exact',head:true});if(c.error)sbError(c);
      r=await sb.from('quizit_score_events').delete().neq('id','00000000-0000-0000-0000-000000000000');sbError(r);
      await auditEvent(action,{previous_event_count:c.count||0},user);return {ok:true};
    }
    default:throw new Error('Unknown admin action: '+action);
  }
}
async function request(path,opts={}){
  if(path==='/state')return await getSupabaseState();
  if(path==='/admin/questions')return await getQuestionBank();
  if(path==='/admin/session')return await getAdminSession();
  if(path==='/admin/action'){
    let b=opts.body||{};if(typeof b==='string'){try{b=JSON.parse(b)}catch{b={}}}
    return await executeAdminAction(b);
  }
  throw new Error('Unknown request: '+path);
}
async function refresh(silent=false){
  try{
    const previousQuestionId=state.data.current_question?.id;const previousScoreIds=new Set((state.data.scores||[]).map(x=>x.id));const wasLoaded=state.remoteSnapshot!==null;const data=await request('/state');const snapshot=JSON.stringify(data);const changed=state.remoteSnapshot!==snapshot;state.remoteSnapshot=snapshot;if(wasLoaded&&data.current_question?.id&&data.current_question.id!==previousQuestionId)state.homeQuestionChanged=true;const freshScore=(data.scores||[]).find(x=>!previousScoreIds.has(x.id));if(wasLoaded&&freshScore&&!state.presentation)state.scoreEffect={teamId:freshScore.team_id,delta:n(freshScore.points)};state.data={...state.data,...data};state.loading=false;
    $('#connectionStatus').innerHTML='<span class="dot"></span>Supabase live';
    state.selectedTheme=readSavedTheme()||state.data.settings.theme||'midnight';
    applyTheme(state.selectedTheme,false);populatePublicThemePicker();
    const savedThemeSelect=$('#themeSelect');if(savedThemeSelect)savedThemeSelect.value=state.data.settings.theme||'midnight';
    state.showPaddles=state.data.settings.show_paddles!==false;
    if(!silent)render();return changed;
  }catch(e){
    state.loading=false;$('#connectionStatus').innerHTML='<span class="dot" style="background:var(--bad)"></span>Connection issue';
    if(!silent){render();notify(e.message,true)}return false;
  }
}
function queueRealtimeRefresh(){
 if(document.visibilityState!=='visible')return;
 clearTimeout(state.realtimeRefreshTimer);
 state.realtimeRefreshTimer=setTimeout(async()=>{
  try{const changed=await refresh(true);if(changed&&(state.presentation||state.page==='home'||state.page==='stats')){if(state.presentation)syncPresentationLive();else render()}}catch(e){console.warn('Realtime refresh skipped',e)}
 },90);
}
function initRealtimeUpdates(){
 if(state.realtimeChannel||!sb||typeof sb.channel!=='function')return;
 const tables=['quizit_score_events','quizit_pounces','quizit_draws','quizit_questions','quizit_settings','quizit_teams'];
 let channel=sb.channel('quizit-live-scoreboard');
 for(const table of tables)channel=channel.on('postgres_changes',{event:'*',schema:'public',table},()=>queueRealtimeRefresh());
 state.realtimeChannel=channel.subscribe(status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Realtime scoreboard unavailable; 6-second polling remains active')});
}
function scoreMap(){const m={};for(const t of state.data.teams)m[t.id]={total:0,rounds:{}};for(const e of state.data.scores||[]){if(!m[e.team_id])continue;m[e.team_id].total+=n(e.points);const round=n(e.round)||state.data.settings.active_round;m[e.team_id].rounds[round]=(m[e.team_id].rounds[round]||0)+n(e.points)}return m}
function orderedTeams(){const m=scoreMap();return [...state.data.teams].sort((a,b)=>(m[b.id]?.total||0)-(m[a.id]?.total||0)||a.sort_order-b.sort_order)}
function audienceDrawCount(round=state.data.settings.active_round){return (state.data.draws||[]).filter(d=>d.active!==false&&n(d.round)===n(round)&&!d.team_id).length}
function audienceDrawStatus(round=state.data.settings.active_round){const used=Math.min(2,audienceDrawCount(round));return {used,remaining:Math.max(0,2-used)}}
function audiencePoolAvailableCount(round=state.data.settings.active_round){if(!state.questionBankLoaded||!Array.isArray(state.questionBank))return null;return state.questionBank.filter(q=>n(q.round)===n(round)&&q.audience_only&&['available','reset'].includes(q.status)).length}
function audienceDrawIsDisabled(round=state.data.settings.active_round){const available=audiencePoolAvailableCount(round);return state.busy||audienceDrawCount(round)>=2||available===0}
function audienceDrawButtonLabel(round=state.data.settings.active_round){const used=audienceDrawCount(round),available=audiencePoolAvailableCount(round);if(used>=2)return 'Audience questions complete (2/2)';if(available===0)return 'Add audience questions first';return 'Draw audience question ('+used+'/2)'}
function audienceDrawButtonTitle(round=state.data.settings.active_round){if(audienceDrawCount(round)>=2)return 'Both audience questions for this round have been used.';if(audiencePoolAvailableCount(round)===0)return 'Add audience-only questions for this round in the Question Bank first.';return 'Draw one of the two audience-only questions for this round.'}
function activeTeam(){return state.data.teams.find(t=>t.id===state.data.settings.active_team_id)||state.data.teams[0]}
function suggestedTeamId(round=state.data.settings.active_round){
 const teams=[...(state.data.teams||[])].filter(t=>t.active!==false).sort((a,b)=>n(a.sort_order)-n(b.sort_order)||n(a.slot)-n(b.slot));
 if(!teams.length)return null;
 const limit=[3,6].includes(n(round))?2:1;
 const draws=(state.data.draws||[]).filter(d=>d.active!==false&&n(d.round)===n(round)&&d.team_id);
 const counts={};for(const d of draws)counts[d.team_id]=(counts[d.team_id]||0)+1;
 const q=state.data.current_question;
 if(q&&n(q.round)===n(round)&&q.owner_team_id&&!q.is_audience&&!draws.some(d=>d.question_id===q.id))counts[q.owner_team_id]=(counts[q.owner_team_id]||0)+1;
 if(q&&n(q.round)===n(round)&&q.owner_team_id&&!q.is_audience&&(counts[q.owner_team_id]||0)<limit)return q.owner_team_id;
 const pivot=q&&n(q.round)===n(round)&&q.owner_team_id&&!q.is_audience?q.owner_team_id:state.data.settings.active_team_id;
 let idx=teams.findIndex(t=>t.id===pivot);if(idx<0)idx=0;
 const startsAt=q&&n(q.round)===n(round)&&q.owner_team_id&&!q.is_audience?(idx+1)%teams.length:idx;
 for(let step=0;step<teams.length;step++){const team=teams[(startsAt+step)%teams.length];if((counts[team.id]||0)<limit)return team.id}
 return teams[startsAt]?.id||teams[0].id;
}
function teamCard(t,compact=false){const m=scoreMap()[t.id]||{total:0,rounds:{}};const rank=orderedTeams().findIndex(x=>x.id===t.id)+1;const active=activeTeam()?.id===t.id;const pounced=(state.data.pounces||[]).some(p=>p.team_id===t.id&&p.question_id===state.data.current_question?.id);return `<article class="card team-card ${active?'active-team':''} ${pounced?'pounced':''}"><div class="team-top"><div class="team-logo">${t.logo_url?`<img src="${esc(t.logo_url)}" alt="">`:esc((t.name||'?').slice(0,2).toUpperCase())}</div><div style="min-width:0"><div class="team-name">${esc(t.name)}</div><div class="team-school">${esc(t.school_name||'School not set')}</div></div></div><div class="team-score-row"><div><div class="score-caption">Overall points</div><div class="score-total" data-score="${m.total}">${m.total}</div></div><div style="text-align:right"><div class="score-caption">Round ${state.data.settings.active_round}</div><div class="rank">${m.rounds[state.data.settings.active_round]||0} pts · #${rank}</div></div></div>${active?'<div class="small" style="color:var(--accent);margin-top:13px;font-weight:800">● Question for this team</div>':''}</article>`}
function truthyFlag(v){return v===true||['true','1','yes','y','audience'].includes(String(v??'').trim().toLowerCase())}
function cleanOpenQuestion(value){let text=String(value??'').replace(/\r\n/g,'\n').trim();const optionBlock=/\n\s*A[.)]\s[^\n]*(?:\n\s*[B-H][.)]\s[^\n]*)+/i;if(optionBlock.test(text))text=text.replace(optionBlock,'').trim();if(/\b(which of these|which of the following|three of these|four of these|all of these|none of these|select one|choose one|choose from|select from|which option|what is the correct option)\b/i.test(text))return '';return text}
function parseQuestionSet(tag,setTag,setOrder,round){const r=Number(round);if(![3,6].includes(r))return {set_tag:null,set_order:null};const m=String(tag||'').trim().match(new RegExp('^(R'+r+'-[A-Za-z0-9_-]+)-([AB])$','i'));const value=String(setTag||m?.[1]||'').trim();const order=Number(setOrder)||(m?(m[2].toUpperCase()==='A'?1:2):null);return {set_tag:value||null,set_order:value&&[1,2].includes(order)?order:null}}
function mediaPanel(url){if(!url)return '';let raw=String(url).trim();const escaped=esc(raw);const yt=raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/i);if(yt)return '<div class="question-media-wrap"><iframe class="question-media video-embed" src="https://www.youtube-nocookie.com/embed/'+esc(yt[1])+'" title="Question media" loading="eager" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>';if(/\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(raw))return '<div class="question-media-wrap"><img class="question-media" src="'+escaped+'" alt="Question image" loading="eager"></div>';if(/\.(mp4|webm|ogv)(?:[?#].*)?$/i.test(raw))return '<div class="question-media-wrap"><video class="question-media" src="'+escaped+'" controls playsinline preload="metadata"></video></div>';if(/\.(mp3|m4a|wav|ogg)(?:[?#].*)?$/i.test(raw))return '<div class="question-media-wrap"><audio class="question-audio" src="'+escaped+'" controls preload="metadata"></audio></div>';return '<div class="question-media-link"><a class="secondary" href="'+escaped+'" target="_blank" rel="noopener">Open question media ↗</a></div>'}
function presentationTimerDock(){return `<div class="presentation-timer-dock" role="group" aria-label="Question timer controls"><span class="timer presentation-timer-readout ${state.timeLeft<=5?'urgent':''}" id="presentationTimerDisplay">${formatTime(state.timeLeft)}</span><button id="timerStartBtn" class="primary timer-action" data-action="timer-start" title="Start 10-second timer">${state.timerRunning?'Running':'Start timer'}</button><button class="secondary timer-action" data-action="timer-pause" title="Pause timer">Pause</button><button class="secondary timer-action timer-reset-action" data-action="timer-reset" title="Reset timer" aria-label="Reset timer">↺</button></div>`}
function presentationBottomControls(q){const scores=q?.is_audience?'<span class="tag score-paused-note">Audience question · team scoring paused</span>':`<div class="paddles presentation-card-paddles">${paddle('correct','✓','Correct','+10')}${paddle('wrong','×','Wrong',n(q?.round||state.data.settings.active_round)===6?'−5':'0')}</div>`;const actions=q?'<button class="secondary" data-action="read">◐ Read</button><button class="secondary answer-reveal-btn" data-action="answer" '+(state.answerRevealPending?'disabled':'')+'>'+(state.answerRevealPending?'Revealing…':state.answerVisible?'Hide answer':'Reveal answer')+'</button>':'<span class="muted small">Draw a question to begin</span>';return `<div class="presentation-question-bottom"><div class="presentation-card-score-row">${scores}</div><div class="presentation-question-toolbar"><div class="button-row question-actions presentation-question-actions">${actions}</div>${presentationTimerDock()}</div></div>`}
function answerStageHTML(q){
 if(!q||(!state.answerRevealPending&&!state.answerVisible))return '';
 if(state.answerRevealPending)return `<div class="answer-box answer-reveal-pending" data-answer-mode="pending" aria-live="polite"><div class="answer-sparkle-field" aria-hidden="true"><span>✦</span><span>✧</span><span>✦</span><span>✧</span><span>✦</span></div><div class="eyebrow answer-reveal-label">ANSWER KEY</div><div class="answer-reveal-loading">Unveiling the answer</div><div class="answer-reveal-progress"><span></span></div></div>`;
 return `<div class="answer-box ${state.answerEffect?'answer-just-revealed':''}" data-answer-mode="visible"><div class="eyebrow answer-key-label" style="color:var(--good);margin-bottom:7px">Answer key</div><div class="answer-key-text">${esc(q.answer_text||'')}</div></div>`;
}
function presentationViewKey(){
 const q=state.data.current_question;
 return JSON.stringify({
  round:n(state.data.settings.active_round),phase:state.drawPhase,tag:state.revealTag||'',audienceUsed:audienceDrawCount(n(state.data.settings.active_round)),
  busy:!!state.busy,
  sharedMedia:[state.data.settings.round3_media_url||'',state.data.settings.final_round_media_url||''],
  question:q?{id:q.id,tag:q.tag,round:n(q.round),text:q.question_text,media:q.media_url||'',set:q.set_tag||'',order:n(q.set_order),audience:!!q.is_audience,owner:q.owner_team_id||null,method:q.draw_method||''}:null,
  teams:(state.data.teams||[]).map(t=>[t.id,t.name,t.school_name,t.logo_url,t.active!==false])
 });
}
function presentationPounceControl(t,q,ownerId){
 if(!q||q.is_audience||n(state.data.settings.active_round)===6)return '';
 const pounceRecord=(state.data.pounces||[]).find(p=>p.team_id===t.id&&p.question_id===q.id);
 const pounceScore=(state.data.scores||[]).find(s=>s.team_id===t.id&&s.question_id===q.id&&['pounce-correct','pounce-wrong'].includes(s.event_type));
 if(pounceScore)return `<div class="presentation-team-pounce-actions"><span class="tag pounce-result-mark ${n(pounceScore.points)<0?'negative':'positive'}">${n(pounceScore.points)>0?'+10':'−5'} pts</span></div>`;
 if(pounceRecord?.pending)return '<div class="presentation-team-pounce-actions"><span class="tag pounce-pending-mark">Registering…</span></div>';
 if(pounceRecord)return `<div class="presentation-team-pounce-actions"><button type="button" class="secondary pounce-mark-btn" data-pounce-result="${esc(t.id)}:pounce-correct" ${isScorePending(q.id,t.id,'pounce-correct')?'disabled':''} title="Award +10 for a correct pounce">+10</button><button type="button" class="secondary pounce-mark-btn" data-pounce-result="${esc(t.id)}:pounce-wrong" ${isScorePending(q.id,t.id,'pounce-wrong')?'disabled':''} title="Deduct 5 for an incorrect pounce">−5</button></div>`;
 const canPounce=n(q.round)!==6&&n(state.data.settings.active_round)!==6&&state.drawPhase==='idle'&&!state.busy&&state.timerRunning&&state.timerPersisted&&state.timeLeft>0&&t.id!==ownerId;
 const why=!q?'Draw a question first':t.id===ownerId?'Question owner cannot pounce':!state.timerRunning?'Start the 10-second timer to enable pounce':state.timeLeft<=0?'Time is up':!state.timerPersisted?'Syncing timer…':'Register pounce for '+(t.name||'team');
 return `<button type="button" class="presentation-pounce-btn" data-present-pounce="${esc(t.id)}" ${canPounce?'':'disabled'} title="${esc(why)}">↗ Pounce</button>`;
}
function presentationTeamRowHTML(t,i,q,scores){
 const s=scores[t.id]||{total:0,rounds:{}};
 const ownerId=q?.owner_team_id||state.data.settings.active_team_id;
 const delta=state.scoreEffect?.teamId===t.id?state.scoreEffect.delta:null;
 return `<div class="presentation-team ${activeTeam()?.id===t.id?'active-team':''} ${delta!==null?'score-impact '+(delta<0?'score-loss':'score-gain'):''} ${state.pounceEffectTeamId===t.id?'pounce-confirm':''}" data-team-id="${esc(t.id)}"><span class="leader-rank">${i+1}</span><div class="presentation-team-detail"><div class="presentation-team-head"><span class="presentation-team-tag">TEAM ${String(i+1).padStart(2,'0')}</span><div class="mini-name">${esc(t.name)}</div></div><div class="small muted">${esc(roundNames[state.data.settings.active_round]||'Round '+state.data.settings.active_round)}: ${s.rounds[state.data.settings.active_round]||0}</div></div><div class="mini-score" data-value="${s.total}">${s.total}${delta!==null?`<span class="score-delta ${delta<0?'negative':'positive'}">${delta>0?'+':''}${delta}</span>`:''}</div><div class="presentation-team-pounce-slot">${presentationPounceControl(t,q,ownerId)}</div></div>`;
}
function questionPanel(presentation=false){const q=state.data.current_question;const mediaUrl=q?.media_url||(q?.round===3?state.data.settings.round3_media_url:q?.round===6?state.data.settings.final_round_media_url:null);const owner=q?.is_audience?null:state.data.teams.find(t=>t.id===(q?.owner_team_id||state.data.settings.active_team_id));const finalPair=[3,6].includes(n(q?.round))&&q?.set_tag;return `<section class="card question-card ${presentation?'presentation-question':''}">${q?`<div class="question-meta"><span class="tag">TAG · ${esc(q.tag)}</span><span class="tag">ROUND ${q.round} · ${esc(roundNames[q.round]||'Quiz')}</span>${q.is_audience?'<span class="tag audience-question-tag">AUDIENCE QUESTION</span>':`<span class="tag">${esc(q.draw_method==='chit'?'Physical chit':'Random draw')}</span>`}${finalPair?`<span class="tag final-set-tag">SET ${esc(q.set_tag)} · QUESTION ${n(q.set_order)}/2</span>`:''}${owner?`<span class="tag">For ${esc(owner.name)}</span>`:''}</div><div class="question-prompt-area ${presentation?'presentation-question-prompt':''}"><div class="question-text" id="questionText">${esc(q.question_text)}</div>${mediaUrl?mediaPanel(mediaUrl):q.is_audience?'':q.round===3?'<div class="media-setup-note">Add an image or video URL to this question or set the shared Round 3 media in Admin Controls.</div>':q.round===6&&finalPair?'<div class="media-setup-note">Add an audio/video URL to this question or set the fallback in Admin Controls.</div>':''}</div>${answerStageHTML(q)}${presentation?'':`<div class="button-row question-actions" style="margin-top:18px"><button class="secondary" data-action="read">◐ Read question</button><button class="secondary" data-action="answer">${state.answerVisible?'Hide':'Reveal'} answer</button>${presentation?'':`<div class="question-inline-timer" style="margin-left:auto;text-align:right"><div class="score-caption">Time remaining</div><div class="timer ${state.timeLeft<=5?'urgent':''}" id="timerDisplay">${formatTime(state.timeLeft)}</div></div>`}</div>`}`:`<div class="question-empty"><div><div class="brand-mark" style="margin:0 auto 18px;width:54px;height:54px">Q!</div><strong>Ready when you are.</strong>Draw a question to bring the arena to life.</div></div>`}${presentation?presentationBottomControls(q):''}</section>`}
function roundSelector(){return `<div class="round-row">${rounds.map(r=>`<button class="round-chip ${r===n(state.data.settings.active_round)?'active':''}" data-round="${r}" title="${roundNames[r]}">R${r} · ${roundNames[r]}</button>`).join('')}</div>`}
/* obsolete question panel removed: current panel supports round labels, shared media and a single timer */
function formatTime(s){return `${Math.floor(Math.max(0,s)/60).toString().padStart(2,'0')}:${(Math.max(0,s)%60).toString().padStart(2,'0')}`}
function homePage(){
  const q=state.data.current_question;
  const scores=scoreMap();
  const currentOwner=state.data.teams.find(t=>t.id===q?.owner_team_id);
  const standings=orderedTeams();
  return '<div class="home-page-content">'+
    '<div class="page-heading home-heading"><div><div class="eyebrow">EGS QUIZIT! / LIVE ARENA</div><h1>Live question & standings</h1></div><span class="status-pill"><span class="dot"></span>'+(q?'Question live':'Waiting for question')+'</span></div>'+
    '<div class="home-live-layout">'+
      '<section class="card live-question-card '+(state.homeQuestionChanged?'question-reveal-active':'')+'" aria-live="polite">'+
        (q?
          '<div class="live-question-meta"><div><div class="eyebrow">CURRENT QUESTION</div><div class="question-meta"><span class="tag">ROUND '+esc(q.round)+'</span><span class="tag">TAG · '+esc(q.tag)+'</span>'+(q.is_audience?'<span class="tag audience-question-tag">AUDIENCE QUESTION</span>':'')+(q.draw_method?'<span class="tag">'+esc(q.draw_method==='chit'?'Physical chit':'Random draw')+'</span>':'')+'</div></div>'+(currentOwner?'<span class="tag owner-tag">For '+esc(currentOwner.name)+'</span>':'')+'</div>'+
          '<div class="live-question-content"><div class="question-copy"><h2>'+esc(q.question_text)+'</h2>'+mediaPanel(q.media_url||(q.round===3?state.data.settings.round3_media_url:q.round===6?state.data.settings.final_round_media_url:null))+'</div>'+
          (String(q.answer_text||'').trim()?'<div class="answer-box live-answer"><div class="eyebrow">ANSWER</div><div class="answer-text">'+esc(q.answer_text)+'</div></div>':'<div class="answer-waiting"><div class="eyebrow">ANSWER</div><p>The answer is not available yet.</p></div>')+'</div>'
          :
          '<div class="question-empty"><div><div class="brand-mark" style="margin:0 auto 14px;width:48px;height:48px">Q!</div><strong>No live question yet</strong>The current question and answer will appear here as soon as the operator draws one.</div></div>'
        )+
      '</section>'+
      '<aside class="card home-standings-card"><div class="home-standings-heading"><div><div class="eyebrow">LIVE SCOREBOARD</div><h2>Standings</h2></div><span class="tag">'+standings.length+' teams</span></div>'+
        '<div class="home-standings-grid">'+standings.map((t,i)=>'<div class="home-standing-row '+(currentOwner?.id===t.id?'standing-active':'')+'"><span class="home-standing-rank">'+(i+1)+'</span><div class="home-standing-info"><strong>'+esc(t.name)+'</strong><span>'+esc(t.school_name||'')+'</span></div><div class="home-standing-score '+(state.scoreEffect?.teamId===t.id?'score-pop':'')+'">'+(scores[t.id]?.total||0)+(state.scoreEffect?.teamId===t.id?'<span class="score-delta '+(state.scoreEffect.delta<0?'negative':'positive')+'">'+(state.scoreEffect.delta>0?'+':'')+state.scoreEffect.delta+'</span>':'')+'</div></div>').join('')+'</div>'+
        '<div class="home-standings-foot"><span class="dot"></span> Scores update automatically</div>'+
      '</aside>'+
    '</div>'+
  '</div>';
}
function activityList(limit=10){const events=[...(state.data.draws||[]).map(x=>({...x,kind:'draw',time:x.drawn_at,title:x.team_id?`Question ${x.tag} drawn`:`Audience question ${x.tag} drawn`,detail:`R${x.round} · ${roundNames[x.round]||'Quiz'} · ${x.team_id?(x.method==='chit'?'Physical chit':'Random draw'):'Audience draw'}`})),...(state.data.scores||[]).map(x=>({...x,kind:'score',time:x.created_at,title:`${x.event_type||'Score'} · ${x.points>0?'+':''}${x.points}`,detail:`${state.data.teams.find(t=>t.id===x.team_id)?.name||'Team'} · ${x.reason||'Score event'}`}))].sort((a,b)=>new Date(b.time||0)-new Date(a.time||0)).slice(0,limit);return events.length?`<div class="history-list">${events.map(e=>`<div class="history-item"><div><div class="history-title">${esc(e.title)}</div><div class="history-detail">${esc(e.detail)}</div></div><span class="small muted">${e.time?new Date(e.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span></div>`).join('')}</div>`:'<div class="empty-state">No activity yet. Every event will appear here.</div>'}
function quizPage(){const settings=state.data.settings;return `<div class="page-heading"><div><div class="eyebrow">Operator workspace</div><h1>Live quiz</h1><p>Draw fairly, keep the pace, and record every call.</p></div><button class="primary" id="presentFromQuiz">▣ Presentation mode</button></div><div class="panel-stack"><section class="card section-card"><div class="section-title"><h2>1 · Select the round</h2><span class="muted small">Active pool only</span></div>${roundSelector()}<div class="operator-controls"><input class="field" id="tagInput" placeholder="Enter physical chit tag (e.g. R2-014)" value="${esc(state.tag)}" aria-label="Physical chit tag"><button class="secondary" data-action="chit" ${state.busy?'disabled':''}>Reveal tag</button><button class="primary" data-action="draw" ${state.busy?'disabled':''}>${state.busy?'Selecting…':'✦ Draw team question'}</button><button class="secondary audience-draw-button" data-action="draw-audience" ${audienceDrawIsDisabled(n(state.data.settings.active_round))?'disabled':''} title="${esc(audienceDrawButtonTitle(n(state.data.settings.active_round)))}">${esc(audienceDrawButtonLabel(n(state.data.settings.active_round)))}</button></div><div id="drawFeedback" class="small muted" style="margin-top:10px">${state.busy?'Selecting a question fairly…':'Physical chit or random draw. Used questions are skipped.'}</div></section><div class="dashboard-layout"><div class="panel-stack"><section class="card section-card"><div class="section-title"><h2>2 · Question stage</h2><span class="status-pill">${state.data.current_question?'Question loaded':'Waiting for draw'}</span></div>${questionPanel()}<div class="button-row" style="margin-top:16px"><button class="secondary" data-action="timer-start">▶ Start timer</button><button class="secondary" data-action="timer-pause">Ⅱ Pause</button><button class="secondary" data-action="timer-reset">↺ Reset</button><button class="secondary" data-action="next-team">Next →</button><label class="muted small" style="display:flex;align-items:center;gap:7px">Seconds <input id="durationInput" class="field" type="number" min="5" max="600" value="${settings.timer_seconds||30}" style="width:84px;padding:8px"></label></div></section><section class="card section-card"><div class="section-title"><h2>3 · Score paddles</h2><span class="muted small">Selected team: ${esc((state.data.teams.find(t=>t.id===state.data.current_question?.owner_team_id)||activeTeam())?.name||'None')}</span></div><div class="paddles">${paddle('correct','✓','Correct answer','+10')}${paddle('wrong','×','Wrong answer','0')}${paddle('pounce','↗','Register pounce','TEAM')}${paddle('pounce-correct','✓','Pounce correct','+10')}${paddle('pounce-wrong','×','Pounce incorrect','−5')}</div><div class="notice" style="margin-top:12px">Scoring is restricted to the question owner for regular marks. Pounce results only apply to a team that registered a pounce. A question can only be scored once unless corrected by an admin.</div></section></div><aside class="panel-stack"><section class="card section-card"><div class="section-title"><h2>Draw history</h2><span class="muted small">Recent</span></div>${activityList(8)}</section><section class="card section-card"><div class="section-title"><h2>Pounce board</h2><span class="tag">Current question</span></div>${pounceBoard()}</section></aside></div></div>`}
function paddle(id,icon,label,value){const q=state.data.current_question;const team=state.data.teams.find(t=>t.id===(q?.owner_team_id||state.data.settings.active_team_id));const pending=!!q&&isScorePending(q.id,team?.id,id);return `<button class="paddle ${state.selectedPaddle===id?'selected':''}" data-paddle="${id}" ${( !q||pending)?'disabled':''}><span style="font-size:20px">${icon}</span><span>${label}<br><span class="paddle-value">${value}</span></span></button>`}
function pounceBoard(){const q=state.data.current_question;const ps=(state.data.pounces||[]).filter(p=>p.question_id===q?.id);return ps.length?`<div class="history-list">${ps.map(p=>`<div class="history-item"><div><div class="history-title">${esc(state.data.teams.find(t=>t.id===p.team_id)?.name||'Team')}</div><div class="history-detail">Pounce registered</div></div><span class="positive">● Registered</span></div>`).join('')}</div>`:'<div class="empty-state">No pounces recorded for this question.</div>'}
function statsPage(){const scores=scoreMap(),teams=orderedTeams(),events=state.data.scores||[],draws=state.data.draws||[];const total=events.reduce((s,e)=>s+n(e.points),0);const positive=events.filter(e=>n(e.points)>0).length;const negative=events.filter(e=>n(e.points)<0).length;const pEvents=events.filter(e=>String(e.event_type).startsWith('pounce'));const roundsData=rounds.map(r=>({r,score:events.filter(e=>n(e.round)===r).reduce((s,e)=>s+n(e.points),0),draws:draws.filter(d=>n(d.round)===r).length}));return `<div class="page-heading"><div><div class="eyebrow">Event intelligence</div><h1>Stats & history</h1><p>Every point, every round, every pounce. No mystery arithmetic.</p></div><div class="button-row"><button class="secondary" data-action="export-scores">Export scores CSV</button><button class="secondary" data-action="export-history">Export history CSV</button></div></div><div class="grid stat-grid"><div class="card stat-card"><div class="stat-label">Total points awarded</div><div class="stat-number">${total}</div><div class="small muted">Net across all teams</div></div><div class="card stat-card"><div class="stat-label">Scoring events</div><div class="stat-number">${events.length}</div><div class="small muted">${positive} positive · ${negative} negative</div></div><div class="card stat-card"><div class="stat-label">Questions drawn</div><div class="stat-number">${draws.length}</div><div class="small muted">Six-round event</div></div><div class="card stat-card"><div class="stat-label">Pounce attempts</div><div class="stat-number">${pEvents.length}</div><div class="small muted">Correct and incorrect results</div></div></div><div class="dashboard-layout"><div class="panel-stack"><section class="card section-card"><div class="section-title"><h2>Overall leaderboard</h2><span class="muted small">Ranked by total points</span></div>${teams.map((t,i)=>`<div class="leaderboard-row"><div class="leader-rank">${String(i+1).padStart(2,'0')}</div><div><strong>${esc(t.name)}</strong><div class="small muted">${esc(t.school_name||'')}</div></div><div class="small muted">Round ${state.data.settings.active_round}: ${scores[t.id]?.rounds[state.data.settings.active_round]||0}</div><strong>${scores[t.id]?.total||0}</strong></div>`).join('')}</section><section class="card section-card"><div class="section-title"><h2>Round performance</h2><span class="muted small">Points from scored questions</span></div><div class="grid" style="gap:12px">${roundsData.map(x=>`<div><div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:6px"><strong>R${x.r} · ${roundNames[x.r]}</strong><span class="muted">${x.score} pts · ${x.draws} draws</span></div><div style="height:8px;border-radius:99px;background:var(--surface2);overflow:hidden"><div style="height:100%;width:${Math.min(100,Math.max(0,x.score/Math.max(1,...roundsData.map(y=>y.score))*100))}%;background:var(--accent);border-radius:99px"></div></div></div>`).join('')}</div></section><section class="card section-card"><div class="section-title"><h2>Score history</h2><span class="muted small">Audit trail</span></div>${events.length?`<div class="table-wrap"><table><thead><tr><th>Time</th><th>Team</th><th>Event</th><th>Points</th><th>Reason</th></tr></thead><tbody>${[...events].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(e=>`<tr><td>${e.created_at?new Date(e.created_at).toLocaleString():''}</td><td>${esc(state.data.teams.find(t=>t.id===e.team_id)?.name||'—')}</td><td>${esc(e.event_type)}</td><td class="${n(e.points)<0?'negative':'positive'}">${n(e.points)>0?'+':''}${e.points}</td><td>${esc(e.reason||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">No score events yet.</div>'}</section></div><aside class="panel-stack"><section class="card section-card"><div class="section-title"><h2>Draw history</h2><span class="muted small">${draws.length} total</span></div>${activityList(15)}</section><section class="card section-card"><div class="section-title"><h2>Event exports</h2></div><div class="panel-stack"><button class="secondary" data-action="export-teams">Team summary CSV</button><button class="secondary" data-action="export-draws">Question history CSV</button><button class="secondary" data-action="export-events">Marks history CSV</button></div></section></aside></div>`}
function adminPage(){return `<div class="page-heading"><div><div class="eyebrow">SETUP & GOVERNANCE</div><h1>Admin controls</h1><p>Manage teams, questions, scoring, and the arena's visual identity.</p></div><span class="status-pill">Protected actions</span></div><section class="card section-card admin-presentation-card"><div class="admin-presentation-symbol">▣</div><div class="admin-presentation-copy"><div class="eyebrow">LIVE EVENT</div><h2>Presentation mode</h2><p class="muted">Open the projector-ready scoreboard and audience screen from this admin workspace.</p></div><button class="primary" id="adminPresentBtn">Open presentation&nbsp; ↗</button></section><div class="notice" style="margin-bottom:18px">Admin actions are protected. Visitors can view the live question and change their theme; only the project owner or an admin collaborator can edit teams, questions, and event settings. <a href="/admin-access" class="primary admin-signin-inline">Sign in to administer ↗</a></div><div class="dashboard-layout"><div class="panel-stack"><section class="card section-card"><div class="section-title"><h2>Team setup</h2><span class="muted small">${state.data.teams.length} teams</span></div><div class="panel-stack">${state.data.teams.map(t=>`<div class="history-item"><div class="team-top"><div class="team-logo">${t.logo_url?`<img src="${esc(t.logo_url)}" alt="">`:esc((t.name||'?').slice(0,2).toUpperCase())}</div><div><div class="history-title">${esc(t.name)}</div><div class="history-detail">${esc(t.school_name||'School not set')}</div></div></div><button class="secondary" data-edit-team="${t.id}">Edit</button></div>`).join('')}<button class="primary" data-action="add-team">+ Add team</button></div></section><section class="card section-card"><div class="section-title"><h2>Question bank</h2><span class="muted small">Search, add, or import</span></div><div class="form-grid"><div class="form-field full"><label class="field-label" for="qSearch">Search by tag or question</label><input id="qSearch" class="field" placeholder="Search the question bank"></div><div class="form-field"><label class="field-label" for="qRoundFilter">Round</label><select id="qRoundFilter" class="field"><option value="all">All rounds</option>${rounds.map(r=>`<option value="${r}">R${r} · ${roundNames[r]}</option>`).join('')}</select></div><div class="form-field"><label class="field-label" for="qTypeFilter">Question pool</label><select id="qTypeFilter" class="field"><option value="all">Team + Audience</option><option value="team">Team questions</option><option value="audience">Audience-only questions</option></select></div><div class="form-field"><label class="field-label">Bulk CSV import</label><input id="csvFile" type="file" accept=".csv,text/csv" class="field"></div></div><div class="button-row" style="margin-top:12px"><button class="primary" data-action="add-question">+ Add team question</button><button class="secondary" data-action="add-audience-question">+ Audience question</button><button class="secondary" data-action="add-media-pair">+ Add image/video pair</button><button class="secondary" data-action="import-csv">Import CSV</button><button class="secondary" data-action="export-questions">Export CSV</button></div><div id="questionBank" style="margin-top:18px">Loading question bank…</div></section></div><aside class="panel-stack"><section class="card section-card"><div class="section-title"><h2>Scoring rules</h2></div><div class="form-grid"><div class="form-field"><label class="field-label" for="correctPoints">Correct answer</label><input id="correctPoints" type="number" class="field" value="10" readonly disabled></div><div class="form-field"><label class="field-label" for="wrongPoints">Wrong answer · Rounds 1–5</label><input id="wrongPoints" type="number" class="field" value="0" readonly disabled></div><div class="form-field"><label class="field-label" for="pounceCorrect">Pounce correct</label><input id="pounceCorrect" type="number" class="field" value="10" readonly disabled></div><div class="form-field"><label class="field-label" for="pounceWrong">Pounce incorrect</label><input id="pounceWrong" type="number" class="field" value="-5" readonly disabled></div><div class="form-field"><label class="field-label" for="defaultDuration">Question timer</label><input id="defaultDuration" type="number" class="field" value="10" readonly disabled></div><div class="form-field"><label class="field-label" for="themeSelect">Appearance</label><select id="themeSelect" class="field">${themes.map(([v,l])=>`<option value="${v}" ${v===(state.selectedTheme||state.data.settings.theme)?'selected':''}>${l}</option>`).join('')}</select></div><div class="form-field full"><label class="field-label" for="round3MediaUrl">Round 3 shared image/video URL</label><input id="round3MediaUrl" class="field" type="url" value="${esc(state.data.settings.round3_media_url||'')}" placeholder="https://…"></div><div class="form-field full"><label class="field-label" for="finalMediaUrl">Final round audio/video URL (fallback)</label><input id="finalMediaUrl" class="field" type="url" value="${esc(state.data.settings.final_round_media_url||'')}" placeholder="https://…"></div></div><p class="small muted" style="margin-top:12px;line-height:1.5">Scoring is fixed to the rule sheet: correct +10; wrong 0 in Rounds 1–5 and −5 in the final round; pounce +10/−5, available only during the ten-second timer in Rounds 1–5.</p><button class="primary" style="margin-top:15px" data-action="save-settings">Save settings</button></section><section class="card section-card"><div class="section-title"><h2>Event tools</h2></div><div class="panel-stack"><button class="secondary" data-action="reset-draws">Reset draw eligibility</button><button class="secondary danger" data-action="reset-scores">Reset all scores…</button><button class="secondary" data-action="export-audit">Export audit log</button></div><p class="small muted" style="margin-top:14px">Draw and score history are retained as an audit trail. Resetting eligibility does not erase history.</p></section></aside></div>`}
function adminAccessPrompt(){const signedIn=!!state.adminSession?.signedIn;const isAdmin=!!state.adminSession?.isAdmin;const title=isAdmin?'Admin access confirmed':'Admin sign in required';const message=isAdmin?'Your account is approved for event administration.':signedIn?'The account '+esc(state.adminSession?.email||'you signed in with')+' is not on the admin allowlist.':'Sign in with the approved administrator email to manage teams, questions, scoring and presentation mode.';return `<div class="page-heading"><div><div class="eyebrow">SETUP & GOVERNANCE</div><h1>${title}</h1><p>${message}</p></div></div><section class="card section-card" style="max-width:640px"><div class="admin-presentation-symbol">🔒</div><h2>Administrator controls are protected</h2><p class="muted" style="line-height:1.65;margin:10px 0 20px">Visitors can keep viewing the live question and change the colour theme without signing in. Only the approved admin email can edit teams, update the question bank, change scoring rules or launch presentation mode.</p><div class="button-row"><a class="primary" style="text-decoration:none" href="${signedIn?'/admin-access':'/login?next=%2Fadmin-access'}">${signedIn?'Manage sign-in':'Sign in with email'} ↗</a><button class="secondary" data-page="home">Return to live question</button></div></section>`}
function render(){const main=$('#main');if(state.loading){main.innerHTML='<div class="loading-line"></div><div class="empty-state">Preparing the arena…</div>';return}document.querySelectorAll('#nav [data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));if(state.page==='admin'&&!state.adminSession){main.innerHTML='<div class="loading-line"></div><div class="empty-state">Checking administrator access…</div>';if(!state.checkingAdmin){state.checkingAdmin=true;request('/admin/session').then(result=>{state.adminSession=result;state.checkingAdmin=false;if(state.page==='admin')render()}).catch(error=>{state.adminSession={signedIn:false,isAdmin:false,error:error.message};state.checkingAdmin=false;if(state.page==='admin')render()})}return}if(state.page==='admin'&&!state.adminSession.isAdmin){main.innerHTML=adminAccessPrompt();return}main.innerHTML=state.page==='home'?homePage():state.page==='stats'?statsPage():adminPage();if(state.page==='admin'){loadQuestionBank();bindAdminSearch();const p=$('#adminPresentBtn');if(p)p.onclick=()=>{state.presentation=true;state.presentationEntering=true;state.showMore=false;renderPresentation()}}if(state.page==='home')state.homeQuestionChanged=false;if(state.pageEntering){main.classList.remove('page-enter');void main.offsetWidth;main.classList.add('page-enter');state.pageEntering=false;setTimeout(()=>main.classList.remove('page-enter'),720)}requestAnimationFrame(fitQuestionText);if(state.presentation)syncPresentationLive();else if(state.scoreEffect)state.scoreEffect=null}
function navigate(page){state.page=page;state.pageEntering=true;if(page==='admin'){state.adminSession=null;state.checkingAdmin=false}$('#nav').classList.remove('open');render()}
function drawStagePanel(){
  const manual=state.drawMethod==='chit';const audience=!!state.drawAudience;
  const round=n(state.data.settings.active_round)||1;
  const reelTag=()=>`R${round}-`+String(1+Math.floor(Math.random()*1000)).padStart(4,'0');
  const reelLeft=esc(reelTag()),reelRight=esc(reelTag());
  const visibleTag=manual?esc(state.tag||'TAG RECEIVED'):'R'+round+' · <span class="rolling-slots"><i>?</i><i>?</i><i>?</i></span>';
  return '<section class="card draw-stage-card is-shuffling" aria-live="polite">'+
    '<div class="draw-stage-kicker"><span class="draw-live-dot"></span>'+(audience?'AUDIENCE QUESTION DRAW':manual?'PHYSICAL CHIT VERIFICATION':'RANDOM QUESTION DRAW')+'</div>'+
    '<h2>'+(audience?'Choosing an audience question':manual?'Verifying the question tag':'Finding your next question')+'</h2>'+
    '<p>'+(audience?'This is one of the two audience questions for '+esc(roundNames[round])+'.':manual?'Checking that this tag is available in '+esc(roundNames[round])+'.':'Selecting an unused question from '+esc(roundNames[round])+'.')+'</p>'+
    '<div class="tag-reel '+(manual?'tag-reel-manual':'tag-reel-random')+'">'+
      '<span class="tag-ghost tag-ghost-left">'+(manual?'CHIT · '+esc(state.tag||'VERIFY'):reelLeft)+'</span>'+
      '<div class="tag-ticket"><span>QUESTION TAG</span><strong>'+visibleTag+'</strong><small>'+(manual?'VERIFYING TAG':'ROUND '+round+' · '+esc(roundNames[round]))+'</small></div>'+
      '<span class="tag-ghost tag-ghost-right">'+(manual?'CHECKING · '+round:reelRight)+'</span>'+
    '</div>'+
    '<div class="draw-progress"><span></span></div>'+
    '<div class="draw-stage-foot"><span class="spinner-ring"></span>'+(manual?'Checking tag availability…':'Shuffling available question tags…')+'</div>'+
  '</section>';
}
function revealQuestionPanel(){
  const tag=state.revealTag||state.data.current_question?.tag||'Selected';
  const q=state.data.current_question;
  return '<section class="question-reveal-shell reveal-sequence" aria-live="polite">'+
    '<div class="reveal-stage-kicker"><span class="reveal-stage-pulse"></span> QUESTION LOCKED · ROUND '+esc(q?.round||state.data.settings.active_round)+'</div>'+
    '<div class="selected-tag-ticket"><span class="selected-tag-check">✓</span><span class="selected-tag-copy"><small>QUESTION TAG SELECTED</small><strong>'+esc(tag)+'</strong></span><span class="selected-tag-state">Ready</span></div>'+
    '<div class="reveal-card-frame">'+questionPanel(true)+'</div>'+
    '<div class="reveal-stage-foot"><span>EGS QUIZIT!</span><span class="reveal-stage-line"></span><span>QUESTION REVEALED</span></div>'+
  '</section>';
}

function renderPresentation(){
 document.documentElement.classList.add('presentation-open');document.body.classList.add('presentation-open');
 const q=state.data.current_question;
 const owner=state.data.teams.find(t=>t.id===(q?.owner_team_id||state.data.settings.active_team_id));
 const totals=scoreMap();
 $('#overlay').innerHTML=`<div class="presentation ${state.presentationEntering?'presentation-entering':''}"><div class="presentation-header"><div class="presentation-brand-block"><div class="brand brand-logos"><img class="brand-quizit-logo" src="/assets/egs-quizit-logo.webp" alt="EGS Quizit!" width="128" height="38"><span class="brand-logo-divider" aria-hidden="true"></span><img class="brand-school-logo" src="/assets/espee-global-logo.webp" alt="The Espee Global School, Roorkee" width="96" height="32"></div><div class="brand-sub presentation-round-label">Inter-school Quiz Arena · R${state.data.settings.active_round} · ${roundNames[state.data.settings.active_round]}</div></div><div class="button-row presentation-header-actions"><span class="status-pill"><span class="dot"></span>Live scoreboard</span><span class="presentation-header-spacer" aria-hidden="true"></span><button class="secondary" data-action="exit-presentation">✕ Exit</button></div></div><div class="presentation-body">${state.drawPhase==='selecting'?drawStagePanel():state.drawPhase==='revealing'?revealQuestionPanel():questionPanel(true)}<aside class="card presentation-scores"><div class="section-title"><h2>Live scores</h2><span class="tag">${state.data.teams.length} teams</span></div><div class="presentation-team-list">${orderedTeams().map((t,i)=>presentationTeamRowHTML(t,i,q,totals)).join('')}</div></aside></div><div class="presentation-footer"><div class="presentation-footer-status"><span class="tag">${q?'NOW · '+esc(q.tag):'READY TO DRAW'}</span><span class="next-team-indicator">NEXT · ${esc(state.data.teams.find(t=>t.id===(state.manualTeamOverride||suggestedTeamId(n(state.data.settings.active_round))))?.name||'Team')}</span><span class="muted small">${q?.is_audience?'Audience question':owner?'Current: '+esc(owner.name):'No team assigned'}</span></div><div class="button-row presentation-bottom-actions">${[3,6].includes(n(state.data.settings.active_round))&&q&&n(q.round)===n(state.data.settings.active_round)&&q.set_tag&&n(q.set_order)===1?'<button class="primary" data-action="present-paired" '+(state.busy||state.drawPhase!=='idle'?'disabled':'')+'>Reveal paired question</button>':'<button class="primary" data-action="draw" '+(state.busy||state.drawPhase==='revealing'?'disabled':'')+'>'+(state.busy?'Selecting…':state.drawPhase==='revealing'?'Revealing…':n(state.data.settings.active_round)===6?'✦ Draw random slip':'✦ Draw question')+'</button>'}<button class="secondary more-menu-trigger" data-action="present-more" aria-label="More quiz options" title="More quiz options">⋯ More</button></div></div>${presentationMoreMenuHTML()}</div>`;
 state.presentationEntering=false;
 state.presentationKey=presentationViewKey();
 document.querySelectorAll('.presentation-team').forEach(row=>{
  const t=state.data.teams.find(team=>team.id===row.dataset.teamId);
  const slot=row.querySelector('.presentation-team-pounce-slot');
  if(t&&slot)slot.dataset.renderedControl=presentationPounceControl(t,q,q?.owner_team_id||state.data.settings.active_team_id);
 });
 if(state.scoreEffect)state.scoreEffect=null;
 if(state.pounceEffectTeamId)state.pounceEffectTeamId=null;
 requestAnimationFrame(fitQuestionText);
}
function restartNodeAnimation(node,className){
 if(!node)return;
 node.classList.remove(className);
 void node.offsetWidth;
 node.classList.add(className);
}
function syncPresentationAnswer(){
 const q=state.data.current_question;
 if(!q)return;
 const mode=state.answerRevealPending?'pending':state.answerVisible?'visible':'';
 const card=document.querySelector('.presentation-question');
 if(!card)return;
 const existing=card.querySelector('.answer-box');
 const existingMode=existing?.dataset.answerMode||'';
 const answerModeChanged=existingMode!==mode;
 if(answerModeChanged){
  if(existing)existing.remove();
  if(mode){
   const anchor=card.querySelector('.presentation-question-prompt');
   if(anchor)anchor.insertAdjacentHTML('afterend',answerStageHTML(q));
  }
 }else if(mode==='visible'){
  const text=existing.querySelector('.answer-key-text');
  if(text&&text.textContent!==(q.answer_text||''))text.textContent=q.answer_text||'';
 }
 const button=card.querySelector('.answer-reveal-btn');
 if(button){button.textContent=state.answerRevealPending?'Revealing…':state.answerVisible?'Hide answer':'Reveal answer';button.disabled=!!state.answerRevealPending}
 if(state.answerEffect&&mode==='visible'&&answerModeChanged){const answerBox=card.querySelector('.answer-box');restartNodeAnimation(answerBox,'answer-just-revealed');const token=String(Date.now());if(answerBox){answerBox.dataset.answerMotion=token;setTimeout(()=>{if(answerBox.isConnected&&answerBox.dataset.answerMotion===token){answerBox.classList.remove('answer-just-revealed');state.answerEffect=false}},1400)}}
}
function syncPresentationPounceAvailability(){
 if(!state.presentation)return;
 const q=state.data.current_question;
 const ownerId=q?.owner_team_id||state.data.settings.active_team_id;
 document.querySelectorAll('.presentation-team[data-team-id]').forEach(row=>{
  const t=state.data.teams.find(team=>team.id===row.dataset.teamId);const button=row.querySelector('.presentation-pounce-btn');
  if(!t||!button)return;
  const registered=(state.data.pounces||[]).some(x=>x.question_id===q?.id&&x.team_id===t.id);
  const enabled=!!q&&!q.is_audience&&n(q.round)!==6&&n(state.data.settings.active_round)!==6&&state.drawPhase==='idle'&&!state.busy&&state.timerRunning&&state.timerPersisted&&state.timeLeft>0&&t.id!==ownerId&&!registered;
  button.disabled=!enabled;
  button.title=!q?'Draw a question first':q.is_audience?'Audience questions do not allow pounces':n(state.data.settings.active_round)===6?'Pounce is disabled in the final round':t.id===ownerId?'Question owner cannot pounce':registered?'Pounce already registered':!state.timerRunning?'Start the 10-second timer to enable pounce':state.timeLeft<=0?'Time is up':!state.timerPersisted?'Syncing timer…':'Register pounce for '+t.name;
 });
}
function syncPresentationScoreboard(){
 const list=document.querySelector('.presentation-team-list');
 if(!list)return;
 const q=state.data.current_question, ownerId=q?.owner_team_id||state.data.settings.active_team_id;
 const totals=scoreMap(),ordered=orderedTeams();
 const before=new Map([...list.querySelectorAll('.presentation-team[data-team-id]')].map(row=>[row.dataset.teamId,row.getBoundingClientRect().top]));
 const rows=new Map([...list.querySelectorAll('.presentation-team[data-team-id]')].map(row=>[row.dataset.teamId,row]));
 for(const t of ordered)if(!rows.has(t.id)){renderPresentation();return}
 for(let i=0;i<ordered.length;i++){
  const t=ordered[i],row=rows.get(t.id),s=totals[t.id]||{total:0,rounds:{}};
  row.style.order=String(i);
  const oldRank=row.querySelector('.leader-rank');if(oldRank&&oldRank.textContent!==String(i+1))oldRank.textContent=String(i+1);
  const badge=row.querySelector('.presentation-team-tag'),badgeText='TEAM '+String(i+1).padStart(2,'0');if(badge&&badge.textContent!==badgeText)badge.textContent=badgeText;
  const name=row.querySelector('.mini-name');if(name&&name.textContent!==(t.name||''))name.textContent=t.name||'';
  const roundScore=row.querySelector('.presentation-team-detail .small');const roundText=(roundNames[state.data.settings.active_round]||'Round '+state.data.settings.active_round)+': '+(s.rounds[state.data.settings.active_round]||0);if(roundScore&&roundScore.textContent!==roundText)roundScore.textContent=roundText;
  const score=row.querySelector('.mini-score');const previous=Number(score?.dataset.value??score?.textContent??0);const now=Number(s.total)||0;
  const changedValue=previous!==now;
  const explicitEffect=state.scoreEffect?.teamId===t.id?state.scoreEffect:null;
  const effect=explicitEffect||(changedValue?{delta:now-previous}:null);
  if(score&&(changedValue||explicitEffect)){
   score.textContent=String(now);score.dataset.value=String(now);
   if(effect){const delta=document.createElement('span');delta.className='score-delta '+(effect.delta<0?'negative':'positive');delta.textContent=(effect.delta>0?'+':'')+effect.delta;score.appendChild(delta)}
   row.classList.toggle('score-gain',n(effect?.delta)>=0&&!!effect);row.classList.toggle('score-loss',n(effect?.delta)<0&&!!effect);
   if(effect){restartNodeAnimation(row,'score-impact');restartNodeAnimation(score,'score-number-pop');const token=String(Date.now())+':'+t.id;row.dataset.scoreMotion=token;setTimeout(()=>{if(row.isConnected&&row.dataset.scoreMotion===token){row.classList.remove('score-impact','score-gain','score-loss');row.querySelector('.mini-score .score-delta')?.remove()}},1300)}
  }else if(score)score.dataset.value=String(now);
  row.classList.toggle('active-team',activeTeam()?.id===t.id);
  if(state.pounceEffectTeamId===t.id){restartNodeAnimation(row,'pounce-confirm');const token=String(Date.now())+':'+t.id;row.dataset.pounceMotion=token;setTimeout(()=>{if(row.isConnected&&row.dataset.pounceMotion===token)row.classList.remove('pounce-confirm')},1000)}
  const slot=row.querySelector('.presentation-team-pounce-slot');
  if(slot){
   const control=presentationPounceControl(t,q,ownerId);
   if(slot.dataset.renderedControl!==control){slot.innerHTML=control;slot.dataset.renderedControl=control;if(slot.firstElementChild)slot.firstElementChild.classList.add('control-arrive')}
  }
  }
 for(const t of ordered){const row=rows.get(t.id);const topBefore=before.get(t.id),topAfter=row?.getBoundingClientRect().top;if(row&&topBefore!==undefined&&Math.abs(topBefore-topAfter)>2&&row.animate&&!row.classList.contains('score-impact'))row.animate([{transform:'translateY('+(topBefore-topAfter)+'px)'},{transform:'translateY(0)'}],{duration:340,easing:'cubic-bezier(.2,.8,.2,1)'});}
 const teamCount=document.querySelector('.presentation-scores .section-title .tag');if(teamCount)teamCount.textContent=state.data.teams.length+' teams';
 if(state.scoreEffect)state.scoreEffect=null;
 if(state.pounceEffectTeamId)state.pounceEffectTeamId=null;
}
function syncPresentationFooter(){
 const q=state.data.current_question;
 const owner=state.data.teams.find(t=>t.id===(q?.owner_team_id||state.data.settings.active_team_id));
 const status=document.querySelector('.presentation-footer-status');
 if(!status)return;
 const now=status.querySelector('.tag');if(now)now.textContent=q?'NOW · '+(q.tag||''):'READY TO DRAW';
 const next=status.querySelector('.next-team-indicator');
 const nextTeam=state.data.teams.find(t=>t.id===(state.manualTeamOverride||suggestedTeamId(n(state.data.settings.active_round))));
 if(next)next.textContent='NEXT · '+(nextTeam?.name||'Team');
 const small=status.querySelector('.small');
 if(small)small.textContent=q?.is_audience?'Audience question':owner?'Current: '+owner.name:'No team assigned';
}
function presentationMoreMenuHTML(){
 if(!state.showMore)return '';
 return '<div class="card presentation-more-menu" role="dialog" aria-label="More quiz options"><div class="more-menu-heading"><strong>More options</strong><button class="icon-btn" data-action="present-more" aria-label="Close options">×</button></div><div class="more-menu-section"><label class="field-label">Round</label>'+roundSelector()+'</div><div class="more-menu-section"><label class="field-label" for="presentTeamSelect">Assign next question to</label><div class="more-menu-inline"><select id="presentTeamSelect" class="field">'+state.data.teams.map(t=>'<option value="'+esc(t.id)+'" '+(t.id===(state.manualTeamOverride||suggestedTeamId(n(state.data.settings.active_round)))?'selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select><button class="secondary" data-action="set-next-team">Use team</button></div><p class="muted small">Teams advance automatically based on their round question limits. Manual choice applies to the next draw only.</p></div><div class="more-menu-section"><label class="field-label" for="presentTag">Physical chit / final slip tag</label><div class="more-menu-inline"><input id="presentTag" class="field" placeholder="'+(n(state.data.settings.active_round)===6?'Final slip tag':'Physical chit tag')+'"><button class="secondary" data-action="present-chit" '+(state.busy||state.drawPhase==='revealing'?'disabled':'')+'>Verify</button></div></div>'+'<div class="audience-usage-note">Audience questions used this round: <strong>'+audienceDrawCount(n(state.data.settings.active_round))+'/2</strong></div><button class="secondary more-menu-full" data-action="draw-audience" '+(audienceDrawIsDisabled(n(state.data.settings.active_round))||state.busy||state.drawPhase==='revealing'?'disabled':'')+' title="'+esc(audienceDrawButtonTitle(n(state.data.settings.active_round)))+'">'+esc(audienceDrawButtonLabel(n(state.data.settings.active_round)))+'</button></div>';
}
function syncPresentationMoreMenu(){
 const root=document.querySelector('.presentation');if(!root)return;
 const existing=root.querySelector('.presentation-more-menu');
 if(state.showMore){if(!existing)root.insertAdjacentHTML('beforeend',presentationMoreMenuHTML())}
 else if(existing)existing.remove();
}
function syncAudienceDrawControls(){
 const round=n(state.data.settings.active_round),disabled=audienceDrawIsDisabled(round)||state.busy||state.drawPhase==='revealing';
 document.querySelectorAll('[data-action="draw-audience"]').forEach(button=>{
  button.disabled=disabled;
  button.title=audienceDrawButtonTitle(round);
  button.textContent=audienceDrawButtonLabel(round);
 });
 const note=document.querySelector('.audience-usage-note');
 if(note)note.innerHTML='Audience questions used this round: <strong>'+audienceDrawCount(round)+'/2</strong>';
}
function syncPresentationLive(){
 if(!state.presentation)return;
 const root=document.querySelector('.presentation');
 if(!root){renderPresentation();return}
 const key=presentationViewKey();
 if(state.presentationKey!==key){renderPresentation();return}
 syncPresentationMoreMenu();
 syncAudienceDrawControls();
 syncPresentationAnswer();
 syncPresentationScoreboard();
 syncPresentationFooter();
 updateTimerLabels();
}
function openModal(title,body,submitLabel='Save'){ $('#overlay').innerHTML=`<div class="modal-backdrop" id="modalBackdrop"><section class="card modal"><div class="section-title"><h2>${title}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div>${body}<div class="button-row" style="justify-content:flex-end;margin-top:20px"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" id="modalSubmit">${submitLabel}</button></div></section></div>`;$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()})}
function closeModal(){if(state.presentation)syncPresentationLive();else $('#overlay').innerHTML=''}
async function adminAction(action,payload={}){const r=await request('/admin/action',{method:'POST',body:JSON.stringify({action,...payload})});refresh(true).then(changed=>{if(!changed||document.visibilityState!=='visible'||$('#overlay .modal-backdrop'))return;if(state.presentation)syncPresentationLive();else if(state.page==='home'||state.page==='stats')render()}).catch(()=>{});return r}
function scoreMutationKey(questionId,teamId,eventType){return String(questionId||'')+':'+String(teamId||'')+':'+String(eventType||'')}
function isScorePending(questionId,teamId,eventType){return !!state.pendingScores?.[scoreMutationKey(questionId,teamId,eventType)]}
function renderVisibleArena(){if(state.presentation)syncPresentationLive();else render()}
async function awardScoreFast(teamId,points,eventType,reason){
 const q=state.data.current_question;if(!q)throw new Error('Draw a question before scoring.');
 const key=scoreMutationKey(q.id,teamId,eventType);
 if(state.pendingScores[key])return;
 const isPounce=String(eventType).startsWith('pounce-');
 const existing=(state.data.scores||[]).some(e=>e.question_id===q.id&&e.team_id===teamId&&(isPounce?String(e.event_type).startsWith('pounce-'):['correct','wrong'].includes(e.event_type))&&(!e.corrected_event_id||isPounce));
 if(existing)throw new Error(isPounce?'This pounce already has a result.':'This question has already been scored.');
 const optimisticId='optimistic-score-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
 const optimistic={id:optimisticId,question_id:q.id,team_id:teamId,points:n(points),event_type:eventType,reason:reason||'',created_at:new Date().toISOString(),round:n(q.round),optimistic:true};
 state.pendingScores[key]=true;
 state.data.scores=[optimistic,...(state.data.scores||[])];
 state.scoreEffect={teamId,delta:n(points)};
 renderVisibleArena();
 try{
   const result=await adminAction('score',{team_id:teamId,points:n(points),event_type:eventType,reason:reason||''});
   const actual=result?.score;
   state.data.scores=(state.data.scores||[]).filter(e=>e.id!==optimisticId);
   if(actual&&!state.data.scores.some(e=>e.id===actual.id))state.data.scores.unshift(actual);
   delete state.pendingScores[key];
   state.scoreEffect=null;
   renderVisibleArena();
   return actual;
 }catch(err){
   state.data.scores=(state.data.scores||[]).filter(e=>e.id!==optimisticId);
   delete state.pendingScores[key];
   renderVisibleArena();
   throw err;
 }
}
async function registerPounceFast(teamId){
 const q=state.data.current_question;if(!q)throw new Error('Draw a question before registering a pounce.');
 const exists=(state.data.pounces||[]).some(x=>x.question_id===q.id&&x.team_id===teamId);
 if(exists)return;
 const tempId='pending-pounce-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
 const pending={id:tempId,question_id:q.id,team_id:teamId,created_at:new Date().toISOString(),pending:true};
 state.data.pounces=[...(state.data.pounces||[]),pending];state.pounceEffectTeamId=teamId;
 renderVisibleArena();
 try{
   const result=await adminAction('pounce',{team_id:teamId});
   const saved=result?.pounce;
   state.data.pounces=(state.data.pounces||[]).filter(x=>x.id!==tempId);
   if(saved){
     state.data.pounces=state.data.pounces.filter(x=>!(x.question_id===saved.question_id&&x.team_id===saved.team_id));
     state.data.pounces.push(saved);
   }else if(!state.data.pounces.some(x=>x.question_id===q.id&&x.team_id===teamId)){
     state.data.pounces.push({question_id:q.id,team_id:teamId,created_at:new Date().toISOString()});
   }else{
     state.data.pounces=state.data.pounces.map(x=>x.question_id===q.id&&x.team_id===teamId?{...x,pending:false}:x);
   }
   state.pounceEffectTeamId=null;renderVisibleArena();
   return saved;
 }catch(err){
   state.data.pounces=(state.data.pounces||[]).filter(x=>x.id!==tempId);
   renderVisibleArena();
   throw err;
 }
}
async function selectRound(round){try{pauseTimer(true);state.answerRevealPending=false;await adminAction('set-round',{round:Number(round)});state.answerVisible=false;state.answerEffect=false;state.timeLeft=10;state.timerRunning=false;state.timerPersisted=false;state.showMore=false;state.data.settings.active_round=Number(round);state.data.settings.active_team_id=state.data.teams[0]?.id||state.data.settings.active_team_id;state.data.current_question=null;state.remoteSnapshot=null;if(state.presentation)renderPresentation();else render();notify(`R${round} · ${roundNames[round]} selected`)}catch(e){notify(e.message,true)}}
async function drawQuestion(method,tag='',teamId=null,roundOverride=null,audience=false){
 const round=n(roundOverride||state.data.settings.active_round);
 state.showMore=false;
 // Audience questions are allowed in all six rounds; only their own two-question pool is eligible.
 if(audience&&audienceDrawCount(round)>=2)return notify('Both audience questions for this round have already been used.',true);
 if(audience&&audiencePoolAvailableCount(round)===0)return notify('No audience-only questions are available. Add audience questions to this round in the Question Bank first.',true);
 if(state.busy)return;
 pauseTimer(true);
 state.answerRevealPending=false;clearInterval(state.timer);state.timer=null;state.timerRunning=false;state.timerPersisted=false;state.timeLeft=10;updateTimerLabels();
 const assignedTeamId=audience?null:(teamId||state.manualTeamOverride||suggestedTeamId(round));
 state.busy=true;state.tag=tag;state.drawMethod=method;state.drawAudience=audience;state.drawPhase='selecting';state.revealTag='';
 if(state.presentation)renderPresentation();else render();
 const feedback=$('#drawFeedback');
 if(feedback)feedback.innerHTML='<span class="draw-feedback-pulse"></span>'+(method==='random'?'Selecting '+esc(roundNames[round]||'round')+' for '+esc(state.data.teams.find(t=>t.id===assignedTeamId)?.name||'next eligible team')+'…':'Verifying physical chit '+esc(tag)+'…');
 const minAnimation=method==='random'?560:340;const started=Date.now();
 try{
  const result=await adminAction('draw',{method,tag,round,team_id:assignedTeamId,audience});
  const remaining=Math.max(0,minAnimation-(Date.now()-started));if(remaining)await new Promise(resolve=>setTimeout(resolve,remaining));
  state.answerVisible=false;state.answerEffect=false;state.timeLeft=10;state.timerRunning=false;state.timerPersisted=false;
  state.busy=false;state.tag='';state.drawPhase='revealing';state.revealTag=result.question?.tag||tag;
  state.data.current_question=result.question||state.data.current_question;
  if(state.data.current_question?.id){const drawnRow={question_id:state.data.current_question.id,tag:state.data.current_question.tag,round:n(state.data.current_question.round||round),team_id:audience?null:assignedTeamId,method,drawn_at:new Date().toISOString(),active:true};state.data.draws=[drawnRow,...(state.data.draws||[]).filter(d=>d.question_id!==drawnRow.question_id)].slice(0,100);if(state.questionBankLoaded&&Array.isArray(state.questionBank))state.questionBank=state.questionBank.map(item=>item.id===drawnRow.question_id?{...item,status:'drawn',is_audience:audience}:item)}
  if(state.data.current_question)state.data.current_question.answer_text='';
  if(!audience)state.manualTeamOverride=null;
  updateTimerLabels();
  if(state.presentation)renderPresentation();else render();
  notify('Tag '+state.revealTag+' selected'+(audience?'':' · for '+(state.data.teams.find(t=>t.id===assignedTeamId)?.name||'next team')));
  setTimeout(()=>{if(state.drawPhase==='revealing'){state.drawPhase='idle';state.revealTag='';if(state.presentation)renderPresentation();else render()}},1100);
 }catch(e){
  state.busy=false;state.tag='';state.drawAudience=false;state.drawPhase='idle';state.revealTag='';state.timeLeft=10;state.timerRunning=false;state.timerPersisted=false;updateTimerLabels();
  if(state.presentation)renderPresentation();else render();notify(e.message,true);
 }
}
function updateTimerLabels(){['#timerDisplay','#presentationTimerDisplay'].forEach(sel=>{const el=$(sel);if(el){el.textContent=formatTime(state.timeLeft);el.classList.toggle('urgent',state.timeLeft<=5)}});const b=$('#timerStartBtn');if(b)b.textContent=state.timerRunning?'Running':'Start timer';syncPresentationPounceAvailability()}
function startTimer(){if(state.timerRunning)return;if(!state.data.current_question)return notify('Draw a question before starting the timer.',true);if(state.timeLeft<=0)state.timeLeft=10;clearInterval(state.timer);state.timerRunning=true;state.timerPersisted=false;updateTimerLabels();const startedAt=new Date(Date.now()-(10-state.timeLeft)*1000).toISOString();sb.from('quizit_settings').update({timer_seconds:10,timer_started_at:startedAt,updated_at:new Date().toISOString()}).eq('id',1).then(result=>{if(result.error){state.timerPersisted=false;notify('Timer sync failed. Pounce is disabled until timer sync works.',true)}else{state.timerPersisted=true;if(state.presentation)syncPresentationLive()}});state.timer=setInterval(()=>{state.timeLeft=Math.max(0,state.timeLeft-1);updateTimerLabels();if(state.timeLeft===0){clearInterval(state.timer);state.timerRunning=false;state.timerPersisted=false;sb.from('quizit_settings').update({timer_started_at:null,updated_at:new Date().toISOString()}).eq('id',1);updateTimerLabels();if(state.presentation)syncPresentationLive();notify('Time is up.')}},1000)}
function pauseTimer(silent=false){clearInterval(state.timer);state.timerRunning=false;state.timerPersisted=false;sb.from('quizit_settings').update({timer_started_at:null,updated_at:new Date().toISOString()}).eq('id',1);updateTimerLabels();if(state.presentation)syncPresentationLive();if(!silent)notify('Timer paused')}
function resetTimer(){clearInterval(state.timer);state.timerRunning=false;state.timeLeft=10;state.timerPersisted=false;sb.from('quizit_settings').update({timer_seconds:10,timer_started_at:null,updated_at:new Date().toISOString()}).eq('id',1);updateTimerLabels();if(state.presentation)syncPresentationLive();else render()}
function fitQuestionText(){const targets=document.querySelectorAll('.presentation-question .question-text,.home-live-layout .question-copy h2');for(const el of targets){el.style.fontSize='';const presentation=!!el.closest('.presentation');let size=parseFloat(getComputedStyle(el).fontSize)||28;const min=presentation?9:18;const max=presentation?64:42;size=Math.min(size,max);el.style.fontSize=size+'px';el.style.overflow='hidden';for(let i=0;i<36;i++){if(el.scrollHeight<=el.clientHeight+1&&el.scrollWidth<=el.clientWidth+1)break;if(size<=min)break;size-=1;el.style.fontSize=size+'px'}}}
function readQuestion(){const q=state.data.current_question;if(!q)return;if(!('speechSynthesis'in window)){notify('Speech synthesis is not available in this browser.',true);return}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(q.question_text);u.rate=.92;speechSynthesis.speak(u)}
function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"'}function downloadCsv(name,rows){const csv=rows.map(row=>row.map(csvCell).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
function exportData(kind){const teams=state.data.teams,scores=scoreMap(),events=state.data.scores||[],draws=state.data.draws||[];if(kind==='scores')downloadCsv('egs-quizit-scores.csv',[['Rank','Team','School','Overall score','Current round score'],...orderedTeams().map((t,i)=>[i+1,t.name,t.school_name,scores[t.id]?.total||0,scores[t.id]?.rounds[state.data.settings.active_round]||0])]);if(kind==='teams')downloadCsv('egs-quizit-team-summary.csv',[['Team','School','Overall score',...rounds.map(r=>'Round '+r)],...teams.map(t=>[t.name,t.school_name,scores[t.id]?.total||0,...rounds.map(r=>scores[t.id]?.rounds[r]||0)])]);if(kind==='history'||kind==='events')downloadCsv('egs-quizit-marks-history.csv',[['Timestamp','Team','Question','Event','Points','Reason'],...events.map(e=>[e.created_at,teams.find(t=>t.id===e.team_id)?.name,e.question_id,e.event_type,e.points,e.reason])]);if(kind==='draws')downloadCsv('egs-quizit-question-history.csv',[['Timestamp','Tag','Round','Team','Method'],...draws.map(d=>[d.drawn_at,d.tag,d.round,teams.find(t=>t.id===d.team_id)?.name,d.method])]);if(kind==='audit')downloadCsv('egs-quizit-audit.csv',[['Timestamp','Action','Details','Operator'],...(state.data.audit||[]).map(a=>[a.created_at,a.action,JSON.stringify(a.details),a.operator])]);if(kind==='questions')loadQuestionBank(true)}
async function loadQuestionBank(exportCsv=false,force=false){const holder=$('#questionBank');if(!holder)return;try{if(!state.questionBankLoaded||force){const data=await request('/admin/questions');state.questionBank=data.questions||[];state.questionBankLoaded=true}if(exportCsv){downloadCsv('egs-quizit-questions.csv',[['tag','round','question_text','answer_text','source_url','media_url','set_tag','set_order','audience_only','status'],...state.questionBank.map(q=>[q.tag,q.round,q.question_text,q.answer_text,q.source_url,q.media_url,q.set_tag,q.set_order,!!q.audience_only,q.status])]);return}filterQuestionBank();syncAudienceDrawControls()}catch(e){holder.innerHTML=`<div class="notice error">${esc(e.message)}<br><br>Sign in as the project owner or an admin collaborator to manage the question bank. <a class="primary admin-signin-inline" href="/admin-access">Admin sign in ↗</a></div>`}}
function filterQuestionBank(){
 const holder=$('#questionBank');if(!holder)return;
 const search=($('#qSearch')?.value||'').toLowerCase(),round=$('#qRoundFilter')?.value||'all',type=$('#qTypeFilter')?.value||'all';
 const active=(state.questionBank||[]).filter(q=>q.status!=='archived');
 const matched=active.filter(q=>(round==='all'||n(q.round)===n(round))&&(type==='all'||(type==='audience'?!!q.audience_only:!q.audience_only))&&(!search||`${q.tag} ${q.question_text}`.toLowerCase().includes(search)));
 const qs=matched.slice(0,80),audienceTotal=active.filter(q=>q.audience_only).length,teamTotal=active.length-audienceTotal;
 const audienceSummary=rounds.map(r=>{const available=active.filter(q=>n(q.round)===r&&q.audience_only&&['available','reset'].includes(q.status)).length,used=Math.min(2,audienceDrawCount(r)),remaining=2-used,ready=used===2||available>=remaining;return `<span class="audience-pool-chip ${used===2?'complete':ready?'ready':'needs'}"><strong>R${r}</strong> ${used}/2 used · ${available} available</span>`}).join('');
 const table=qs.length?`<div class="table-wrap"><table><thead><tr><th>Tag</th><th>Round</th><th>Pool</th><th>Question</th><th>Status</th><th>Actions</th></tr></thead><tbody>${qs.map(q=>`<tr><td><strong>${esc(q.tag)}</strong></td><td>${q.round} · ${esc(roundNames[q.round]||'')}</td><td><span class="tag ${q.audience_only?'audience-question-tag':'team-question-tag'}">${q.audience_only?'Audience':'Team'}</span></td><td>${esc(q.question_text.slice(0,90))}${q.question_text.length>90?'…':''}</td><td><span class="tag">${esc(q.status)}</span></td><td><div class="button-row question-row-actions"><button class="secondary" data-edit-question="${q.id}">Edit</button><button class="secondary danger" data-remove-question="${q.id}" data-question-tag="${esc(q.tag)}">Remove</button></div></td></tr>`).join('')}</tbody></table></div><div class="small muted" style="margin-top:9px">Showing ${qs.length} of ${matched.length} matching questions · ${active.length} active total (${teamTotal} team, ${audienceTotal} audience-only). Each round can draw a maximum of two audience-only questions.</div>`:'<div class="empty-state">No matching questions. Add a team question, use Add audience question, or import a CSV with an audience_only column.</div>';
 holder.innerHTML=`<section class="audience-pool-panel"><div><strong>Audience question pools</strong><p class="small muted">Each round allows two audience draws, separate from the team question quota.</p></div><div class="audience-pool-grid">${audienceSummary}</div></section>${table}`;
}
function teamModal(team=null){openModal(team?'Edit team':'Add team',`<div class="form-grid"><div class="form-field"><label class="field-label">Team name</label><input id="teamName" class="field" value="${esc(team?.name||'')}" required></div><div class="form-field"><label class="field-label">School name</label><input id="schoolName" class="field" value="${esc(team?.school_name||'')}"></div><div class="form-field full"><label class="field-label">Logo image URL (optional)</label><input id="logoUrl" class="field" value="${esc(team?.logo_url||'')}" placeholder="https://…"></div></div>`,team?'Save changes':'Add team');$('#modalSubmit').onclick=async()=>{const name=$('#teamName').value.trim();if(!name)return notify('Team name is required.',true);try{await adminAction(team?'update-team':'add-team',{id:team?.id,name,school_name:$('#schoolName').value.trim(),logo_url:$('#logoUrl').value.trim()||null});closeModal();notify(team?'Team updated':'Team added');render()}catch(e){notify(e.message,true)}}}
function questionModal(q=null,audienceOnlyDefault=false){const initialRound=n(q?.round||state.data.settings.active_round);openModal(q?'Edit question':audienceOnlyDefault?'Add audience question':'Add question',`<div class="form-grid"><div class="form-field"><label class="field-label">Unique tag</label><input id="questionTag" class="field" value="${esc(q?.tag||'')}" placeholder="R1-0001"></div><div class="form-field"><label class="field-label">Round</label><select id="questionRound" class="field">${rounds.map(r=>`<option value="${r}" ${initialRound===r?'selected':''}>R${r} · ${roundNames[r]}</option>`).join('')}</select></div><div class="form-field"><label class="field-label">Media-pair tag (Round 3 or 6)</label><input id="questionSet" class="field" value="${esc(q?.set_tag||'')}" placeholder="R6-0001"></div><div class="form-field"><label class="field-label">Question order in pair</label><select id="questionSetOrder" class="field"><option value="1" ${n(q?.set_order||1)===1?'selected':''}>Question 1 · A</option><option value="2" ${n(q?.set_order)===2?'selected':''}>Question 2 · B</option></select></div><div class="form-field full audience-only-field"><label class="checkbox-row" for="questionAudienceOnly"><input id="questionAudienceOnly" type="checkbox" ${q?.audience_only||audienceOnlyDefault?'checked':''}><span><strong>Audience-only question</strong><small>Only the audience draw button can select this question. It does not count toward a team’s question quota.</small></span></label></div><div class="form-field full"><label class="field-label">Question text · open-ended only</label><textarea id="questionTextInput" class="field" rows="4" placeholder="Write the question without answer options…">${esc(q?.question_text||'')}</textarea></div><div class="form-field full"><label class="field-label">Answer key</label><textarea id="questionAnswer" class="field" rows="3" placeholder="Correct answer…">${esc(q?.answer_text||'')}</textarea></div><div class="form-field"><label class="field-label">Source URL (optional)</label><input id="questionSource" class="field" value="${esc(q?.source_url||'')}"></div><div class="form-field"><label class="field-label">Image / audio / video URL</label><input id="questionMedia" class="field" value="${esc(q?.media_url||'')}" placeholder="https://…"></div><div class="form-field"><label class="field-label">Status</label><select id="questionStatus" class="field">${['available','drawn','reset','archived','review-needed'].map(s=>`<option ${s===(q?.status||'available')?'selected':''}>${s}</option>`).join('')}</select></div></div><p class="small muted">For a new image/video/audio set, use Add image/video pair to create both questions together with the same media URL. Pairs in Rounds 3 and 6 must use the same set tag and A/B order.</p>`,q?'Save changes':audienceOnlyDefault?'Add audience question':'Add question');$('#modalSubmit').onclick=async()=>{const payload={id:q?.id,tag:$('#questionTag').value.trim(),round:n($('#questionRound').value),set_tag:$('#questionSet').value.trim()||null,set_order:n($('#questionSetOrder').value),audience_only:$('#questionAudienceOnly')?.checked===true,question_text:$('#questionTextInput').value.trim(),answer_text:$('#questionAnswer').value.trim(),source_url:$('#questionSource').value.trim()||null,media_url:$('#questionMedia').value.trim()||null,status:$('#questionStatus').value};if(!payload.tag||!payload.question_text||!payload.answer_text)return notify('Tag, standalone question, and answer are required.',true);if(payload.audience_only&&payload.set_tag)return notify('Audience questions must be standalone and cannot be part of a team media pair.',true);if(payload.round===6&&!payload.set_tag&&!payload.audience_only){const inferred=parseQuestionSet(payload.tag,null,payload.set_order,6);payload.set_tag=inferred.set_tag}try{await adminAction(q?'update-question':'add-question',payload);state.questionBankLoaded=false;closeModal();notify(q?'Question updated':payload.audience_only?'Audience question added':'Question added');render()}catch(e){notify(e.message,true)}}}
function mediaPairModal(initialRound=3){
 const round=[3,6].includes(Number(initialRound))?Number(initialRound):3;
 const tag='R'+round+'-AV-'+String(Date.now()%100000).padStart(5,'0');
 openModal('Add image / audio / video pair',`<div class="form-grid">
   <div class="form-field"><label class="field-label" for="mediaPairRound">Round</label><select id="mediaPairRound" class="field"><option value="3" ${round===3?'selected':''}>R3 · General Knowledge · shared visual</option><option value="6" ${round===6?'selected':''}>R6 · Music · audio / visual slip</option></select></div>
   <div class="form-field"><label class="field-label" for="mediaPairTag">Unique set tag</label><input id="mediaPairTag" class="field" value="${esc(tag)}" placeholder="R3-AV-00001"></div>
   <div class="form-field full"><label class="field-label" for="mediaPairUrl">Shared image, video, or audio URL</label><input id="mediaPairUrl" type="url" class="field" placeholder="https://… (image/video/audio file or YouTube URL)" required><p class="muted small">Both questions will display the same media. Use a direct public URL or a supported YouTube link.</p></div>
   <div class="form-field full"><label class="field-label" for="mediaPairSource">Source URL (optional)</label><input id="mediaPairSource" type="url" class="field" placeholder="https://…"></div>
   <div class="form-field full"><label class="field-label" for="mediaPairQuestionA">Question A · asked first</label><textarea id="mediaPairQuestionA" class="field" rows="3" placeholder="First open-ended question…" required></textarea></div>
   <div class="form-field full"><label class="field-label" for="mediaPairAnswerA">Answer key A</label><textarea id="mediaPairAnswerA" class="field" rows="2" placeholder="Answer to question A…" required></textarea></div>
   <div class="form-field full"><label class="field-label" for="mediaPairQuestionB">Question B · asked second</label><textarea id="mediaPairQuestionB" class="field" rows="3" placeholder="Second open-ended question based on the same media…" required></textarea></div>
   <div class="form-field full"><label class="field-label" for="mediaPairAnswerB">Answer key B</label><textarea id="mediaPairAnswerB" class="field" rows="2" placeholder="Answer to question B…" required></textarea></div>
 </div><p class="small muted">Creates tags ${esc(tag)}-A and ${esc(tag)}-B with one shared media URL and one set tag. In Rounds 3 and 6, the same team receives B immediately after A.</p>`,'Create paired questions');
 $('#modalSubmit').onclick=async()=>{
   const payload={round:n($('#mediaPairRound').value),set_tag:$('#mediaPairTag').value.trim(),media_url:$('#mediaPairUrl').value.trim(),source_url:$('#mediaPairSource').value.trim()||null,question_a:$('#mediaPairQuestionA').value.trim(),answer_a:$('#mediaPairAnswerA').value.trim(),question_b:$('#mediaPairQuestionB').value.trim(),answer_b:$('#mediaPairAnswerB').value.trim()};
   if(![3,6].includes(payload.round)||!payload.set_tag||!(payload.media_url.startsWith('https://')||payload.media_url.startsWith('http://'))||!cleanOpenQuestion(payload.question_a)||!cleanOpenQuestion(payload.question_b)||!payload.answer_a||!payload.answer_b){notify('Complete the round, set tag, media URL, two standalone questions, and both answer keys.',true);return}
   const submit=$('#modalSubmit');submit.disabled=true;submit.textContent='Creating pair…';
   try{const result=await adminAction('add-media-pair',payload);state.questionBankLoaded=false;closeModal();render();notify('Created paired set '+payload.set_tag+' with two linked questions');}
   catch(err){submit.disabled=false;submit.textContent='Create paired questions';notify(err.message||'Could not create media pair.',true)}
 };
}
async function importCsv(){const file=$('#csvFile')?.files?.[0];if(!file)return notify('Choose a CSV file first.',true);if(file.size>3*1024*1024)return notify('CSV must be under 3 MB.',true);const text=await file.text();const lines=text.split(/\r?\n/).filter(x=>x.trim());const parse=line=>{const out=[];let v='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'&&q&&line[i+1]==='"'){v+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){out.push(v);v=''}else v+=c}out.push(v);return out};const headers=parse(lines.shift()).map(s=>s.trim().toLowerCase());const required=['tag','round','question_text','answer_text'];if(!required.every(h=>headers.includes(h)))return notify('CSV headers must include tag, round, question_text, answer_text.',true);const questions=lines.map(line=>{const row=parse(line),o={};headers.forEach((h,i)=>o[h]=row[i]||'');return o}).filter(q=>q.tag&&cleanOpenQuestion(q.question_text)&&q.answer_text);try{const result=await adminAction('import-questions',{questions});state.questionBankLoaded=false;notify(`Imported ${result.imported||0} questions`);await loadQuestionBank(false,true);}catch(e){notify(e.message,true)}}
function bindAdminSearch(){const search=$('#qSearch'),filter=$('#qRoundFilter'),type=$('#qTypeFilter');if(search)search.oninput=filterQuestionBank;if(filter)filter.onchange=filterQuestionBank;if(type)type.onchange=filterQuestionBank}
document.addEventListener('click',async e=>{const pounceResult=e.target.closest('[data-pounce-result]');if(pounceResult){const [teamId,eventType]=pounceResult.dataset.pounceResult.split(':');const team=state.data.teams.find(t=>t.id===teamId);const points=eventType==='pounce-correct'?10:-5;pounceResult.disabled=true;try{await awardScoreFast(teamId,points,eventType,'Pounce result');notify((team?.name||'Team')+' awarded '+(points>0?'+':'')+points+' for pounce')}catch(err){if(state.presentation)syncPresentationLive();notify(err.message||'Could not score pounce.',true)}return}const presentPounce=e.target.closest('[data-present-pounce]');if(presentPounce){if(presentPounce.disabled)return;const team=state.data.teams.find(t=>t.id===presentPounce.dataset.presentPounce);presentPounce.disabled=true;try{await registerPounceFast(presentPounce.dataset.presentPounce);notify('Pounce registered for '+(team?.name||'team'))}catch(err){if(state.presentation)syncPresentationLive();notify(err.message||'Could not register pounce.',true)}return}const nav=e.target.closest('[data-page]');if(nav){navigate(nav.dataset.page);return}const round=e.target.closest('[data-round]');if(round){await selectRound(round.dataset.round);return}/* Ordinary score paddles are handled by the dedicated scoring listener below. */const removeQuestion=e.target.closest('[data-remove-question]');if(removeQuestion){const id=removeQuestion.dataset.removeQuestion,tag=removeQuestion.dataset.questionTag||'this question';if(!confirm('Remove '+tag+' from the active question bank? Questions already used will be archived so score and draw history stay intact.'))return;removeQuestion.disabled=true;try{const result=await adminAction('remove-question',{id});state.questionBankLoaded=false;await loadQuestionBank(false,true);notify(result.archived?'Question/pair archived; match history preserved.':(result.questions_affected>1?'Final-round pair permanently removed.':'Question permanently removed.'))}catch(err){removeQuestion.disabled=false;notify(err.message||'Could not remove question.',true)}return}const editTeam=e.target.closest('[data-edit-team]');if(editTeam){teamModal(state.data.teams.find(t=>t.id===editTeam.dataset.editTeam));return}const editQuestion=e.target.closest('[data-edit-question]');if(editQuestion){questionModal((state.questionBank||[]).find(q=>q.id===editQuestion.dataset.editQuestion));return}const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;try{switch(action){case'close-modal':closeModal();break;case'chit':{const tag=$('#tagInput')?.value.trim()||state.tag;if(!tag)return notify('Enter the physical chit tag.',true);await drawQuestion('chit',tag);break}case'present-chit':{const tag=$('#presentTag')?.value.trim();if(!tag)return notify('Enter the physical chit tag or final-round set tag.',true);await drawQuestion('chit',tag,null,n(state.data.settings.active_round));break}case'present-paired':{const q=state.data.current_question;if(!q||![3,6].includes(n(q.round))||!q.set_tag||n(q.set_order)!==1)return notify('Draw the first question from a paired image/audio set first.',true);await drawQuestion('chit',q.set_tag,q.owner_team_id,n(q.round));break}case'draw':await drawQuestion('random');break;case'draw-audience':if(audienceDrawCount(n(state.data.settings.active_round))>=2)return notify('Both audience questions for this round have already been used.',true);await drawQuestion('random','',null,n(state.data.settings.active_round),true);break;case'answer':{const current=state.data.current_question;if(!current)throw new Error('Draw a question before revealing its answer.');if(state.answerRevealPending)break;if(!state.answerVisible){const questionId=current.id;state.answerRevealPending=true;state.answerEffect=false;if(state.presentation)syncPresentationLive();else render();try{const answer=await adminAction('reveal-answer',{question_id:questionId});if(state.data.current_question?.id!==questionId){state.answerRevealPending=false;break}state.data.current_question.answer_text=answer.answer_text||'';state.answerRevealPending=false;state.answerVisible=true;state.answerEffect=true;if(state.presentation)syncPresentationLive();else render();if(!state.presentation)requestAnimationFrame(()=>{const card=document.querySelector('.answer-box.answer-just-revealed');if(card){card.classList.remove('answer-just-revealed');void card.offsetWidth;card.classList.add('answer-just-revealed')}});setTimeout(()=>{state.answerEffect=false},1500)}catch(err){state.answerRevealPending=false;if(state.presentation)syncPresentationLive();else render();throw err}}else{state.answerVisible=false;state.answerEffect=false;state.data.current_question.answer_text='';if(state.presentation)syncPresentationLive();else render();adminAction('hide-answer').catch(err=>notify(err.message||'Could not hide answer.',true))}break}case'read':readQuestion();break;case'timer-start':startTimer();break;case'timer-pause':pauseTimer();break;case'timer-reset':resetTimer();break;case'next-team':await adminAction('next-team');state.answerVisible=false;render();notify('Next team selected');break;case'correct':case'wrong':case'pounce':case'pounce-correct':case'pounce-wrong':break;case'add-team':teamModal();break;case'add-question':questionModal();break;case'add-audience-question':questionModal(null,true);break;case'add-media-pair':mediaPairModal(n(state.data.settings.active_round)===6?6:3);break;case'import-csv':await importCsv();break;case'export-scores':exportData('scores');break;case'export-teams':exportData('teams');break;case'export-history':exportData('history');break;case'export-events':exportData('events');break;case'export-draws':exportData('draws');break;case'export-audit':exportData('audit');break;case'export-questions':await loadQuestionBank(true);break;case'save-settings':{const payload={correct_points:10,wrong_points:0,pounce_correct:10,pounce_wrong:-5,timer_seconds:10,round3_media_url:$('#round3MediaUrl').value.trim()||null,final_round_media_url:$('#finalMediaUrl').value.trim()||null,theme:$('#themeSelect').value};await adminAction('save-settings',payload);applyTheme(payload.theme,true);notify('Settings saved');break}case'reset-draws':if(confirm('Reset draw eligibility for all questions? Draw history will be retained.')){await adminAction('reset-draws');state.questionBankLoaded=false;await loadQuestionBank(false,true);notify('Draw eligibility reset');if(state.presentation)syncPresentationLive()}break;case'reset-scores':if(confirm('Reset all scores? The score history will be retained as an audit trail.')){await adminAction('reset-scores');notify('Scores reset')}break;case'exit-presentation':state.presentation=false;state.showMore=false;document.documentElement.classList.remove('presentation-open');document.body.classList.remove('presentation-open');$('#overlay').innerHTML='';render();break;case'set-next-team':{const id=$('#presentTeamSelect')?.value;const team=state.data.teams.find(t=>t.id===id);if(!team)throw new Error('Choose an active team for the next question.');state.manualTeamOverride=id;state.showMore=false;syncPresentationLive();notify('Next question assigned to '+team.name);break}case'present-more':state.showMore=!state.showMore;syncPresentationLive();break;case'toggle-paddles':state.showPaddles=!state.showPaddles;await adminAction('save-settings',{show_paddles:state.showPaddles});renderPresentation();break}}catch(err){notify(err.message||'Something went wrong.',true)} });
document.addEventListener('click',async e=>{const p=e.target.closest('[data-paddle]');if(!p)return;const action=p.dataset.paddle;try{if(action==='pounce'){const eligible=state.data.teams.filter(t=>t.id!==state.data.current_question?.owner_team_id);openModal('Register a pounce',`<label class="field-label">Which team pounced?</label><select id="pounceTeam" class="field">${eligible.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>`,'Register pounce');$('#modalSubmit').onclick=async()=>{try{await registerPounceFast($('#pounceTeam').value);closeModal();notify('Pounce registered')}catch(err){notify(err.message||'Could not register pounce.',true)}};return}const team=state.data.teams.find(t=>t.id===(state.data.current_question?.owner_team_id||state.data.settings.active_team_id));if(!team)return notify('No team is assigned to this question.',true);let points=action==='correct'?10:action==='wrong'?(n(state.data.current_question?.round)===6?-5:0):action==='pounce-correct'?10:-5;if(action.startsWith('pounce-')){const ps=(state.data.pounces||[]).filter(x=>x.question_id===state.data.current_question?.id);if(!ps.length)return notify('No team has registered a pounce.',true);openModal('Award pounce result',`<label class="field-label">Pounced teams</label><select id="pounceResultTeam" class="field">${ps.map(p=>`<option value="${p.team_id}">${esc(state.data.teams.find(t=>t.id===p.team_id)?.name||'Team')}</option>`).join('')}</select><p class="muted small" style="margin-top:10px">${action==='pounce-correct'?'+10 points':'−5 points'} for this pounce result.</p>`,'Confirm result');$('#modalSubmit').onclick=async()=>{try{await awardScoreFast($('#pounceResultTeam').value,points,action,'Pounce result');closeModal();notify('Pounce score recorded')}catch(err){notify(err.message||'Could not score pounce.',true)}};return}await awardScoreFast(team.id,points,action,action==='correct'?'Correct answer':'Wrong answer');notify('Score recorded');state.selectedPaddle=null;render()}catch(err){notify(err.message,true)}});
$('#menuBtn').addEventListener('click',()=>$('#nav').classList.toggle('open'));document.addEventListener('change',e=>{if(e.target.id==='themeGlobal')applyTheme(e.target.value,true)});
window.addEventListener('resize',()=>requestAnimationFrame(fitQuestionText));window.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.presentation){state.presentation=false;document.documentElement.classList.remove('presentation-open');document.body.classList.remove('presentation-open');$('#overlay').innerHTML='';render()}});
initRealtimeUpdates();
refresh();
setInterval(()=>{if(document.visibilityState==='visible'){refresh(true).then(changed=>{if(changed&&(state.page==='home'||state.page==='stats'||state.presentation)){if(state.presentation)syncPresentationLive();else render()}})}},6000);
window.addEventListener('focus',()=>refresh(true).then(changed=>{if(changed&&(state.page==='home'||state.page==='stats'||state.presentation)){if(state.presentation)syncPresentationLive();else render()}}));
sb.auth.onAuthStateChange(()=>{clearAdminAuthCache();state.adminSession=null;if(state.page==='admin')render()});