// CSS nội tuyến của bản mẫu. Token màu chép từ packages/web-kit/src/styles/tokens.css; sáng/tối theo prefers-color-scheme.
export const CSS = `
:root{--background:#f4f4f9;--foreground:#0a0a0a;--card:#fff;--muted:#f5f5f5;--muted-foreground:#6b6b6b;--primary:#4f46e5;--primary-foreground:#fff;--accent:#eef2ff;--border:#e5e5e5;--destructive:#b42318;--success:#05603f;--warning:#7f3c04;--radius:8px;--font:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif}
@media(prefers-color-scheme:dark){:root{--background:#0e0f1c;--foreground:#ececf4;--card:#17182a;--muted:#1d1f33;--muted-foreground:#a1a3b8;--primary:#818cf8;--primary-foreground:#0e0f1c;--accent:#24264a;--border:#2a2c44;--success:#6ee7a8;--warning:#fbbf24;--destructive:#f87171}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 var(--font);background:var(--background);color:var(--foreground)}
.ribbon{background:var(--warning);color:var(--card);text-align:center;padding:4px 8px;font-weight:600}
header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--card);border-bottom:1px solid var(--border)}
header h1{font-size:16px;margin:0;flex:1;min-width:160px}select,input,textarea{font:inherit;color:inherit;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:6px 8px}
.tabs button,.seg button{font:inherit;background:none;border:0;padding:6px 10px;cursor:pointer;color:var(--muted-foreground);border-bottom:2px solid transparent}.tabs button.on,.seg button.on{color:var(--primary);border-color:var(--primary)}
.pending{font-weight:600;color:var(--warning)}.pending.zero{color:var(--success)}
#walkbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:var(--primary);color:var(--primary-foreground)}#walkbar[hidden]{display:none}#walk-who{font-size:16px;font-weight:700}#walkbar .btn{margin:0;color:var(--foreground)}#walkbar .btn:disabled{opacity:.5;cursor:default}
.frame{transition:width .15s}body.phone .frame{width:375px;margin:12px auto;border:1px solid var(--border);border-radius:16px;overflow:hidden}
.layout{display:flex;min-height:calc(100vh - 120px)}nav{width:220px;padding:12px;border-right:1px solid var(--border);background:var(--card)}
nav button{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:none;border:0;border-radius:var(--radius);padding:8px 10px;cursor:pointer}nav button.on{background:var(--accent);color:var(--primary);font-weight:600}
main{flex:1;padding:20px;max-width:860px}.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px}
body.phone .layout{flex-direction:column;min-height:0}body.phone nav{width:auto;border-right:0;border-bottom:1px solid var(--border)}body.phone main{padding:12px}
h2{margin:0 0 12px}h3{margin:16px 0 6px}.field{display:block;margin:10px 0}.field>span{display:block;color:var(--muted-foreground);margin-bottom:2px}.field input[type=text],.field input:not([type]),.field select{width:100%;max-width:420px}.req{color:var(--destructive)}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left}th{color:var(--muted-foreground);font-weight:600}
.btn{font:inherit;border-radius:var(--radius);padding:8px 14px;cursor:pointer;margin:8px 8px 0 0;border:1px solid var(--border);background:var(--card);color:var(--foreground)}.btn.primary{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}.btn.danger{color:var(--destructive);border-color:var(--destructive)}
.banner{border-radius:var(--radius);padding:10px 12px;margin:10px 0;border:1px solid var(--border);background:var(--accent)}.banner.warn{border-color:var(--warning)}.banner.error{border-color:var(--destructive);color:var(--destructive)}
.steps{padding-left:20px}.steps li{margin:6px 0}.tag,.badge{font-size:12px;border-radius:99px;padding:1px 8px;background:var(--muted);color:var(--muted-foreground);border:1px solid var(--border)}.st-done .tag,.badge.ok{color:var(--success)}.st-open .tag,.badge.info{color:var(--primary)}.st-waiting .tag,.badge.wait,.badge.warn{color:var(--warning)}.badge.error{color:var(--destructive)}
.chips{margin:8px 0}.chip{font:inherit;border:1px solid var(--border);background:var(--card);color:inherit;border-radius:99px;padding:2px 10px;margin:2px 0 2px 6px;cursor:pointer}.chip.on{background:var(--primary);color:var(--primary-foreground)}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0}.stat{flex:1;min-width:110px;border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;background:var(--muted)}.stat b{display:block;font-size:22px}.stat span{color:var(--muted-foreground)}
.cards{display:grid;gap:8px;margin:10px 0}.icard{border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;background:var(--card)}.icard[data-goto]{cursor:pointer}.icard[data-goto]:hover{border-color:var(--primary)}.icard p{margin:2px 0 0;color:var(--muted-foreground)}
.empty{text-align:center;padding:28px 12px;border:1px dashed var(--border);border-radius:var(--radius);margin:10px 0;color:var(--muted-foreground)}.empty b{display:block;color:var(--foreground);font-size:15px}
.itabs>.chips .chip:first-child{margin-left:0}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:30;padding:12px}.modal[hidden]{display:none}.dlg{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:440px;width:100%}.dlg h3{margin-top:0}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 16px;border-radius:var(--radius);background:var(--foreground);color:var(--background);z-index:40;max-width:90vw}.toast.error{background:var(--destructive);color:#fff}.toast.success{background:var(--success);color:var(--card)}
.review{margin-top:18px;padding:12px;border:1px dashed var(--primary);border-radius:var(--radius);background:var(--accent)}.review textarea{width:100%;margin-top:8px;min-height:56px}
.review .chip.on[data-verdict=fix]{background:var(--destructive);color:#fff}.review .chip{margin:0 6px 0 0}
body.noreview .review,body.noreview .q-screen{display:none}
.q{border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin:10px 0;background:var(--card)}.q.done{opacity:.85}.q p{margin:0 0 6px;font-weight:600}.q .chip{margin:2px 6px 2px 0}.q .hint{color:var(--muted-foreground);font-size:12px}
.flowwrap{overflow-x:auto;margin:8px 0}.flowwrap svg{display:block;min-width:100%;height:auto}
.lane{fill:var(--muted)}.lane-label{fill:var(--muted-foreground);font-size:12px;font-weight:600}.node{cursor:pointer}.node rect{fill:var(--card);stroke:var(--border);stroke-width:1.5}.node text{fill:var(--foreground);font-size:11px}.node.on rect{fill:var(--accent);stroke:var(--primary);stroke-width:2.5}.node:hover rect{stroke:var(--primary)}.arrow{stroke:var(--muted-foreground);fill:none;stroke-width:1.5}.ah{fill:var(--muted-foreground)}
.flow li{margin:8px 0}.notes{color:var(--muted-foreground)}[hidden]{display:none!important}
#exp-text{width:100%;min-height:220px;margin:8px 0}
@media(max-width:640px){.layout{flex-direction:column}nav{width:auto;border-right:0;border-bottom:1px solid var(--border)}}`;
