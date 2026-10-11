import os,time
t=time.time();n=0;nm=0
for dp,dn,fn in os.walk("/mnt/d/AI/ai-system",followlinks=False):
    for f in fn:
        try: os.lstat(os.path.join(dp,f)); n+=1
        except OSError: pass
print("files",n,"secs",round(time.time()-t,1))
