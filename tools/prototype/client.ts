// Mã chạy trong HTML (nhúng nguyên văn lúc dựng). PURE_JS chỉ có hàm thuần → test bằng new Function; UI_JS chạm DOM.
// Không dùng dấu ` và "${" trong chuỗi bên dưới.

export const PURE_JS = `
function blank(){return {v:{},a:{}}}
function ent(st,sid){return st.v[sid]||(st.v[sid]={verdict:"",note:""})}
function setVerdict(st,sid,verdict){var e=ent(st,sid);e.verdict=e.verdict===verdict?"":verdict;return st}
function setNote(st,sid,note){ent(st,sid).note=note;return st}
function setAnswer(st,qid,ans){st.a[qid]=ans;return st}
function unanswered(st,qs){return qs.filter(function(q){return !st.a[q.id]})}
function pendingText(n){return n?"Còn "+n+" câu cần anh/chị chốt":"Đã chốt hết câu hỏi"}
function buildFeedback(data,st,now){
 var done=data.questions.filter(function(q){return st.a[q.id]});
 return {prototype:{id:data.id,title:data.title,version:data.version},exportedAt:now,
  answers:done.map(function(q){return {id:q.id,question:q.text,answer:st.a[q.id]}}),
  unanswered:unanswered(st,data.questions).map(function(q){return {id:q.id,question:q.text}}),
  screens:data.screens.filter(function(s){var e=st.v[s.id];return e&&(e.verdict||e.note)}).map(function(s){var e=st.v[s.id];return {id:s.id,title:s.title,verdict:e.verdict||"none",note:e.note||""}})}
}
function feedbackText(fb){
 var L=["GÓP Ý BẢN MẪU «"+fb.prototype.title+"» (phiên bản "+fb.prototype.version+", "+fb.exportedAt.slice(0,10)+")"];
 function sec(h,xs){L.push("",h);if(!xs.length)L.push("- (không có)");xs.forEach(function(x){L.push(x)})}
 function by(v){return fb.screens.filter(function(s){return s.verdict===v})}
 sec("Câu đã chốt:",fb.answers.map(function(a){return "- "+a.question+" → "+a.answer}));
 sec("Câu chưa chốt:",fb.unanswered.map(function(a){return "- "+a.question}));
 sec("Màn hình cần sửa:",by("fix").map(function(s){return "- «"+s.title+"»"+(s.note?": "+s.note:"")}));
 sec("Màn hình đúng ý:",by("ok").map(function(s){return "- «"+s.title+"»"}));
 var n=by("none");if(n.length)sec("Ghi chú thêm:",n.map(function(s){return "- «"+s.title+"»: "+s.note}));
 return L.join("\\n")
}
function stepAt(flow,i){
 var n=flow.length;if(!n)return null;
 if(i<n)return {from:flow[i].from,role:flow[i].by,action:flow[i].action,to:flow[i].to,last:false,n:n,i:i};
 return {from:flow[n-1].to,role:flow[n-1].by,action:"",to:flow[n-1].to,last:true,n:n,i:n}
}
`;

