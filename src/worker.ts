import { EventEmitter } from 'events';
import { PackageManager, Resource, DownloadProgress } from 'basin-shell/src/package-mgr';

import { OCamlExecutable } from './backend/ocaml_exec';



class IcoqPod extends EventEmitter {

    core: OCamlExecutable
    pm: PackageManager

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

        this.pm = new PackageManager(this.core.wasmFs.volume);
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

        var blobs = await Promise.all(uris.map(async uri => {
            var r = await new Resource(this._pkgUri(uri))
                              .prefetch(p => this._progress(uri, p));
            r.uri = uri; return r;
         }));
        
        for (let b of blobs) {
            await this.pm.install({"/lib/": b});
            this._progress(b.uri, undefined, true);
        }

        if (refresh)
            this.command(['RefreshLoadPath']);
    }

    _pkgUri(uri: string) {
        return (uri[0] == '+') ?
            `${this.binDir}/coq/${uri.substring(1)}.coq-pkg` : uri;
    }

    _progress(uri: string, download: DownloadProgress, done = false) {
        this.emit('progress', {uri, download, done});
    }

    async loadSources(uri: string, dirpath: string) {
        var subdir = dirpath.replace(/[.]|(?<=[^/])$/g, '/');
        await this.pm.install({
            [`/src/${subdir}`]: new Resource(uri)
        });
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
        for (let msg of msgs) postMessage(msg);
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


function postMessage(msg) {
    (<any>self).postMessage(msg);
}


async function main() {
    var icoq = new IcoqPod();

    postMessage(['Starting']);
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
