import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { deploymentLabel } from '../deployment.ts';
import type { DeployState } from '../deployment.ts';
import { displayDate } from '../../src/lib/dates.ts';

export function DeploymentControl({ contentVersion }: { contentVersion:string }) {
  const [state,setState]=useState<DeployState>(), [error,setError]=useState(''), [submitting,setSubmitting]=useState(false), [message,setMessage]=useState('');
  const dialog=useRef<HTMLDialogElement>(null), loading=useRef(false), current=useRef(state), missing=useRef({sha:'',at:Date.now()}), messageTouched=useRef(false);
  current.current=state;
  const refresh=useCallback(async (force=false) => {
    if(loading.current) return;
    loading.current=true;
    try { const next=await api<DeployState>(`/api/mory-deployment${force?'?refresh=1':''}`); setState(next); if(dialog.current?.open) setConfirmed(next); }
    catch { setError('배포 상태를 확인하지 못했습니다. CMS 연결을 확인하세요.'); }
    finally { loading.current=false; }
  },[]);
  useEffect(()=>{void refresh();},[refresh,contentVersion]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>, alive=true;
    const poll=async()=>{
      const s=current.current;
      if(missing.current.sha!==s?.remote) missing.current={sha:s?.remote??'',at:Date.now()};
      const active=s?.busy || (s?.run && s.run.status!=='completed') || (!s?.run && !!s?.remote && !s.githubError && Date.now()-missing.current.at<30_000);
      timer=setTimeout(async()=>{ if(document.visibilityState==='visible') await refresh(); if(alive) poll(); },active?5000:60_000);
    };
    poll();
    const focus=()=>{void refresh();}; window.addEventListener('focus',focus);
    return()=>{alive=false;clearTimeout(timer);window.removeEventListener('focus',focus);};
  },[refresh]);
  const open=async()=>{setError('');messageTouched.current=false;setConfirmed(current.current);setMessage(current.current?.suggestedMessage??'chore: Mory 업데이트');dialog.current?.showModal();await refresh(true);};
  // Never overwrite a user's message while they are editing the confirmation.
  const [confirmed,setConfirmed]=useState<DeployState>();
  useEffect(()=>{if(!dialog.current?.open || submitting) return; setConfirmed(state);},[state?.fingerprint,state?.action,submitting]);
  useEffect(()=>{if(!messageTouched.current)setMessage(confirmed?.suggestedMessage??'chore: Mory 업데이트');},[confirmed?.fingerprint]);
  async function execute() {
    const target=confirmed??state;
    if(!target) return;
    setSubmitting(true);setError('');
    try {
      const next=await api<DeployState>('/api/mory-deployment','POST',{action:target.action,fingerprint:target.fingerprint,...(target.action==='commit'?{message}: {})});
      setState(next);setConfirmed(next);
    } catch(e) {setError((e as Error).message);await refresh(true);}
    finally {setSubmitting(false);}
  }
  const action=state?.action??'none';
  const actionText={commit:'커밋 및 배포',push:'Push 및 배포',sync:'안전하게 동기화',rerun:'다시 배포',none:''}[action];
  return <><button className="deployment-toggle" aria-haspopup="dialog" onClick={()=>{setConfirmed(undefined);void open();}} title={deploymentLabel(state)}>{deploymentLabel(state)}</button>
    <dialog ref={dialog} className="deployment-dialog" aria-labelledby="deployment-title">
      <div className="deployment-heading"><h2 id="deployment-title">Mory 배포</h2><button aria-label="배포 창 닫기" onClick={()=>dialog.current?.close()}>닫기</button></div>
      {!state?<p role="status">상태 확인 중…</p>:<>
        <p role="status">{deploymentLabel(state)}</p>
        <dl><dt>로컬 변경</dt><dd>{state.changed}개 · staged {state.staged} / unstaged {state.unstaged} / 새 파일 {state.untracked}</dd>
          <dt>브랜치</dt><dd>{state.branch??'확인 필요'}</dd>
          <dt>로컬 / 원격</dt><dd><code>{state.local?.slice(0,7)??'—'} / {state.remote?.slice(0,7)??'—'}</code></dd>
          <dt>기록 차이</dt><dd>로컬 앞섬 {state.ahead} / 원격 앞섬 {state.behind}</dd>
          <dt>배포</dt><dd>{state.run ? <>{state.run.name}<br/>{state.run.status} · {state.run.conclusion??'진행 중'} · {state.run.sha.slice(0,7)}<br/>{displayDate(state.run.at)} {state.run.url&&<a href={state.run.url} target="_blank" rel="noreferrer">GitHub Actions 상세</a>}</> : '배포 실행 기록 없음'}</dd>
        </dl>
        {state.blocked&&<p role="alert">{state.blocked}</p>}
        {state.githubError&&<p role="alert">{state.githubError}</p>}
        {state.busy&&<p>콘텐츠 게시 또는 Git 작업이 진행 중입니다. 완료 후 다시 실행하세요.</p>}
        {!state.blocked&&!state.busy&&action==='commit'&&<><p>현재 로컬 변경사항 전체를 커밋하고 배포합니다. 실행 데이터는 Git에서 제외됩니다.</p><label>커밋 메시지<input aria-label="커밋 메시지" value={message} maxLength={1000} disabled={submitting} onChange={e=>{messageTouched.current=true;setMessage(e.target.value);}}/></label></>}
        {!state.blocked&&!state.busy&&action==='sync'&&<p>로컬 작업을 보존하며 원격 변경을 반영한 뒤 상태를 다시 확인합니다.</p>}
        {action==='none'&&!state.busy&&!state.blocked&&state.run?.conclusion==='success'&&<p>현재 origin/main이 정상 배포되어 있습니다.</p>}
        {action==='none'&&!state.busy&&state.run?.status==='completed'&&state.run.conclusion!=='success'&&!state.canRerun&&<p>다시 배포하려면 서버에 GitHub Actions 쓰기 권한을 설정하세요.</p>}
        {!state.run&&!state.githubError&&!state.busy&&<p>Actions 실행 생성이 지연될 수 있습니다. 상태를 다시 확인하세요. 새 커밋을 자동 생성하지 않습니다.</p>}
      </>}
      {(error||state?.lastError)&&<p role="alert">{error||state?.lastError}</p>}
      <div className="deployment-actions"><button disabled={submitting} onClick={()=>void refresh(true)}>상태 새로고침</button>{action!=='none'&&!state?.blocked&&<button disabled={submitting||state?.busy||(action==='commit'&&!message.trim())||!confirmed} onClick={()=>void execute()}>{submitting?'처리 중…':actionText}</button>}</div>
    </dialog></>;
}
