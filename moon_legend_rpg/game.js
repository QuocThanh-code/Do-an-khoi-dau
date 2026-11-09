(()=>{
'use strict';
const KEY='moonlegend_anime_rpg_v3';
const LEGACY_KEY='moonlegend_anime_rpg_v2';
const $=id=>document.getElementById(id);
const enemies=[
 {name:'Slime Nguyệt',icon:'🟢',desc:'Sinh vật nhỏ bé của khu rừng',hp:42,atk:8,xp:18,gold:12},
 {name:'Cáo Lửa',icon:'🦊',desc:'Linh thú nhanh nhẹn và tinh quái',hp:58,atk:11,xp:25,gold:17},
 {name:'Goblin Rừng',icon:'👺',desc:'Kẻ canh giữ con đường cổ',hp:76,atk:14,xp:32,gold:22},
 {name:'Kỵ Sĩ Bóng Đêm',icon:'🦇',desc:'Chiến binh bị bóng tối chi phối',hp:105,atk:18,xp:48,gold:32},
 {name:'Rồng Hắc Ám',icon:'🐉',desc:'Thủ lĩnh của vùng đất bị nguyền',hp:190,atk:25,xp:100,gold:90,boss:true},
 {name:'Linh Thể Vô Danh',icon:'👁️',desc:'Quái vật ẩn mình sau màn sương — cực kỳ hiếm gặp',hp:145,atk:22,xp:105,gold:100,hidden:true}
];
const traitBook={
 guard:{name:'Phòng thủ cao',icon:'🛡️',desc:'Phòng thủ +7, giảm sát thương trực tiếp.'},
 armor:{name:'Giáp cứng',icon:'🔰',desc:'Giảm thêm 18% sát thương nhận vào.'},
 vitality:{name:'Sinh lực dày',icon:'❤️',desc:'HP tối đa tăng 35%.'},
 evasive:{name:'Né tránh',icon:'💨',desc:'Có 16% cơ hội né đòn.'},
 regen:{name:'Tái tạo',icon:'🌿',desc:'Hồi 6% HP tối đa trước lượt phản công.'}
};
const rankInfo={
 normal:{label:'THƯỜNG',icon:'⚪'},
 elite:{label:'TINH ANH',icon:'🟠'},
 hidden:{label:'QUÁI ẨN',icon:'🟣'},
 boss:{label:'BOSS',icon:'🔴'}
};
const base=()=>({
 version:5,name:'Astra',level:1,hp:120,maxHp:120,mp:45,maxMp:45,
 xp:0,gold:45,baseAtk:18,baseDef:7,weaponBonus:0,armorBonus:0,
 weapon:'Kiếm tập sự',armor:'Áo choàng vải',potions:3,wins:0,turn:1,bossDefeated:0,deaths:0,totalGoldLost:0,
 enemyIndex:0,enemy:null,guarding:false,wonCurrent:false,reviveAvailable:true,
 bought:{sword:false,armor:false},questClaimed:{first:false,slimes:false,level:false},
 area:0,log:['<span class="good">Ánh trăng soi sáng con đường của Astra. Cuộc phiêu lưu bắt đầu!</span>']
});
let activeAccount=null;
let s=base();
let phase='player';
let actionTimer=null;
let busy=false;
function maxXp(){return 60+(s.level-1)*35}
function atk(){return s.baseAtk+s.weaponBonus}
function def(){return s.baseDef+s.armorBonus}
function chooseTraits(rank){
 const pool=['guard','armor','vitality','evasive','regen'];
 if(rank==='normal')return Math.random()<.12?[pool[Math.floor(Math.random()*pool.length)]]:[];
 if(rank==='boss')return ['vitality','armor'];
 const count=rank==='hidden'?2:1;
 const result=[];
 while(result.length<count){const id=pool[Math.floor(Math.random()*pool.length)];if(!result.includes(id))result.push(id)}
 return result;
}
function bossStatMultiplier(){
 // Boss 1 = x2; Boss 2 = x3; Boss 3 = x6; Boss 4 = x12; tiếp tục nhân đôi.
 const defeated=Math.max(0,s.bossDefeated||0);
 return defeated===0?2:3*Math.pow(2,defeated-1);
}
function scaleEnemy(index,rank='normal'){
 const factor=1+(s.level-1)*.14;
 const e=enemies[index];
 const mult={normal:{hp:1,atk:1,xp:1,gold:1},elite:{hp:1.48,atk:1.20,xp:1.65,gold:1.6},hidden:{hp:1.42,atk:1.24,xp:2.25,gold:2.3},boss:{hp:1.85,atk:1.28,xp:3.1,gold:3.8}}[rank];
 const bossMultiplier=rank==='boss'?bossStatMultiplier():1;
 let maxHp=Math.round(e.hp*factor*mult.hp*bossMultiplier), enemyDef=rank==='boss'?Math.round(5*bossMultiplier):0,armorReduction=0,dodgeChance=0,regenPct=0;
 const traits=chooseTraits(rank);
 traits.forEach(id=>{
  if(id==='guard')enemyDef+=7;
  if(id==='armor')armorReduction=.18;
  if(id==='vitality')maxHp=Math.round(maxHp*1.35);
  if(id==='evasive')dodgeChance=rank==='hidden'?.19:.16;
  if(id==='regen')regenPct=.06;
 });
 const enemyLevel=rank==='boss'?Math.max(1,Math.round(s.level*bossMultiplier)):s.level;
 return {...e,index,rank,traits,maxHp,hp:maxHp,atk:Math.round(e.atk*factor*mult.atk*bossMultiplier),def:enemyDef,armorReduction,dodgeChance,regenPct,
  xp:Math.round(e.xp*factor*mult.xp*(rank==='boss'?bossMultiplier:1)),gold:Math.round(e.gold*factor*mult.gold*(rank==='boss'?bossMultiplier:1)),level:enemyLevel,turnsAlive:0,
  bossNumber:rank==='boss'?(s.bossDefeated||0)+1:0,bossMultiplier,
  bossPhase:1,phase1MaxHp:rank==='boss'?maxHp:0,phase2MaxHp:0,phase2BuffApplied:false};
}
function randomEncounter(){
 // Sau mỗi 7 chiến thắng, lần thám hiểm kế tiếp là một trận Boss.
 if(s.wins>0&&s.wins%7===0)return scaleEnemy(4,'boss');
 const unlocked=Math.min(4,1+Math.floor((s.level-1)/2));
 const index=Math.floor(Math.random()*unlocked);
 const roll=Math.random();
 if(roll<.07)return scaleEnemy(5,'hidden');       // 7% quái ẩn
 if(roll<.29)return scaleEnemy(index,'elite');    // 22% tinh anh
 return scaleEnemy(index,'normal');               // 71% thường
}
function normalizeEnemy(e){
 if(!e)return null;
 const rank=e.rank||(e.boss?'boss':'normal');
 const normalized={...e,rank,traits:Array.isArray(e.traits)?e.traits:[],def:e.def||0,
  armorReduction:e.armorReduction||0,dodgeChance:e.dodgeChance||0,regenPct:e.regenPct||0,turnsAlive:e.turnsAlive||0,
  rank:rankInfo[rank]?rank:'normal'};
 if(normalized.boss){
  normalized.bossPhase=normalized.bossPhase===2?2:1;
  normalized.phase1MaxHp=Number.isFinite(normalized.phase1MaxHp)&&normalized.phase1MaxHp>0?normalized.phase1MaxHp:normalized.maxHp;
  normalized.phase2MaxHp=Number.isFinite(normalized.phase2MaxHp)?normalized.phase2MaxHp:0;
  normalized.phase2BuffApplied=!!normalized.phase2BuffApplied;
 }
 return normalized;
}
function setEnemy(index=null,rank='normal'){
 s.enemy=index===null?randomEncounter():scaleEnemy(index,rank);
 s.enemyIndex=s.enemy.index;
 s.wonCurrent=false;s.guarding=false;s.turn=1;
}
function say(text){s.log.push(text);if(s.log.length>45)s.log.shift();$('log').innerHTML=s.log.map(x=>'<div>'+x+'</div>').join('');$('log').scrollTop=$('log').scrollHeight}
function notice(t){$('notice').textContent=t}
function popup(title,text,icon='✨'){ $('modalTitle').textContent=title;$('modalText').textContent=text;$('modalIcon').textContent=icon;$('modal').classList.add('show')}
function closePopup(){$('modal').classList.remove('show')}
function save(show=false,force=false){
 if(!force&&['playerAction','enemy','enemyAction'].includes(phase)){if(show)notice('Lượt đánh đang diễn ra. Hãy chờ đến lượt tiếp theo để lưu.');return false}
 try{
  const data={state:s,savedAt:new Date().toISOString()};
  localStorage.setItem(KEY,JSON.stringify(data));
  if(activeAccount){
   fetch('/api/save',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:s})})
    .then(r=>r.ok?r.json():Promise.reject(new Error('cloud save failed')))
    .then(data=>{
     $('saveStatus').textContent='☁️ Đã lưu trên tài khoản';
     if(data.loot&&data.loot.length){
      const names=data.loot.map(x=>x.name).join(', ');
      notice('🎁 Nhặt được vật phẩm giao dịch: '+names+'.');
      refreshTradeData();
     }
    })
    .catch(()=>$('saveStatus').textContent='💾 Đã lưu trên máy · Cloud chưa đồng bộ');
  }
  $('saveStatus').textContent=activeAccount?'☁️ Đang đồng bộ...':'💾 Đã tự lưu';
  if(show)notice('Đã lưu tiến trình thành công!');return true;
 }catch(e){$('saveStatus').textContent='⚠️ Không lưu được';notice('Trình duyệt không cho phép lưu dữ liệu.')}
}
function validState(v){
 return v&&(v.version===2||v.version===3||v.version===4||v.version===5)&&Number.isInteger(v.level)&&v.level>=1&&v.level<1000&&
 Number.isFinite(v.hp)&&Number.isFinite(v.gold)&&Number.isFinite(v.xp)&&
 v.enemy&&Number.isFinite(v.enemy.hp)&&Number.isFinite(v.enemy.maxHp)&&
 Array.isArray(v.log)&&v.log.length<100;
}
function load(show=false){
 try{
  const raw=localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY);if(!raw){if(show)notice('Chưa có bản lưu trên thiết bị này.');return false}
  const data=JSON.parse(raw);if(!validState(data.state))throw Error('invalid');
  s={...base(),...data.state,bought:{...base().bought,...data.state.bought},questClaimed:{...base().questClaimed,...data.state.questClaimed}};
  s.version=5;
  s.bossDefeated=Number.isFinite(s.bossDefeated)?s.bossDefeated:0;
  s.deaths=Number.isFinite(s.deaths)?s.deaths:0;
  s.totalGoldLost=Number.isFinite(s.totalGoldLost)?s.totalGoldLost:0;
  s.reviveAvailable=typeof data.state.reviveAvailable==='boolean'?data.state.reviveAvailable:true;
  s.enemy=normalizeEnemy(data.state.enemy);
  phase=s.hp<=0?'lost':(s.wonCurrent?'won':'player');busy=phase!=='player';
  render();
  $('saveStatus').textContent='💾 Đã tải bản lưu';
  if(show)notice('Đã khôi phục tiến trình của bạn.');
  return true;
 }catch(e){notice('Bản lưu bị lỗi hoặc không hợp lệ.');return false}
}
function updateTurnStatus(){
 const banner=$('turnStatus');
 banner.className='turnBanner';
 const states={
  player:['LƯỢT CỦA BẠN','Đến lượt Astra — hãy chọn một hành động.','Bạn hành động trước. Sau khi chọn lệnh, đối thủ mới phản công.',''],
  playerAction:['ASTRA ĐANG HÀNH ĐỘNG','Kỹ năng của bạn đang được thực hiện...','Đang xử lý hành động của Astra. Vui lòng chờ.','busy-turn'],
  enemy:['LƯỢT CỦA ĐỐI THỦ','Đến lượt '+(s.enemy?.name||'đối thủ')+'.','Bạn đã chọn xong. Đối thủ chuẩn bị phản công.','enemy-turn'],
  enemyAction:['ĐỐI THỦ ĐANG TẤN CÔNG','Đòn đánh của đối thủ đang diễn ra...','Đợi đòn đánh kết thúc để đến lượt tiếp theo.','enemy-turn'],
  won:['CHIẾN THẮNG!','Bạn đã đánh bại đối thủ.','Nhấn “Đối thủ tiếp theo” khi bạn đã sẵn sàng.','won-turn'],
  lost:['ASTRA ĐÃ GỤC NGÃ','Hành trình tạm dừng.','Mở Thành phố và nghỉ tại quán trọ để hồi phục.','lost-turn']
 };
 const v=states[phase]||states.player;
 banner.className='turnBanner '+v[3];
 $('turnTitle').textContent=v[0];$('turnSubtitle').textContent=v[1];$('combatHint').textContent=v[2];
}
function animateFighter(id,cls){
 const el=$(id);el.classList.remove('attack-anim','hit-anim');
 void el.offsetWidth;el.classList.add(cls);
 setTimeout(()=>el.classList.remove(cls),520);
}
function startBossPhaseTwo(){
 const e=s.enemy;
 if(!e||!e.boss||e.bossPhase===2||e.phase2BuffApplied)return false;
 e.bossPhase=2;
 e.phase2BuffApplied=true;
 e.phase1MaxHp=e.phase1MaxHp||e.maxHp;
 // Thanh máu thứ hai được làm đầy; mọi chỉ số chiến đấu cốt lõi tăng đúng 7.
 e.maxHp+=7;
 e.hp=e.maxHp;
 e.atk+=7;
 e.def=(e.def||0)+7;
 e.level=(e.level||1)+7;
 // Nội tại phụ cũng mạnh hơn 7 điểm phần trăm, có giới hạn để tránh mất cân bằng.
 e.armorReduction=Math.min(.70,(e.armorReduction||0)+.07);
 e.dodgeChance=Math.min(.45,(e.dodgeChance||0)+.07);
 e.regenPct=Math.min(.30,(e.regenPct||0)+.07);
 e.phase2MaxHp=e.maxHp;
 e.turnsAlive=0;
 say('<span class="bad">🐉 BOSS PHÁ VỠ THANH MÁU THỨ NHẤT! HẮC HÓA — GIAI ĐOẠN 2 BẮT ĐẦU!</span>');
 say('<span class="gold">Tất cả chỉ số Boss tăng +7: HP tối đa, ATK, DEF và cấp độ. Nội tại phòng thủ, né tránh, tái tạo cũng được cường hóa.</span>');
 popup('BOSS · GIAI ĐOẠN 2','Boss đã hồi đầy thanh máu thứ hai. HP tối đa, tấn công, phòng thủ và cấp độ tăng +7. Các nội tại cũng mạnh hơn!','🐉');
 return true;
}
function render(){
 $('chapter').textContent=s.area+1;$('goldTop').textContent=s.gold;
 $('heroName').textContent=s.name;$('level').textContent=s.level;$('sceneLevel').textContent=s.level;
 $('hpText').textContent=s.hp+' / '+s.maxHp;$('mpText').textContent=s.mp+' / '+s.maxMp;
 $('xpText').textContent=s.xp+' / '+maxXp();
 $('hpBar').style.width=Math.max(0,s.hp/s.maxHp*100)+'%';
 $('mpBar').style.width=Math.max(0,s.mp/s.maxMp*100)+'%';
 $('xpBar').style.width=Math.max(0,s.xp/maxXp()*100)+'%';
 $('sceneHpText').textContent=s.hp+' / '+s.maxHp;
 $('sceneHpBar').style.width=Math.max(0,s.hp/s.maxHp*100)+'%';
 $('sceneLevelHud').textContent=s.level;
 $('partyHpHudText').textContent=s.hp+' / '+s.maxHp;
 $('partyHpHud').style.width=Math.max(0,s.hp/s.maxHp*100)+'%';
 $('atk').textContent=atk();$('def').textContent=def();
 $('potions').textContent=s.potions;$('wins').textContent=s.wins;
 $('reviveStatus').textContent=s.reviveAvailable?'Còn 1 mạng':'Đã sử dụng';
 $('reviveStatus').className=s.reviveAvailable?'reviveReady':'reviveUsed';
 $('bossCount').textContent=s.bossDefeated||0;$('deathCount').textContent=(s.deaths||0)+' · mất '+(s.totalGoldLost||0)+' vàng';
 $('weaponName').textContent=s.weapon;$('weaponDesc').textContent='+'+s.weaponBonus+' ATK';
 $('armorName').textContent=s.armor;$('armorDesc').textContent='+'+s.armorBonus+' DEF';
 const e=s.enemy;
 if(e){
  $('enemySprite').textContent=e.icon;$('enemyName').textContent=e.name;
  $('enemyDesc').textContent=e.desc;$('enemyHpText').textContent=e.hp+' / '+e.maxHp;
  $('enemyHpBar').style.width=Math.max(0,e.hp/e.maxHp*100)+'%';
  $('enemyHudName').textContent=e.name;
  $('enemyHudRank').textContent=(rankInfo[e.rank||'normal']||rankInfo.normal).label+' · LV '+e.level;
  $('enemyHpHudText').textContent=e.hp+' / '+e.maxHp;
  $('enemyHpHud').style.width=Math.max(0,e.hp/e.maxHp*100)+'%';
  const rank=e.rank||'normal', rankMeta=rankInfo[rank]||rankInfo.normal;
  $('enemyRank').textContent=rankMeta.icon+' '+rankMeta.label;
  $('enemyRank').className='rankBadge '+rank;
  $('enemyLevel').textContent=rankMeta.label+' · Cấp '+e.level;
  $('enemyLevelSmall').textContent='LV '+e.level;
  const traitNames=(e.traits||[]).map(id=>(traitBook[id]?.icon||'✦')+' '+(traitBook[id]?.name||id));
  $('enemyTraitShort').textContent=traitNames.length?traitNames.join(' · '):'Không nội tại';
  $('enemyTraitInfo').textContent=traitNames.length?(e.traits||[]).map(id=>traitBook[id]?.desc||'').filter(Boolean).join(' '):'Không có nội tại đặc biệt';
  const bossBars=$('bossPhaseBars');
  if(e.boss){
   bossBars.style.display='block';
   const p1Max=e.phase1MaxHp||e.maxHp;
   const p1Hp=e.bossPhase===2?0:e.hp;
   const p2Max=e.phase2MaxHp||0;
   const p2Hp=e.bossPhase===2?e.hp:0;
   $('bossP1Bar').style.width=(p1Max?Math.max(0,p1Hp/p1Max*100):0)+'%';
   $('bossP2Bar').style.width=(p2Max?Math.max(0,p2Hp/p2Max*100):0)+'%';
   $('bossP1Text').textContent=e.bossPhase===2?'ĐÃ PHÁ HỦY':'HP '+p1Hp+' / '+p1Max;
   $('bossP2Text').textContent=e.bossPhase===2?'HP '+p2Hp+' / '+p2Max:'Chưa mở khóa';
   $('bossPhaseNotice').textContent=e.bossPhase===2?'🔥 BOSS · GIAI ĐOẠN 2 / 2':'🐉 BOSS · GIAI ĐOẠN 1 / 2';
  }else{
   bossBars.style.display='none';
  }
 }
 $('areaName').textContent='🌲 '+(s.area===0?'Rừng Nguyệt Ảnh':s.area===1?'Thung Lũng Sương':'Hang Rồng Đen');
 $('turn').textContent=s.turn;
 busy=phase!=='player';
 $('skillBtn').disabled=busy||s.mp<12;
 $('potionBtn').disabled=busy||s.potions<1||s.hp>=s.maxHp;
 $('attackBtn').disabled=busy;$('guardBtn').disabled=busy;$('runBtn').disabled=busy;
 $('nextBtn').style.display=phase==='won'?'block':'none';
 $('restBtn').disabled=busy&&(phase!=='lost'&&phase!=='won')||(s.hp===s.maxHp&&s.mp===s.maxMp);
 $('buyPotionBtn').disabled=busy||s.gold<18;$('buySwordBtn').disabled=busy||s.bought.sword||s.gold<90;
 $('buyArmorBtn').disabled=busy||s.bought.armor||s.gold<85;
 $('travelBtn').disabled=busy||s.level<3;
 $('saveBtn').disabled=busy;$('exportBtn').disabled=busy;$('loadBtn').disabled=busy;$('importBtn').disabled=busy;$('newBtn').disabled=busy;
 renderInventory();renderQuests();updateTurnStatus();
}
function enemyAttack(){
 const e=s.enemy;
 e.turnsAlive=(e.turnsAlive||0)+1;
 if(e.regenPct>0&&e.hp<e.maxHp){
  const healed=Math.min(e.maxHp-e.hp,Math.max(1,Math.round(e.maxHp*e.regenPct)));
  e.hp+=healed;say('<span class="good">🌿 '+e.name+' tái tạo '+healed+' HP nhờ nội tại Tái tạo.</span>');
 }
 const bossBurst=!!e.boss&&e.turnsAlive%3===0;
 let damage=Math.max(1,e.atk-def()+Math.floor(Math.random()*5));
 if(bossBurst){damage=Math.round(damage*1.45);say('<span class="bad">🐉 Boss dùng Hắc Long Chấn — đòn đánh mạnh hơn!</span>')}
 if(s.guarding)damage=Math.max(1,Math.floor(damage*.35));
 s.hp=Math.max(0,s.hp-damage);s.guarding=false;
 say('<span class="bad">'+e.name+' phản công, gây '+damage+' sát thương.</span>');
 if(s.hp<=0){
  s.hp=0;
  s.deaths=(s.deaths||0)+1;
  if(s.deaths>=2){
   const penalty=Math.min(s.gold,Math.max(1,Math.ceil(s.gold*.10)));
   s.gold-=penalty;s.totalGoldLost=(s.totalGoldLost||0)+penalty;
   say('<span class="bad">💸 Lần gục ngã thứ '+s.deaths+': mất '+penalty+' vàng (10% số vàng đang có). Tổng vàng đã mất: '+s.totalGoldLost+'.</span>');
  }else{
   say('<span class="good">Lần gục ngã đầu tiên: không bị trừ vàng.</span>');
  }
  if(s.reviveAvailable){
   s.reviveAvailable=false;s.hp=Math.max(1,Math.ceil(s.maxHp*.5));s.mp=Math.max(s.mp,Math.ceil(s.maxMp*.3));
   phase='player';
   say('<span class="gold">💫 MẠNG HỒI SINH MIỄN PHÍ! Astra đứng dậy với 50% HP và được bảo toàn hành trình. Mạng này đã sử dụng.</span>');
   popup('Hồi sinh miễn phí!','Astra đã được hồi sinh một lần duy nhất với 50% HP. Từ giờ hãy cẩn thận — mạng miễn phí đã dùng hết!','💫');
  }else{
   phase='lost';busy=true;
   say('<span class="bad">Astra đã gục ngã và không còn mạng hồi sinh miễn phí.</span>');
   popup('Astra đã gục ngã','Mạng hồi sinh miễn phí đã được sử dụng. Hãy đến Thành phố và nghỉ tại quán trọ để hồi phục rồi tiếp tục.','💫');
  }
 }else{
  phase='player';
  say('<span class="good">Đến lượt Astra! Hãy chọn hành động tiếp theo.</span>');
 }
}
function enemyTurn(){
 phase='enemy';render();
 say('<span class="bad">Đến lượt '+s.enemy.name+'...</span>');
 actionTimer=setTimeout(()=>{
  phase='enemyAction';render();animateFighter('enemyFighter','attack-anim');
  actionTimer=setTimeout(()=>{
   animateFighter('playerFighter','hit-anim');enemyAttack();s.turn++;
   render();save();
  },560);
 },430);
}
function playerAction(options){
 if(phase!=='player'||s.hp<=0||s.wonCurrent)return;
 if(options.costMp&&s.mp<options.costMp){notice('Bạn không đủ MP để dùng kỹ năng này.');return}
 if(options.usePotion&&(s.potions<1||s.hp>=s.maxHp)){notice('Bạn hiện không thể dùng bình hồi phục.');return}
 if(options.costMp)s.mp-=options.costMp;
 if(options.usePotion)s.potions--;
 phase='playerAction';render();
 animateFighter('playerFighter','attack-anim');
 say('<span class="good">'+options.message+'</span>');
 actionTimer=setTimeout(()=>{
  if(options.damage){
   const e=s.enemy;
   if(Math.random()<(e.dodgeChance||0)){
    say('<span class="bad">💨 '+e.name+' né được đòn đánh! Nội tại Né tránh đã phát huy tác dụng.</span>');
   }else{
    const raw=Math.max(1,Math.round(options.damage));
    let dealt=Math.max(1,raw-(e.def||0));
    if(e.armorReduction)dealt=Math.max(1,Math.round(dealt*(1-e.armorReduction)));
    s.enemy.hp=Math.max(0,e.hp-dealt);
    say('<span class="good">'+(options.label||'Astra')+' gây '+dealt+' sát thương!'+((e.def||0)>0?' (đã bị giảm bởi phòng thủ)':'')+(e.armorReduction?' (giáp cứng hấp thụ thêm sát thương)':'')+'</span>');
    animateFighter('enemyFighter','hit-anim');
   }
  }
  if(options.heal){
   const restored=Math.min(options.heal,s.maxHp-s.hp);s.hp+=restored;
   say('<span class="good">Astra hồi phục '+restored+' HP.</span>');
  }
  if(options.guard){s.guarding=true;s.mp=Math.min(s.maxMp,s.mp+5);say('<span class="good">Lá chắn giảm sát thương đòn kế tiếp. Astra hồi 5 MP.</span>')}
  render();
  if(s.enemy.hp<=0){
   if(startBossPhaseTwo()){
    render();
    save(false,true);
    enemyTurn();
    return;
   }
   victory();
   return;
  }
  enemyTurn();
 },520);
}
function attack(){
 playerAction({damage:atk()+Math.floor(Math.random()*7)-2,label:'Chém thường',message:'Astra lao lên với một nhát chém!'});
}
function skill(){
 playerAction({costMp:12,damage:atk()*2+Math.floor(Math.random()*10),label:'Nguyệt Trảm',message:'Astra tích tụ ánh trăng cho kỹ năng Nguyệt Trảm!'});
}
function potion(){
 playerAction({usePotion:true,heal:55,message:'Astra sử dụng bình hồi phục.'});
}
function guard(){
 playerAction({guard:true,message:'Astra giương kiếm tạo thế phòng thủ!'});
}
function run(){
 if(phase!=='player'||s.wonCurrent)return;
 if(s.enemy.boss){notice('Không thể rút lui trước Boss!');return}
 phase='playerAction';render();say('Astra đang rút lui khỏi trận chiến...');
 actionTimer=setTimeout(()=>{
  const retreatPool=Math.min(4,1+Math.floor((s.level-1)/2));
  setEnemy(Math.floor(Math.random()*retreatPool),'normal');phase='player';
  say('<span class="good">Bạn đã rút lui an toàn. Một quái vật thường khác đang chờ.</span>');
  render();save();
 },480);
}
function victory(){
 const e=s.enemy;s.wonCurrent=true;phase='won';s.wins++;
 s.gold+=e.gold;s.xp+=e.xp;s.mp=Math.min(s.maxMp,s.mp+6);
 say('<span class="gold">Chiến thắng! +'+e.xp+' EXP · +'+e.gold+' vàng.</span>');
 let leveled=false;
 while(s.xp>=maxXp()){
  s.xp-=maxXp();s.level++;s.maxHp+=18;s.maxMp+=7;s.baseAtk+=3;s.baseDef+=2;
  s.hp=s.maxHp;s.mp=s.maxMp;leveled=true;
  say('<span class="gold">✦ LÊN CẤP '+s.level+'! HP, MP, ATK và DEF tăng lên.</span>');
 }
 if(e.boss){s.bossDefeated=(s.bossDefeated||0)+1;s.area++;say('<span class="gold">Bạn đã đánh bại Boss #'+(e.bossNumber||s.bossDefeated)+' (hệ số x'+(e.bossMultiplier||2)+') và mở khóa chương tiếp theo!</span>')}
 if(e.rank==='hidden')say('<span class="gold">Bạn đã hạ gục sinh vật ẩn và nhận phần thưởng hiếm!</span>')
 if(e.rank==='elite')say('<span class="gold">Quái tinh anh bị đánh bại — phần thưởng tăng cường đã thuộc về bạn!</span>')
 render();save();
 if(leveled)popup('Thăng cấp!','Astra đã đạt cấp '+s.level+'. Toàn bộ sinh lực và năng lượng được hồi phục!','⭐');
}
function nextEnemy(){
 if(!s.wonCurrent)return;
 setEnemy(null);phase='player';
 const e=s.enemy;
 if(e.rank==='boss')say('<span class="bad">🔴 BOSS XUẤT HIỆN! '+e.name+' chặn đường bạn sau chuỗi 7 chiến thắng!</span>');
 else if(e.rank==='hidden')say('<span class="gold">✨ GẶP QUÁI ẨN! Một sinh vật hiếm bất ngờ xuất hiện trong màn sương...</span>');
 else if(e.rank==='elite')say('<span class="gold">⚔️ QUÁI TINH ANH XUẤT HIỆN! '+e.name+' mạnh hơn quái thường và sở hữu nội tại đặc biệt.</span>');
 else say('Bạn bắt gặp '+e.name+' trong chuyến thám hiểm.');
 render();save();
}
function rest(){
 if(phase!=='won'&&phase!=='lost'){notice('Hãy kết thúc trận chiến trước khi nghỉ tại quán trọ.');return}
 const innCost=Math.min(20,s.gold);
 s.gold-=innCost;s.hp=s.maxHp;s.mp=s.maxMp;phase=s.wonCurrent?'won':'player';busy=phase!=='player';closePopup();
 say('<span class="good">Nghỉ tại quán trọ. HP và MP đã hồi đầy.</span>');
 notice('Bạn đã nghỉ ngơi và hồi phục hoàn toàn. Chi phí: '+innCost+' vàng.');render();save();
}
function buyPotion(){
 if(phase!=='won'&&phase!=='lost'){notice('Hãy kết thúc trận chiến trước khi mua sắm.');return}
 if(s.gold<18)return;s.gold-=18;s.potions++;
 say('Bạn mua 1 bình hồi phục.');render();save();
}
function buySword(){
 if(phase!=='won'&&phase!=='lost'){notice('Hãy kết thúc trận chiến trước khi mua sắm.');return}
 if(s.bought.sword||s.gold<90)return;
 s.gold-=90;s.weaponBonus+=7;s.weapon='Kiếm Bạc';s.bought.sword=true;
 say('<span class="good">Trang bị Kiếm Bạc! ATK +7.</span>');render();save();
}
function buyArmor(){
 if(phase!=='won'&&phase!=='lost'){notice('Hãy kết thúc trận chiến trước khi mua sắm.');return}
 if(s.bought.armor||s.gold<85)return;
 s.gold-=85;s.armorBonus+=5;s.armor='Giáp Lam Nguyệt';s.bought.armor=true;
 say('<span class="good">Trang bị Giáp Lam Nguyệt! DEF +5.</span>');render();save();
}
function travel(){
 if(phase!=='won'){notice('Hãy thắng trận hiện tại trước khi thám hiểm sang vùng mới.');return}
 if(s.level<3)return;
 s.area++;setEnemy(null);
 say('<span class="gold">Bạn tiến đến vùng đất mới: '+(s.area+1)+'.</span>');
 render();save();
}
function renderInventory(){
 $('inventory').innerHTML=
 `<div class="item"><div>🧪 <b>Bình hồi phục × ${s.potions}</b><small>Hồi tối đa 55 HP trong trận.</small></div><button ${s.potions<1||s.hp>=s.maxHp?'disabled':''} id="bagPotion">Dùng</button></div>
 <div class="item"><div>🗡️ <b>${s.weapon}</b><small>Tổng sức tấn công: ${atk()}</small></div><span>Đang dùng</span></div>
 <div class="item"><div>🛡️ <b>${s.armor}</b><small>Tổng phòng thủ: ${def()}</small></div><span>Đang dùng</span></div>`;
 const b=$('bagPotion');if(b)b.onclick=potion;
}
function renderQuests(){
 const q=[
  ['first','Hạ gục 1 kẻ địch','Thắng trận đầu tiên','30 vàng',s.wins>=1,30],
  ['slimes','Trở thành thợ săn','Đánh bại 5 kẻ địch','60 vàng',s.wins>=5,60],
  ['level','Tiến bước','Đạt cấp độ 3','1 bình hồi phục',s.level>=3,1]
 ];
 $('quests').innerHTML=q.map(x=>{
  const claimed=s.questClaimed[x[0]];
  return `<div class="quest"><b>📜 ${x[1]}</b><p>${x[2]}</p><small>Phần thưởng: ${x[3]} · ${x[4]?'Đã hoàn thành':'Chưa hoàn thành'}</small><br><button data-quest="${x[0]}" ${!x[4]||claimed?'disabled':''}>${claimed?'Đã nhận':'Nhận thưởng'}</button></div>`;
 }).join('');
 $('quests').querySelectorAll('[data-quest]').forEach(b=>b.onclick=()=>claim(b.dataset.quest));
}
function claim(id){
 if(s.questClaimed[id])return;
 if(id==='first'&&s.wins<1||id==='slimes'&&s.wins<5||id==='level'&&s.level<3)return;
 s.questClaimed[id]=true;
 if(id==='first')s.gold+=30;
 if(id==='slimes')s.gold+=60;
 if(id==='level')s.potions++;
 say('<span class="gold">Đã nhận thưởng nhiệm vụ!</span>');render();save();
}
function switchTab(id){
 document.querySelectorAll('.section').forEach(x=>x.classList.remove('show'));
 document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x.dataset.tab===id));
 $(id).classList.add('show');
}
function newGame(){
 if(!confirm('Bắt đầu mới sẽ ghi đè tiến trình hiện tại. Bạn chắc chứ?'))return;
 s=base();phase='player';busy=false;setEnemy(0);$('log').innerHTML='';
 say('<span class="good">Astra đặt chân vào Rừng Nguyệt Ảnh. Hành trình mới bắt đầu!</span>');
 render();save();switchTab('battleTab');
}
function exportSave(){
 if(['playerAction','enemy','enemyAction'].includes(phase)){notice('Hãy đợi trận đấu kết thúc lượt hiện tại rồi xuất bản lưu.');return}
 save();const blob=new Blob([JSON.stringify({state:s,savedAt:new Date().toISOString()})],{type:'application/json'});
 const url=URL.createObjectURL(blob);const a=document.createElement('a');
 a.href=url;a.download='huyen-thoai-anh-trang-save.json';a.click();URL.revokeObjectURL(url);
 notice('Đã xuất file bản lưu.');
}
function importSave(){ $('fileInput').click() }
$('fileInput').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  const data=JSON.parse(await file.text());
  if(!validState(data.state))throw Error('invalid');
  s={...base(),...data.state,bought:{...base().bought,...data.state.bought},questClaimed:{...base().questClaimed,...data.state.questClaimed}};
  s.version=5;s.bossDefeated=Number.isFinite(s.bossDefeated)?s.bossDefeated:0;s.deaths=Number.isFinite(s.deaths)?s.deaths:0;s.totalGoldLost=Number.isFinite(s.totalGoldLost)?s.totalGoldLost:0;s.reviveAvailable=typeof data.state.reviveAvailable==='boolean'?data.state.reviveAvailable:true;s.enemy=normalizeEnemy(data.state.enemy);
  phase=s.hp<=0?'lost':(s.wonCurrent?'won':'player');busy=phase!=='player';render();save();
  notice('Đã nhập bản lưu thành công.');
 }catch(err){notice('File lưu không hợp lệ.')}
 e.target.value='';
});
$('attackBtn').onclick=attack;$('skillBtn').onclick=skill;$('potionBtn').onclick=potion;
$('guardBtn').onclick=guard;$('runBtn').onclick=run;$('nextBtn').onclick=nextEnemy;
$('restBtn').onclick=rest;$('buyPotionBtn').onclick=buyPotion;
$('buySwordBtn').onclick=buySword;$('buyArmorBtn').onclick=buyArmor;
$('travelBtn').onclick=travel;$('saveBtn').onclick=()=>save(true);
$('loadBtn').onclick=()=>{if(load(true)){phase=s.hp<=0?'lost':(s.wonCurrent?'won':'player');busy=phase!=='player';render()}};
$('exportBtn').onclick=exportSave;$('importBtn').onclick=importSave;
$('newBtn').onclick=newGame;$('modalOk').onclick=closePopup;
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
window.addEventListener('pagehide',()=>{if(phase==='player'||phase==='won'||phase==='lost')save()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&(phase==='player'||phase==='won'||phase==='lost'))save()});
let restored=load();
if(!restored){setEnemy(0);render();save();say('Một Slime Nguyệt xuất hiện! Đến lượt Astra.')}
else{phase=s.hp<=0?'lost':(s.wonCurrent?'won':'player');busy=phase!=='player';render();say('<span class="good">Đã khôi phục hành trình từ bản lưu trên thiết bị.</span>')}


