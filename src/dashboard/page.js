module.exports = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Napakoe BOT — дашборд</title>
<style>
:root{color-scheme:dark;--bg:#0f0f14;--card:#181822;--line:#2a2a3a;--text:#ececf4;--mute:#8d8da6;--acc:#7c5cff;--ok:#3ddc97;--bad:#ff5d73}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:20px 16px 60px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
h1{margin:0;font-size:22px}h1 span{color:var(--acc)}
button{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px;cursor:pointer}
button:hover{border-color:var(--acc)}button.pri{background:var(--acc);border-color:var(--acc)}button:disabled{opacity:.5;cursor:wait}
input{font:inherit;color:var(--text);background:#10101a;border:1px solid var(--line);border-radius:10px;padding:8px 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.stat b{display:block;font-size:22px}.stat small,.mute{color:var(--mute)}
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.tabs button.on{border-color:var(--acc);background:#23203a}
.tabs img{width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:6px}
h2{font-size:17px;margin:0 0 12px}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}
.sw{position:relative;width:46px;height:26px;border-radius:99px;background:#2d2d40;border:0;padding:0;flex:none}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.15s}
.sw.on{background:var(--ok)}.sw.on::after{left:23px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.two{grid-template-columns:1fr}}
.login{max-width:340px;margin:12vh auto}.login input{width:100%;margin:12px 0}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--card);border:1px solid var(--line);padding:10px 16px;border-radius:12px;opacity:0;transition:.2s;pointer-events:none}
#toast.show{opacity:1}.hidden{display:none!important}
</style></head><body><div class="wrap">

<div id="login" class="card login hidden">
  <h1>Napakoe <span>BOT</span></h1><p class="mute">Вход в дашборд</p>
  <input id="pw" type="password" placeholder="Пароль" autocomplete="current-password">
  <button class="pri" id="loginBtn" style="width:100%">Войти</button>
</div>

<div id="app" class="hidden">
  <header><h1>Napakoe <span>BOT</span> <small class="mute" id="tag"></small></h1><button id="logout">Выйти</button></header>
  <div class="grid" id="stats"></div>
  <div class="tabs" id="tabs"></div>
  <div id="guild"></div>
</div>
<div id="toast"></div>
</div>
<script>
var $=function(s){return document.querySelector(s)};
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function toast(t){var x=$('#toast');x.textContent=t;x.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(function(){x.classList.remove('show')},2600)}
async function api(path,method,body){
  var r=await fetch('/api'+path,{method:method||'GET',headers:{'Content-Type':'application/json','X-Requested-With':'napakoe'},body:body?JSON.stringify(body):undefined});
  var j=await r.json().catch(function(){return{}});
  if(r.status===401&&path!=='/login'){showLogin();throw new Error('auth')}
  if(!r.ok)throw new Error(j.error||('Ошибка '+r.status));
  return j;
}
function showLogin(){$('#app').classList.add('hidden');$('#login').classList.remove('hidden')}
function fmtUp(s){return Math.floor(s/86400)+'д '+Math.floor(s%86400/3600)+'ч '+Math.floor(s%3600/60)+'м'}
function fmtAgo(ts){if(!ts)return 'ещё не было';var m=Math.round((Date.now()-ts)/60000);return m<1?'только что':m<60?m+' мин назад':Math.round(m/60)+' ч назад'}
var current=null;

async function loadOverview(){
  var o=await api('/overview');
  $('#tag').textContent=o.tag;
  var items=[['Пинг',o.ping+' мс'],['Аптайм',fmtUp(o.uptime)],['Серверов',o.guilds],['Участников',o.members],['Память',o.memoryMb+' МБ'],['Проверка AFK',fmtAgo(o.afkLastRun)]];
  var box=$('#stats');box.textContent='';
  items.forEach(function(i){var c=el('div','card stat');c.appendChild(el('b',null,String(i[1])));c.appendChild(el('small',null,i[0]));box.appendChild(c)});
}
async function loadGuilds(){
  var list=await api('/guilds');var tabs=$('#tabs');tabs.textContent='';
  list.forEach(function(g){
    var b=el('button',g.id===current?'on':'');
    if(g.icon){var im=el('img');im.src=g.icon;im.alt='';b.appendChild(im)}
    b.appendChild(document.createTextNode(g.name));
    b.onclick=function(){current=g.id;loadGuilds();loadGuild()};
    tabs.appendChild(b);
  });
  if(!current&&list.length){current=list[0].id;loadGuilds();loadGuild()}
  if(!list.length)$('#guild').textContent='Бот пока не добавлен ни на один сервер.';
}
async function loadGuild(){
  if(!current)return;
  var g=await api('/guilds/'+current);var root=$('#guild');root.textContent='';
  var two=el('div','two');

  var mods=el('div','card');mods.appendChild(el('h2',null,'Модули'));
  g.modules.forEach(function(m){
    var row=el('div','row');row.appendChild(el('span',null,m.label));
    var sw=el('button','sw'+(m.enabled?' on':''));sw.title='Переключить';
    sw.onclick=async function(){sw.disabled=true;try{await api('/guilds/'+current+'/toggle','POST',{module:m.key});toast(m.label+': обновлено');await loadGuild()}catch(e){toast(e.message);sw.disabled=false}};
    row.appendChild(sw);mods.appendChild(row);
  });

  var right=el('div');
  var cnt=el('div','card');cnt.appendChild(el('h2',null,'Сервер «'+g.name+'»'));
  [['Участников',g.members],['Заявок на рассмотрении',g.counts.pending],['Открытых тикетов',g.counts.openTickets],['Браков',g.counts.marriages],['В AFK сейчас',g.counts.afkMembers],['Отслеживается участников',g.counts.tracked]].forEach(function(p){
    var row=el('div','row');row.appendChild(el('span','mute',p[0]));row.appendChild(el('b',null,String(p[1])));cnt.appendChild(row)});

  var afk=el('div','card');afk.style.marginTop='12px';afk.appendChild(el('h2',null,'Автопроверка AFK'));
  afk.appendChild(el('p','mute','Роль: '+(g.afk.roleName||'не выбрана')+' · последняя проверка: '+fmtAgo(g.afk.lastRun)+(g.afk.last&&g.afk.last.assigned!==undefined?' (выдано: '+g.afk.last.assigned+')':'')));
  var line=el('div','row');var inp=el('input');inp.type='number';inp.min=1;inp.max=365;inp.value=g.afk.days;inp.style.width='90px';
  var save=el('button',null,'Сохранить дни');save.onclick=async function(){try{await api('/guilds/'+current+'/afk','POST',{days:Number(inp.value)});toast('Срок сохранён');loadGuild()}catch(e){toast(e.message)}};
  line.appendChild(inp);line.appendChild(save);afk.appendChild(line);
  var run=el('button','pri','Проверить сейчас');run.style.marginTop='10px';
  run.onclick=async function(){run.disabled=true;try{var r=await api('/guilds/'+current+'/afk/run','POST');toast(r.skipped?'Пропущено: '+r.skipped:'Проверено: '+r.checked+', выдано AFK: '+r.assigned);loadGuild();loadOverview()}catch(e){toast(e.message)}run.disabled=false};
  afk.appendChild(run);
  right.appendChild(cnt);right.appendChild(afk);two.appendChild(mods);two.appendChild(right);root.appendChild(two);
}
async function start(){
  try{await loadOverview();$('#login').classList.add('hidden');$('#app').classList.remove('hidden');await loadGuilds()}catch(e){if(e.message!=='auth')toast(e.message)}
}
$('#loginBtn').onclick=async function(){try{await api('/login','POST',{password:$('#pw').value});$('#pw').value='';start()}catch(e){toast(e.message)}};
$('#pw').addEventListener('keydown',function(e){if(e.key==='Enter')$('#loginBtn').click()});
$('#logout').onclick=async function(){await api('/logout','POST').catch(function(){});current=null;showLogin()};
setInterval(function(){if(!$('#app').classList.contains('hidden'))loadOverview().catch(function(){})},15000);
start();
</script></body></html>`;
