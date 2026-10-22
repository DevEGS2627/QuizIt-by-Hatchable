export const access = 'public';
export const methods = ['GET'];
export default async function (req, res) {
  return res.send(`<!doctype html>
<html lang="en" class="theme-midnight">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Admin access · EGS Quizit!</title><link rel="stylesheet" href="/theme.css"><style>.gate-actions{display:grid;gap:10px;margin-top:22px}.gate-actions a,.gate-actions button{display:flex;justify-content:center;align-items:center;text-decoration:none;min-height:44px}.gate-note{margin-top:18px;font-size:12px;line-height:1.6;color:var(--muted)}[hidden]{display:none!important}</style></head>
<body><main class="admin-gate-page"><section class="card admin-gate-card"><div class="brand-mark" style="margin:0 auto 20px">Q!</div><div class="eyebrow">EGS QUIZIT! · ADMINISTRATION</div><h1>Administrator access</h1><p id="gateMessage" class="muted">Checking sign-in…</p><div id="gateActions" class="gate-actions"><a class="primary" href="/login?next=%2Fadmin-access">Sign in with login ID and password ↗</a></div><p class="gate-note">The live question and visitor theme picker remain public. Only the approved administrator can edit questions, teams, scores, and settings.</p><a class="admin-gate-back" href="/">← Back to live question</a></section></main>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script><script>
(async function(){
 const sb=window.supabase.createClient('https://uafzfoddvneblhgncdrb.supabase.co','sb_publishable_6r5C2eoz6k1ZmpeCszCKWw_EjMIP9h-',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const msg=document.getElementById('gateMessage'),actions=document.getElementById('gateActions');
 try{
  const {data:{user}}=await sb.auth.getUser();
  if(!user){msg.textContent='Sign in with the approved admin login ID and password.';return}
  const {data,error}=await sb.rpc('quizit_is_admin');
  if(!error&&data===true){
   msg.textContent='Signed in as '+(user.email||'administrator')+'.';
   actions.innerHTML='<a class="primary" href="/?view=admin">Open Admin Controls ↗</a><button class="secondary" id="signOut">Sign out</button>';
   document.getElementById('signOut').onclick=async()=>{await sb.auth.signOut();location.reload()};
  }else{
   msg.textContent='This account ('+(user.email||'unknown')+') is not approved for admin access.';
   actions.innerHTML='<button class="primary" id="switchAccount">Sign out and switch account</button><a class="secondary" href="/">Return to live question</a>';
   document.getElementById('switchAccount').onclick=async()=>{await sb.auth.signOut();location.href='/login?next=%2Fadmin-access'};
  }
 }catch(e){msg.textContent='Could not check administrator access. Please try again.'}
})();
</script></body></html>`);
}