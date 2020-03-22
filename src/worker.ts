import { EventEmitter } from 'events';
import JSZip from 'jszip';
import { DEFLATE } from 'jszip/lib/compressions'
import { inflateRaw } from 'pako';

import { OCamlExecutable } from './backend/ocaml_exec';



class IcoqPod extends EventEmitter {

    core: OCamlExecutable

    binDir: string

    constructor(binDir?: string) {
        super();
        binDir = binDir || (process.env.NODE_NOW ? './bin' : '../bin');
        this.binDir = binDir;

        this.core = new OCamlExecutable({stdin: false, tty: false, binDir});
        this.core.debug = () => {};
        this.core.trace = () => {};        

        var utf8 = new TextDecoder();
        this.core.on('stream:out', ev => console.log(utf8.decode(ev.data)));
    }

    get fs() { return this.core.wasmFs.fs; }

    async boot() {
        await this.upload(`${this.binDir}/icoq.bc`, '/lib/icoq.bc');
    
        this._preloadStub();
    
        await this.core.run('/lib/icoq.bc', [], ['wacoq_post']);
    
        await this.loadPackage('+init', false);    
    }

    async upload(fromUri: string | RequestInfo, toPath: string) {
        var content = await (await fetch(fromUri)).arrayBuffer();
        this.putFile(toPath, new Uint8Array(content));
    }

    loadPackage(uri: string, refresh: boolean = true) {
        return this.loadPackages([uri], refresh);
    }

    async loadPackages(uris: string | string[], refresh: boolean = true) {
        if (typeof uris == 'string') uris = [uris];
        
        await Promise.all(uris.map(async uri => {
            await this.unzip(uri, '/lib');
            this._progress(uri, undefined, true);
        }));

        if (refresh)
            this.command(['RefreshLoadPath']);
    }

    async unzip(zip: string | JSZip, dir: string) {
        if (typeof zip == 'string')
            zip = await JSZip.loadAsync(await this._fetch(zip));

        let yc = 0;
        for (let entry of zip.filter((_, e) => !e.dir)) {
            this.putFile(`${dir}/${entry.name}`, this._inflateFast(entry));
            if (!((++yc) & 0xf)) await _yield();
        }
    }

    async loadSources(uri: string, dirpath: string) {
        var subdir = dirpath.replace(/[.]|(?<=[^/])$/g, '/');
        this.unzip(uri, `/src/${subdir}`);
    }

    _fetch(uri: string) {
        return fetchWithProgress(this._pkgUri(uri),
                    p => this._progress(uri, p));
    }

    _pkgUri(uri: string) {
        return (uri[0] == '+') ?
            `${this.binDir}/coq/${uri.substring(1)}.coq-pkg` : uri;
    }

    _progress(uri: string, download: DownloadProgress, done = false) {
        this.emit('progress', {uri, download, done});
    }

    _inflateFast(entry: any) {
        if (entry._data.compression == DEFLATE)
            return inflateRaw(entry._data.compressedContent);
        else /* STORE */
            return entry._data.compressedContent;
    }

    putFile(filename: string, content: Uint8Array | string) {
        // needs to be synchronous
        this.fs.mkdirpSync(filename.replace(/[/][^/]+$/, ''))
        this.fs.writeFileSync(filename, content);
    }

    command(cmd: any[]) {
        switch (cmd[0]) {
        case 'LoadPkg':   this.loadPackages(cmd[1]);               return;
        case 'Put':       this.putFile(cmd[1], cmd[2]);            return;
        }

        const wacoq_post = this.core.callbacks && this.core.callbacks.wacoq_post;
        if (!wacoq_post) return;
    
        var json = (typeof cmd === 'string') ? cmd : JSON.stringify(cmd),
            answer = wacoq_post(this.core.to_caml_string(json));
        this._answer(answer);
    }
    
    answer(msgs: any[][]) {
        for (let msg of msgs) this.emit('message', msg);
    }
    
    _answer(ptr: number) {
        var cstr = this.core.proc.userGetCString(ptr);
        this.answer(JSON.parse(<any>cstr));
    }

    /**
     * (internal) Initializes the dllbyterun_stub shared library.
     */
    _preloadStub() {
        this.core.proc.dyld.preload(
            'dllbyterun_stubs.so', `${this.binDir}/coq/dllbyterun_stubs.wasm`,
            {
                data: ['caml_atom_table'], func: ['caml_copy_double'],
                js: {
                    wacoq_emit_js: (s:number) => this._answer(s)
                }
            }
        );
    }    
}


async function fetchWithProgress(uri: string, progress: (p: any) => void) {
    var response = await fetch(uri),
        total = +response.headers.get('Content-Length'),
        r = response.body.getReader(), chunks = [], downloaded = 0;
    for(;;) {
        var {value, done} = await r.read();
        if (done) break;
        chunks.push(value);
        downloaded += value.length;
        progress({total, downloaded})
    }
    return new Blob(chunks);
}    

function _yield() { return new Promise(resolve => setTimeout(resolve, 0)); }


type DownloadProgress = { total: number, downloaded: number };


function postMessage(msg) {
    (<any>self).postMessage(msg);
}


async function main() {
    var icoq = new IcoqPod();

    postMessage(['Starting']);
    icoq.on('message', postMessage);
    icoq.on('progress', ev => postMessage(['LibProgress', ev]));

    addEventListener('message', (msg) => {
        console.log(msg.data);
        icoq.command(msg.data);
    });

    await icoq.boot();

    postMessage(['Boot']);

    Object.assign(global, {icoq});
}

main();



Object.assign(global, {main});
