import hashlib, io, json, pathlib, urllib.request, urllib.parse, zipfile
import pycdlib
import concurrent.futures, time
item = "pc-the-legend-of-swordman-chs-cht_202211"
meta = json.load(urllib.request.urlopen("https://archive.org/metadata/" + item))
root = pathlib.Path("JianXiaQingYuan1-DOS")
root.mkdir()
files = {}
for suffix, dest in [("DataCD.bin", "DataCD.bin"), ("AudioCD.bin", "AudioCD.bin")]:
    f = next(f for f in meta["files"] if f["name"].endswith(suffix))
    expected = {"DataCD.bin":"a0c3a95c7e60f3073f464d81967f8dd89c61bfda","AudioCD.bin":"2d3b57e26e393dfa0a511c095a731f7381091750"}[suffix]
    url = "https://archive.org/download/" + item + "/" + urllib.parse.quote(f["name"])
    path = pathlib.Path(dest)
    total = int(f["size"])
    block = 8*1024*1024
    def part(start):
        end = min(start+block,total)-1
        for attempt in range(4):
            try:
                req = urllib.request.Request(url,headers={"Range":f"bytes={start}-{end}"})
                with urllib.request.urlopen(req,timeout=90) as response:
                    assert response.status == 206
                    data = response.read()
                assert len(data) == end-start+1
                print(dest, start, end, flush=True)
                return data
            except Exception:
                if attempt == 3: raise
                time.sleep(2)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        with path.open("wb") as output:
            for data in pool.map(part, range(0,total,block)): output.write(data)
    assert path.stat().st_size == int(f["size"])
    assert hashlib.sha1(path.read_bytes()).hexdigest() == expected
    files[suffix] = path
raw = files["DataCD.bin"].read_bytes()
iso = b"".join(raw[i+16:i+2064] for i in range(0,len(raw),2352))
cd = pycdlib.PyCdlib()
cd.open_fp(io.BytesIO(iso))
for base, dirs, names in cd.walk(iso_path="/"):
    for name in names:
        dst = root / base.lstrip("/") / name.split(";")[0]
        dst.parent.mkdir(parents=True,exist_ok=True)
        cd.get_file_from_iso(str(dst), iso_path=base.rstrip("/")+"/"+name)
cd.close()
files["AudioCD.bin"].replace(root/"AudioCD.bin")
cuefile = next(f for f in meta["files"] if f["name"].endswith("AudioCD.cue"))
cue = urllib.request.urlopen("https://archive.org/download/"+item+"/"+urllib.parse.quote(cuefile["name"])).read().decode("utf-8-sig")
cue = "\n".join('FILE "AudioCD.bin" BINARY' if line.lstrip().startswith("FILE ") else line for line in cue.splitlines())+"\n"
(root/"AudioCD.cue").write_text(cue)
(root/"dosbox.conf").write_text('[sdl]\nfullscreen=false\n[dosbox]\nmemsize=32\n[cpu]\ncore=auto\ncycles=auto\n[autoexec]\nmount c .\nimgmount d "AudioCD.cue" -t iso\nc:\ncd RPG\nPLAY.BAT\n')
(root/"README.txt").write_text("剑侠情缘1（1997）DOS 硬盘整理版\n\n从原始数据光盘提取游戏目录，附第二张音乐光盘 BIN/CUE。无需实体光盘，但背景音乐需要在 DOSBox 中挂载附带的 AudioCD.cue。原始游戏文件未修改。\n在解压目录作为当前工作目录运行：dosbox -conf dosbox.conf\nmacOS M3 请使用支持 Apple Silicon 的 DOSBox 或 DOSBox-X；本包不含模拟器，也不是 macOS 原生程序。\n如声音设置不匹配，可在模拟器内运行 C:\\RPG\\SETUP.EXE。\n原始数据与音轨来自 https://archive.org/details/"+item+"\n下载时验证了两份源文件 SHA-1 与归档记录一致。未完成病毒扫描，未进行实际运行或通关测试。\n",encoding="utf-8")
out = pathlib.Path("JianXiaQingYuan1-DOS.zip")
with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(root.rglob("*")):
        if p.is_file(): z.write(p,p.as_posix())
with zipfile.ZipFile(out) as z: assert z.testzip() is None
sha = hashlib.sha256(out.read_bytes()).hexdigest()
pathlib.Path("SHA256SUMS.txt").write_text(sha+"  "+out.name+"\n")
print(out.name,out.stat().st_size,sha)