export const UI_JS = `
var d=document,$=function(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s))};
var D=JSON.parse(d.getElementById("proto-data").textContent);
var KEY="proto:"+D.id+":"+D.version;
var st=(function(){try{var r=JSON.parse(localStorage.getItem(KEY)||"null");if(r&&r.v&&r.a)return r}catch(e){}return blank()})();
function save(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}}
var role="",cur=D.screens[0].id,walk=-1,fb=null,sel=d.getElementById("role");
function ok(el){var r=el.getAttribute("data-role");return !r||!role||r===role}
function roleName(k){var r=D.roles.filter(function(x){return x.key===k})[0];return r?r.label:k}
function title(id){var s=D.screens.filter(function(x){return x.id===id})[0];return s?s.title:id}
function showTab(k){$("[data-tab]").forEach(function(b){b.classList.toggle("on",b.getAttribute("data-tab")===k)});$("[data-pane]").forEach(function(p){p.hidden=p.getAttribute("data-pane")!==k})}
function paint(){
 var step=walk>=0?stepAt(D.flow,walk):null;
 if(step){cur=step.from;role=step.role;sel.value=role}
 $("[data-nav]").forEach(function(n){n.hidden=!ok(n)});
 var vis=$("[data-nav]").filter(function(n){return !n.hidden}).map(function(n){return n.getAttribute("data-nav")});
 if(!step&&vis.indexOf(cur)<0)cur=vis[0];
 $("[data-screen]").forEach(function(s){s.hidden=s.getAttribute("data-screen")!==cur});
 $("[data-nav]").forEach(function(n){n.classList.toggle("on",n.getAttribute("data-nav")===cur)});
 $("main .btn[data-role]").forEach(function(b){b.hidden=!ok(b)});
 $(".flow li").forEach(function(l){l.hidden=!ok(l)});
 $("[data-step]").forEach(function(g){var i=+g.getAttribute("data-step"),f=D.flow[i];g.classList.toggle("on",step?i===Math.min(walk,D.flow.length-1)&&!step.last:f.from===cur)});
 var wb=d.getElementById("walkbar");wb.hidden=!step;
 if(step){d.getElementById("walk-who").textContent="Bây giờ là: "+roleName(step.role);
  d.getElementById("walk-what").textContent=step.last?"Hết luồng — đang xem «"+title(step.to)+"»":"Bước "+(step.i+1)+"/"+step.n+": "+step.action+" → «"+title(step.to)+"»";
  wb.querySelector("[data-walk=back]").disabled=walk<=0;wb.querySelector("[data-walk=next]").disabled=step.last}
 $("[data-verdict]").forEach(function(b){var e=st.v[b.getAttribute("data-sid")];b.classList.toggle("on",!!e&&e.verdict===b.getAttribute("data-verdict"))});
 $("[data-qa]").forEach(function(b){b.classList.toggle("on",st.a[b.getAttribute("data-qa")]===b.getAttribute("data-val"))});
 $(".q").forEach(function(q){q.classList.toggle("done",!!st.a[q.getAttribute("data-q")])});
 var n=unanswered(st,D.questions).length;
 d.getElementById("pending").textContent=D.questions.length?pendingText(n):"";
 d.getElementById("pending").classList.toggle("zero",n===0);
 var qt=d.querySelector("[data-tab=questions]");if(qt)qt.textContent="Câu hỏi ("+n+")"
}
function openScreen(id){walk=-1;var s=D.screens.filter(function(x){return x.id===id})[0];if(s&&s.role&&role&&role!==s.role){role="";sel.value=""}cur=id;showTab("screens");paint()}
$("textarea[data-note]").forEach(function(t){var e=st.v[t.getAttribute("data-note")];if(e)t.value=e.note});
d.addEventListener("click",function(e){var t=e.target;if(!t.closest)return;var x;
 if((x=t.closest("[data-close]"))){var m=x.closest(".modal");if(m)m.hidden=true}
 if((x=t.closest("[data-nav]"))){openScreen(x.getAttribute("data-nav"));return}
 if((x=t.closest("[data-goto]"))){openScreen(x.getAttribute("data-goto"));return}
 if((x=t.closest("[data-step]"))){var f=D.flow[+x.getAttribute("data-step")];role=f.by;sel.value=role;openScreen(f.from);return}
 if((x=t.closest("[data-modal]"))){d.querySelector('[data-modal-box="'+x.getAttribute("data-modal")+'"]').hidden=false;return}
 if((x=t.closest("[data-toast]"))){var ts=d.getElementById("toast");ts.textContent=x.getAttribute("data-text");ts.className="toast "+x.getAttribute("data-toast");ts.hidden=false;clearTimeout(ts._t);ts._t=setTimeout(function(){ts.hidden=true},2800);return}
 if((x=t.closest("[data-state]"))){var box=x.closest(".states");$("[data-state]",box).forEach(function(c){c.classList.toggle("on",c===x)});$("[data-variant]",box).forEach(function(v){v.hidden=v.getAttribute("data-variant")!==x.getAttribute("data-state")});return}
 if((x=t.closest("[data-itab]"))){var tb=x.closest(".itabs");$("[data-itab]",tb).forEach(function(c){c.classList.toggle("on",c===x)});$("[data-ipane]",tb).forEach(function(v){v.hidden=v.getAttribute("data-ipane")!==x.getAttribute("data-itab")});return}
 if((x=t.closest("[data-tab]"))){showTab(x.getAttribute("data-tab"));return}
 if((x=t.closest("[data-device]"))){var ph=x.getAttribute("data-device")==="phone";d.body.classList.toggle("phone",ph);$("[data-device]").forEach(function(c){c.classList.toggle("on",c===x)});return}
 if((x=t.closest("[data-verdict]"))){setVerdict(st,x.getAttribute("data-sid"),x.getAttribute("data-verdict"));save();paint();return}
 if((x=t.closest("[data-qa]"))){setAnswer(st,x.getAttribute("data-qa"),x.getAttribute("data-val"));save();paint();return}
 if((x=t.closest("[data-walk]"))){var a=x.getAttribute("data-walk");if(a==="stop")walk=-1;else if(a==="next")walk=Math.min(walk+1,D.flow.length);else walk=Math.max(walk-1,0);showTab("screens");paint();return}
 if(t.closest("#walk-start")){if(D.flow.length){walk=0;showTab("screens");paint()}return}
 if(t.closest("#export")){fb=buildFeedback(D,st,new Date().toISOString());d.getElementById("exp-text").value=feedbackText(fb);d.getElementById("exp").hidden=false;return}
 if((x=t.closest("[data-exp]"))){var k=x.getAttribute("data-exp");
  if(k==="json"&&fb){var a2=d.createElement("a");a2.href=URL.createObjectURL(new Blob([JSON.stringify(fb,null,2)],{type:"application/json"}));a2.download="prototype-feedback.json";d.body.appendChild(a2);a2.click();a2.remove()}
  if(k==="copy"){var ta=d.getElementById("exp-text");ta.select();try{d.execCommand("copy")}catch(err){}}
  return}
});
d.addEventListener("input",function(e){var t=e.target;if(t.getAttribute&&t.getAttribute("data-note")){setNote(st,t.getAttribute("data-note"),t.value);save()}});
sel.addEventListener("change",function(e){role=e.target.value;paint()});
d.getElementById("review").addEventListener("change",function(e){d.body.classList.toggle("noreview",!e.target.checked)});
paint();
`;