// ===== ACCOUNT, SECURE RECOVERY, CLOUD SAVE AND PLAYER TRADING =====
let recoveryTicket=null;
let recoveryQuestionSet=[];
const recoveryFields=[
 ['artist','Ca sĩ / nghệ sĩ bạn yêu thích là ai?'],
 ['food','Món ăn bạn yêu thích là gì?'],
 ['game','Tựa game bạn yêu thích là gì?'],
 ['color','Màu sắc bạn yêu thích là gì?'],
 ['nickname','Biệt danh bạn muốn dùng trong game là gì?']
];
const itemNames={moon_shard:'Mảnh trăng',slime_core:'Lõi Slime',wolf_fang:'Nanh Sói',forest_crystal:'Tinh thể rừng'};
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function apiCall(path,body,method='POST'){
 const opts={method,credentials:'same-origin',headers:{'Accept':'application/json'}};
 if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}
 const response=await fetch(path,opts);
 const data=await response.json().catch(()=>({error:'Phản hồi máy chủ không hợp lệ.'}));
 if(!response.ok){const error=new Error(data.error||'Có lỗi xảy ra.');error.data=data;error.status=response.status;throw error;}
 return data;
}
function authMessage(text,isError=false){
 const el=$('authMessage');if(el){el.textContent=text;el.style.color=isError?'#ff9eaf':'#9ee9c2';}
}
function accountView(){
 $('authForms').classList.toggle('hiddenUI',!!activeAccount);
 $('accountLogged').style.display=activeAccount?'block':'none';
 $('authStatus').textContent=activeAccount?'Đã đăng nhập':'Chưa đăng nhập';
 if(activeAccount){$('accountName').textContent=activeAccount.username;}
}
function renderRegistrationQuestions(){
 $('registrationAnswers').innerHTML=recoveryFields.map(([id,q])=>
  `<label>${escapeHTML(q)}</label><input id="regAnswer_${id}" maxlength="120" autocomplete="off" placeholder="Câu trả lời của bạn">`
 ).join('');
}
function renderRecoveryQuestions(list){
 recoveryQuestionSet=list;
 $('recoveryQuestions').innerHTML=list.map(q=>
  `<div><label>${escapeHTML(q.question)}</label><input data-recovery-id="${escapeHTML(q.id)}" maxlength="120" autocomplete="off" placeholder="Nhập câu trả lời đã thiết lập"></div>`
 ).join('');
 $('recoveryStep').classList.remove('hiddenUI');
}
async function loadCloudSave(){
 try{
  const remote=await apiCall('/api/save',undefined,'GET');
  if(remote.state && validState(remote.state)){
   s={...base(),...remote.state,bought:{...base().bought,...(remote.state.bought||{})},questClaimed:{...base().questClaimed,...(remote.state.questClaimed||{})}};
   s.version=5;
   s.bossDefeated=Number.isFinite(s.bossDefeated)?s.bossDefeated:0;
   s.deaths=Number.isFinite(s.deaths)?s.deaths:0;
   s.totalGoldLost=Number.isFinite(s.totalGoldLost)?s.totalGoldLost:0;
   s.reviveAvailable=typeof s.reviveAvailable==='boolean'?s.reviveAvailable:true;
   s.enemy=normalizeEnemy(s.enemy);
   phase=s.hp<=0?'lost':(s.wonCurrent?'won':'player');busy=phase!=='player';
   render();
   say('<span class="good">Đã tải tiến trình từ tài khoản '+escapeHTML(activeAccount.username)+'.</span>');
  }else{
   s=base();phase='player';busy=false;setEnemy(0);render();save();
   say('<span class="good">Tài khoản mới: đã tạo hành trình riêng trên máy chủ.</span>');
  }
 }catch(e){notice('Không tải được tiến trình tài khoản: '+e.message);}
}
async function refreshTradeData(){
 if(!activeAccount)return;
 try{
  const data=await apiCall('/api/trades',undefined,'GET');
  const inv=data.inventory||{};
  $('tradeInventory').innerHTML=Object.entries(data.items||itemNames).map(([id,name])=>
   `<div class="item"><div>💠 <b>${escapeHTML(name)}</b><small>Mã vật phẩm: ${escapeHTML(id)}</small></div><strong>× ${inv[id]||0}</strong></div>`
  ).join('');
  const options=Object.entries(data.items||itemNames).map(([id,name])=>`<option value="${escapeHTML(id)}">${escapeHTML(name)} (có ${inv[id]||0})</option>`).join('');
  $('giveItem').innerHTML=options;$('wantItem').innerHTML=options;
  if($('wantItem').options.length>1)$('wantItem').selectedIndex=1;
  if(!data.trades.length){$('tradeOffers').textContent='Chưa có đề nghị trao đổi.';return;}
  $('tradeOffers').innerHTML=data.trades.map(t=>{
   const pending=t.status==='pending';
   let controls='';
   if(pending&&t.incoming)controls=`<button data-trade-action="accept" data-trade-id="${t.id}">Chấp nhận</button><button data-trade-action="reject" data-trade-id="${t.id}">Từ chối</button>`;
   if(pending&&!t.incoming)controls=`<button data-trade-action="cancel" data-trade-id="${t.id}">Hủy đề nghị</button>`;
   const status={pending:'Đang chờ',accepted:'Đã hoàn tất',rejected:'Đã từ chối',cancelled:'Đã hủy'}[t.status]||t.status;
   return `<div class="tradeOffer"><b>#${t.id} · ${t.incoming?'Từ '+escapeHTML(t.from):'Gửi đến '+escapeHTML(t.to)}</b><br>Đổi: <b>${t.give_qty} ${escapeHTML(t.give_name)}</b> ↔ <b>${t.want_qty} ${escapeHTML(t.want_name)}</b><br>Trạng thái: ${status}<br>${controls}</div>`;
  }).join('');
  $('tradeOffers').querySelectorAll('[data-trade-action]').forEach(btn=>btn.onclick=async()=>{
   try{const result=await apiCall(`/api/trades/${btn.dataset.tradeId}/${btn.dataset.tradeAction}`,{});$('tradeMessage').textContent=result.message;await refreshTradeData();}
   catch(e){$('tradeMessage').textContent=e.message;}
  });
 }catch(e){$('tradeMessage').textContent=e.message;}
}
async function afterAuth(data){
 activeAccount=data.account;
 accountView();
 await loadCloudSave();
 await refreshTradeData();
 authMessage('Đã đăng nhập. Tiến trình được đồng bộ theo tài khoản.');
}
async function registerAccount(){
 const username=$('regUser').value.trim().toLowerCase();
 const password=$('regPass').value;
 const answers={};
 for(const [id] of recoveryFields)answers[id]=$('regAnswer_'+id).value.trim();
 try{const data=await apiCall('/api/register',{username,password,answers});await afterAuth(data);}
 catch(e){authMessage(e.message,true);}
}
async function loginAccount(){
 try{
  const data=await apiCall('/api/login',{username:$('loginUser').value.trim(),password:$('loginPass').value});
  await afterAuth(data);
 }catch(e){authMessage(e.message,true);}
}
async function logoutAccount(){
 try{
  if(activeAccount && (phase==='player'||phase==='won'||phase==='lost')){
   await apiCall('/api/save',{state:s});
   localStorage.setItem(KEY,JSON.stringify({state:s,savedAt:new Date().toISOString()}));
  }
  await apiCall('/api/logout',{});
  activeAccount=null;accountView();
  authMessage('Đã đăng xuất. Bản lưu trên máy vẫn được giữ.');
 }catch(e){authMessage(e.message,true);}
}
async function startRecovery(){
 recoveryTicket=null;$('resetStep').classList.add('hiddenUI');$('recoveryStep').classList.add('hiddenUI');
 try{
  const data=await apiCall('/api/recovery/start',{username:$('recoverUser').value.trim().toLowerCase()});
  renderRecoveryQuestions(data.questions);
  authMessage('Bộ câu hỏi ngẫu nhiên có hiệu lực trong 10 phút.');
 }catch(e){
  const secs=e.data?.retry_after;
  authMessage(secs?`${e.message} Còn ${Math.ceil(secs/60)} phút.`:e.message,true);
 }
}
async function verifyRecovery(){
 const answers={};
 $('recoveryQuestions').querySelectorAll('[data-recovery-id]').forEach(input=>answers[input.dataset.recoveryId]=input.value.trim());
 try{
  const data=await apiCall('/api/recovery/verify',{username:$('recoverUser').value.trim().toLowerCase(),answers});
  recoveryTicket=data.ticket;
  $('resetStep').classList.remove('hiddenUI');
  $('recoveryStep').classList.add('hiddenUI');
  authMessage('Xác minh đúng. Mã đặt lại có hiệu lực 5 phút.');
 }catch(e){
  const secs=e.data?.retry_after;
  authMessage(secs?`${e.message} Thử lại sau ${Math.ceil(secs/60)} phút.`:e.message,true);
 }
}
async function resetPassword(){
 try{
  const data=await apiCall('/api/recovery/reset',{username:$('recoverUser').value.trim().toLowerCase(),ticket:recoveryTicket,new_password:$('newPassword').value});
  recoveryTicket=null;$('resetStep').classList.add('hiddenUI');$('recoveryStep').classList.add('hiddenUI');
  $('loginUser').value=$('recoverUser').value.trim().toLowerCase();
  $('loginPass').value='';
  authMessage(data.message+' Bạn có thể đăng nhập bằng mật khẩu mới.');
 }catch(e){authMessage(e.message,true);}
}
async function createTrade(){
 const payload={
  to_username:$('tradeTo').value.trim().toLowerCase(),
  give_item:$('giveItem').value,give_qty:Number($('giveQty').value),
  want_item:$('wantItem').value,want_qty:Number($('wantQty').value)
 };
 try{
  const data=await apiCall('/api/trades',payload);
  $('tradeMessage').textContent=data.message;
  await refreshTradeData();
 }catch(e){$('tradeMessage').textContent=e.message;}
}
async function initAccount(){
 renderRegistrationQuestions();
 $('loginBtn').onclick=loginAccount;
 $('registerBtn').onclick=registerAccount;
 $('logoutBtn').onclick=logoutAccount;
 $('startRecoveryBtn').onclick=startRecovery;
 $('verifyRecoveryBtn').onclick=verifyRecovery;
 $('resetPasswordBtn').onclick=resetPassword;
 $('createTradeBtn').onclick=createTrade;
 $('refreshTradesBtn').onclick=refreshTradeData;
 accountView();
 try{
  const me=await apiCall('/api/me',undefined,'GET');
  await afterAuth({account:me});
 }catch(_){activeAccount=null;accountView();}
}
initAccount();

})();
