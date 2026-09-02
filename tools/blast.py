import sys, os
LB=[3,2,4,5,6,7,8,9,10,12,16,24,40,72,136,264]
LX=[0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,8]
LITLEN=[11,124,8,7,28,7,188,13,76,4,10,8,12,10,12,10,8,23,8,9,7,6,7,8,7,6,55,8,23,24,12,11,7,9,11,12,6,7,22,5,7,24,6,11,9,6,7,22,7,11,38,7,9,8,25,11,8,11,9,12,8,12,5,38,5,38,5,11,7,5,6,21,6,10,53,8,7,24,10,27,44,253,253,253,252,252,252,13,12,45,12,45,12,61,12,45,44,173]
LENLEN=[2,35,36,53,38,23]
DISTLEN=[2,20,53,230,247,151,248]
def decode_table(rep):
    out=[]
    for b in rep:
        out += [b & 15]*((b>>4)+1)
    return out
class Huff:
    def __init__(self,lengths):
        self.count=[0]*16
        for l in lengths: self.count[l]+=1
        self.count[0]=0
        offs=[0]*16; s=0
        for l in range(1,16):
            offs[l]=s; s+=self.count[l]
        self.symbol=[0]*len(lengths)
        for sym,l in enumerate(lengths):
            if l: self.symbol[offs[l]]=sym; offs[l]+=1
class BR:
    def __init__(self,d): self.d=d; self.p=0; self.bb=0; self.bc=0
    def bits(self,n):
        v=self.bb
        while self.bc<n:
            v |= self.d[self.p]<<self.bc; self.p+=1; self.bc+=8
        self.bb=v>>n; self.bc-=n
        return v&((1<<n)-1)
    def dec(self,h):
        code=first=index=0
        for l in range(1,16):
            code |= self.bits(1) ^ 1
            cnt=h.count[l]
            if code < first+cnt: return h.symbol[index+(code-first)]
            index+=cnt; first=(first+cnt)<<1; code<<=1
        raise ValueError('bad code')
def blast(data):
    lit=Huff(decode_table(LITLEN)); lenh=Huff(decode_table(LENLEN)); dist=Huff(decode_table(DISTLEN))
    b=BR(data)
    litflag=b.bits(8); dictsz=b.bits(8)
    assert 4<=dictsz<=6, dictsz
    out=bytearray()
    while True:
        if b.bits(1):
            sym=b.dec(lenh)
            length=LB[sym]+b.bits(LX[sym]) if LX[sym] else LB[sym]
            if length==519: break
            if length==2: d=b.dec(dist)<<2 | b.bits(2)
            else: d=b.dec(dist)<<dictsz | b.bits(dictsz)
            d+=1
            for _ in range(length): out.append(out[-d])
        else:
            out.append(b.dec(lit) if litflag else b.bits(8))
    return bytes(out),litflag,dictsz
if __name__=='__main__':
    for f in sys.argv[1:]:
        d=open(f,'rb').read()
        try:
            o,lf,ds=blast(d)
            print('%-16s in=%6d out=%7d litflag=%d dict=%d  head=%s'%(f,len(d),len(o),lf,ds,' '.join('%02x'%x for x in o[:24])))
            open(os.path.join(os.environ.get('BLAST_OUT','.'),'out_'+os.path.basename(f)),'wb').write(o)
        except Exception as e:
            print('%-16s FAILED %s'%(f,e))
